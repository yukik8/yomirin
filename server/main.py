# reading-scaffold のうんちくサーバ(Vercel / ローカルの uvicorn)。
#
# 役目は3つ:
#   1. /trivia: 拡張が端末で選んだ「単語の候補」(最大8語)から、くまのうんちくを1つ返す。
#      本の本文・書名・URL は受け取らない(Google Play の規約で、購入した本の送信・再配布は禁止)。
#      受け取った単語も生成結果も保存しない。ログには状態とトークン数だけを出し、単語は出さない。
#   2. /quiz・/ask: 読み終えた本文から、突然クイズと問いへの答えを作る(#13・#14)。
#      拡張で本人が「本文を AI のサーバに送る」をオンにしたときだけ呼ばれる(PRIVACY.md §2-2)。
#      本文・問い・生成結果は保存せず、ログにも出さない。
#   3. /telemetry: 使われ方の要約(セッションごとの読書時間・θ など。#28)を Postgres に貯める。
#      項目は数・真偽・決まった語だけで、本・本文・問いは受け取らない。IP は保存しない。
#
# 公開サーバなので、誰でも叩ける前提で守る:
#   - インストールごとの ID(X-RS-Install / X-RS-Telemetry)と IP ごとに、1日の回数を数える
#   - サーバ全体の1日の上限(これを超えたら全員に断る)
#   - 入力の長さ・語数・値の範囲の上限、Anthropic 呼び出しのタイムアウト
#   - 料金の最後の砦は Anthropic Console 側の利用額の上限(server/README.md)
# 回数は Upstash Redis(環境変数があれば)で数える。無ければインスタンスのメモリで数える(目安)。

import datetime
import json
import os
import re
import threading
import time
import uuid
from collections import OrderedDict
from typing import Annotated, Literal

import anthropic
import httpx
import psycopg
from fastapi import FastAPI, Header, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints


def _load_dotenv():
    """ローカル開発用: server/.env を読み、未設定の環境変数だけ埋める(依存なしの最小実装)。
    Vercel では .env をアップロードしない(.vercelignore)。環境変数は Vercel の設定から入れる。"""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except FileNotFoundError:
        pass


_load_dotenv()


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


MODEL = os.environ.get("RS_MODEL") or os.environ.get("RS_QUIZ_MODEL") or "claude-opus-5"
# 1日の上限(日本時間ではなく UTC の日付で区切る)
LIMIT_PER_INSTALL = _int_env("RS_LIMIT_PER_INSTALL", 150)
LIMIT_PER_IP = _int_env("RS_LIMIT_PER_IP", 400)
LIMIT_GLOBAL = _int_env("RS_LIMIT_GLOBAL", 20000)
# 拡張の ID を固定したいとき(ストア公開後): カンマ区切りの chrome-extension://<id>
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("RS_ALLOWED_ORIGINS", "").split(",") if o.strip()]

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

# 拡張の service worker からの fetch は chrome-extension:// オリジンの CORS 要求になる
# (拡張にこのサーバの host 権限を付けていないため)。CORS はアクセス制御ではない — 守りは回数制限。
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=None if ALLOWED_ORIGINS else r"chrome-extension://[a-p]{32}",
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["content-type", "x-rs-install", "x-rs-telemetry"],
    max_age=86400,
)

# 拡張は 15 秒で諦めるので、それより長く生成を続けて課金されないようにする
client = anthropic.Anthropic(timeout=12.0, max_retries=1)


# ---- 回数制限 -----------------------------------------------------------------

_REDIS_URL = os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("KV_REST_API_URL")
_REDIS_TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN") or os.environ.get("KV_REST_API_TOKEN")
_mem_counts: dict[str, int] = {}
_mem_lock = threading.Lock()


def _day() -> str:
    return time.strftime("%Y%m%d", time.gmtime())


def _incr(keys: list[str]) -> list[int] | None:
    """キーごとに1日の回数を1増やして、増やした後の値を返す。数えられなければ None。"""
    if _REDIS_URL and _REDIS_TOKEN:
        try:
            cmds = []
            for k in keys:
                cmds.append(["INCR", k])
                cmds.append(["EXPIRE", k, "90000"])  # 25時間で消える
            r = httpx.post(
                f"{_REDIS_URL.rstrip('/')}/pipeline",
                headers={"Authorization": f"Bearer {_REDIS_TOKEN}"},
                json=cmds,
                timeout=2.0,
            )
            r.raise_for_status()
            out = r.json()
            return [int(out[i * 2]["result"]) for i in range(len(keys))]
        except Exception as e:  # Redis が落ちていたらメモリで数える(止めない)
            print(json.dumps({"event": "ratelimit_redis_error", "error": type(e).__name__}))
    with _mem_lock:
        if len(_mem_counts) > 50000:  # 日をまたいだ古いキーを捨てる
            today = _day()
            for k in [k for k in _mem_counts if today not in k]:
                del _mem_counts[k]
        vals = []
        for k in keys:
            _mem_counts[k] = _mem_counts.get(k, 0) + 1
            vals.append(_mem_counts[k])
        return vals


def _over_limit(install: str, ip: str) -> bool:
    day = _day()
    counts = _incr([f"rs:{day}:install:{install}", f"rs:{day}:ip:{ip}", f"rs:{day}:global"])
    if counts is None:
        return False
    per_install, per_ip, total = counts
    return per_install > LIMIT_PER_INSTALL or per_ip > LIMIT_PER_IP or total > LIMIT_GLOBAL


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ---- うんちく -------------------------------------------------------------------

# 2026-10-07: 楽長の口ずさみ「トォテテ テテテイ」に意味をでっち上げたので、擬音・口ずさみ・名前・造語を禁止し、
# 辞書・事典で確かめられることだけに絞った。同日、本文を受け取らず単語の候補だけから話す形にした。
# 擬音らしい語のはじき方は、拡張の ai.js の looksLikeSound と揃える(../tests/fixtures/terms.json)。
TRIVIA_SYSTEM = (
    "あなたは読書アプリのマスコット「くま」。読者が読んでいる本のページから拾った単語の候補が渡される(本文は渡されない)。"
    "候補の中から、国語辞典・百科事典に載っていて「へぇ」となる話ができる言葉を1つだけ選び、うんちくを1つ話す。"
    "話してよいのは、辞書・事典で確かめられることだけ: 言葉の意味、今では見慣れない言い回し、難しい漢字の読み、言葉の由来・語源、"
    "実在の物・場所・習慣についての事実。"
    "次のものは絶対に選ばない: 擬音語・擬態語・鳴き声、歌やメロディーの口ずさみ(カタカナの音の並びなど)、"
    "人や動物や登場人物の名前(名前かもしれない言葉も避ける)、作者の造語、ありふれていて話にならない言葉。"
    "本の内容・あらすじ・登場人物は知らないものとして扱い、推測で触れない。読者を褒める言葉・感想・教訓・アドバイスは書かない。"
    "少しでも自信がなければ sure を false にし、text と term を空文字にする。黙るのは失敗ではない。"
    "くまの口調でやさしく短く、1〜2文・全体で60字以内(例:「〜なんだって!」「〜らしいよ」)。"
    "term には選んだ言葉を候補の表記のまま入れる。"
    "kind は word(言葉の意味)・reading(漢字の読み)・origin(由来)・fact(事実)のどれか。"
    "sure は辞書・事典で確かめられると言い切れるときだけ true。"
)

TRIVIA_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "term": {"type": "string"},
        "kind": {"type": "string", "enum": ["word", "reading", "origin", "fact"]},
        "sure": {"type": "boolean"},
    },
    "required": ["text", "term", "kind", "sure"],
    "additionalProperties": False,
}

_KANA_ONLY = re.compile(r"^[぀-ヿー\s　・]+$")
_SOUNDISH = re.compile(r"(.)\1|(..)\2|\s|[っッ]$")
# 1語として扱える文字だけ(文字・数字・長音・々・中黒・アポストロフィ・ハイフン)。空白や記号・URL は弾く
_WORDLIKE = re.compile(r"^[\w・'\-]+$")
_URLISH = re.compile(r"https?://|www\.|\.(?:com|net|org|jp|io)\b", re.I)


def _looks_like_sound(term: str) -> bool:
    """擬音や口ずさみらしい言葉(カタカナ/ひらがなだけで、繰り返し・空白を含むか「っ」で終わる)。"""
    t = term.strip()
    return bool(t) and bool(_KANA_ONLY.match(t)) and bool(_SOUNDISH.search(t))


Term = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16)]


class TriviaRequest(BaseModel):
    # 単語の候補以外(本文など)が付いてきたら受けない(黙って捨てずに 422 で知らせる)
    model_config = ConfigDict(extra="forbid")
    terms: list[Term] = Field(min_length=1, max_length=8)


# 同じ候補の並びへの答え(話せなかったことも含む)。インスタンスごとのメモリ・目安
_cache: OrderedDict[str, dict] = OrderedDict()
_cache_lock = threading.Lock()
CACHE_MAX = 2048


def _cache_get(key: str) -> dict | None:
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    return None


def _cache_put(key: str, value: dict) -> None:
    with _cache_lock:
        _cache[key] = value
        _cache.move_to_end(key)
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)


def _log(event: str = "trivia", **fields) -> None:
    """1行の JSON ログ。単語・本文・問い・生成文は出さない。"""
    print(json.dumps({"event": event, **fields}, ensure_ascii=False))


def _install_guard(request: Request, value: str | None) -> tuple[str | None, JSONResponse | None]:
    """インストール ID(拡張が作るランダムな UUID)とオリジンを確かめる。通さないときは応答を返す。"""
    try:
        install = str(uuid.UUID(value or ""))
    except ValueError:
        return None, JSONResponse({"ok": False, "error": "no_install_id"}, status_code=401)
    if ALLOWED_ORIGINS and request.headers.get("origin") not in ALLOWED_ORIGINS:
        return None, JSONResponse({"ok": False, "error": "forbidden"}, status_code=403)
    return install, None


def _generate(event: str, system: str, user: str, schema: dict, effort: str) -> tuple[dict | None, str | None]:
    """Anthropic に1回だけ頼み、出力の JSON を読む。(data, None) か (None, 断った理由)。
    ログには状態・所要時間・トークン数だけを出す(渡したものも返ってきたものも出さない)。"""
    started = time.monotonic()
    try:
        resp = client.beta.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=system,
            # 分類器がまれに拒否した場合もサーバ側で自動フォールバックさせる
            betas=["server-side-fallback-2026-07-01"],
            extra_body={"fallbacks": "default"},
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            messages=[{"role": "user", "content": user}],
        )
    except anthropic.APIStatusError as e:
        _log(event, status="api_error", http=e.status_code, request_id=getattr(e, "request_id", None))
        return None, "unavailable"
    except Exception as e:  # タイムアウト・接続失敗・鍵の未設定など。中身は外へ返さない
        _log(event, status="error", error=type(e).__name__)
        return None, "unavailable"

    usage = getattr(resp, "usage", None)
    _log(
        event,
        status=resp.stop_reason,
        ms=round((time.monotonic() - started) * 1000),
        input_tokens=getattr(usage, "input_tokens", None),
        output_tokens=getattr(usage, "output_tokens", None),
        request_id=getattr(resp, "_request_id", None),
    )
    if resp.stop_reason == "refusal":
        return None, "refusal"
    if resp.stop_reason == "max_tokens":
        return None, "truncated"  # 途中で切れた JSON は読まない
    block = next((b for b in resp.content if b.type == "text"), None)
    if block is None:
        return None, "empty"
    try:
        data = json.loads(block.text)
    except json.JSONDecodeError:
        return None, "bad_json"
    if not isinstance(data, dict):
        return None, "bad_json"
    return data, None


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.post("/trivia")
def trivia(
    req: TriviaRequest,
    request: Request,
    x_rs_install: str | None = Header(default=None),
):
    install, denied = _install_guard(request, x_rs_install)
    if denied is not None:
        return denied

    terms: list[str] = []
    for t in req.terms:
        if _WORDLIKE.match(t) and not _URLISH.search(t) and not t.isdigit() and t not in terms:
            terms.append(t)
    if not terms:
        return {"ok": False, "error": "no_terms"}

    if _over_limit(install, _client_ip(request)):
        _log(status="rate_limited")
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    key = "\n".join(sorted(terms))
    cached = _cache_get(key)
    if cached is not None:
        return cached

    user = "単語の候補:\n" + "\n".join(f"- {t}" for t in terms)
    data, error = _generate("trivia", TRIVIA_SYSTEM, user, TRIVIA_SCHEMA, "medium")
    if error is not None:
        return {"ok": False, "error": error}
    out = _check(data, terms)
    _cache_put(key, out)
    return out


def _check(data: dict, terms: list[str]) -> dict:
    """生成されたうんちくを検める。言い切れない・候補に無い言葉・擬音らしい・長すぎる・URL入りは捨てる。"""
    said = str(data.get("text", "")).strip()
    term = str(data.get("term", "")).strip()
    if not said or data.get("sure") is not True:
        return {"ok": False, "error": "nothing_certain"}  # 自信がないときは黙る
    if term not in terms:
        return {"ok": False, "error": "unknown_term"}
    if _looks_like_sound(term):
        return {"ok": False, "error": "soundish_term"}  # 擬音・口ずさみには意味を付けない
    if len(said) > 90 or _URLISH.search(said):
        return {"ok": False, "error": "rejected_text"}
    return {"ok": True, "trivia": {"text": said, "term": term}}


# ---- クイズと問い(本文を受け取る・#13・#14) ---------------------------------------------
#
# 拡張で本人が「本文を AI のサーバに送る」をオンにしたときだけ呼ばれる(拡張の config.js の readTextConsent。
# 新しく入れた人は最初の設定で既定オン・前の版から使っている人は選ぶまでオフ)。
# 受け取るのは読み終えた段落だけ(未読の段落は拡張が渡さない=ネタバレ禁止)。本文・問い・生成結果は
# 保存しない・覚えない・ログにも出さない。回数はうんちくと同じ1日の上限で数える。
# 指示の言葉の原則は docs/design.md §6: 解説・褒め・アドバイス・先の展開の紹介は書かせない。

QUIZ_SYSTEM = (
    "あなたは読解クイズの出題者。渡された段落の内容だけから、理解を確かめる3択クイズを1問作る。"
    "本文と同じ言語で出題する。選択肢はちょうど3つ、answer_index は正解の選択肢の番号(0〜2)。"
    "解説・褒め言葉・アドバイスは一切書かない。"
)

# 構造化出力の JSON Schema は、配列の個数や数の範囲を縛れないので、返ってきたものを _check_quiz で検める
QUIZ_SCHEMA = {
    "type": "object",
    "properties": {
        "question": {"type": "string"},
        "choices": {"type": "array", "items": {"type": "string"}},
        "answer_index": {"type": "integer"},
    },
    "required": ["question", "choices", "answer_index"],
    "additionalProperties": False,
}

_ANSWER_RULES = (
    "必ず2〜3文で短く答える。本文の要約や先の内容の紹介はしない。"
    "根拠が渡された段落にあれば、その番号をsource_indexで返す(なければ-1)。本文と同じ言語で答える。"
)

# 本についての問いだと分かっているとき(拡張が、本文を選んで問うた・問いの言葉が本文と重なる、と見たとき)
ANSWER_SYSTEM = "読書中の質問に答えるアシスタント。" + _ANSWER_RULES

# 本についての問いか分からないとき(judge)。2026-10-09:「Pythonで累積和を出すコード」にも答えていたので、
# 本と関係のない頼みごとは unrelated=true で断らせる。判定は答えと同じ1回の呼び出しの中で先に決めさせる。
# 「本についてか」と聞くより「関係のない頼みごとか」と聞くほうが、また質問を本文より後ろに置くほうが、よく断れた。
# ただし「『槌』の読み方は?」のような言葉の問いまで断るので、そうした問いは拡張の sharesTermWith が先に拾う。
JUDGED_ANSWER_SYSTEM = (
    "読書中の問いに答えるアシスタント。"
    "まず unrelated を決める。問いが、いま読んでいる本の内容と関係のない頼みごとなら true: "
    "プログラミングやコード、計算、翻訳、作文、レポートの書き方、相談、雑談、天気や店などのほかの調べもの(本文にその題材が出てこないとき)。"
    "本文の言葉の意味や読み、出てくる人物・物・場所・出来事・考え、時代や背景、書き手の意図についての問いなら false。"
    "unrelated が true のときは answer を空文字、source_index を -1 にする。"
    "false のときは" + _ANSWER_RULES
)

_ANSWER_PROPS = {"answer": {"type": "string"}, "source_index": {"type": "integer"}}
ANSWER_SCHEMA = {
    "type": "object",
    "properties": _ANSWER_PROPS,
    "required": ["answer", "source_index"],
    "additionalProperties": False,
}
JUDGED_ANSWER_SCHEMA = {
    "type": "object",
    "properties": {"unrelated": {"type": "boolean"}, **_ANSWER_PROPS},
    "required": ["unrelated", "answer", "source_index"],
    "additionalProperties": False,
}

# 拡張(service-worker.js)が切り詰める長さと同じ。超えたら 422
QuizText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=60, max_length=2000)]
Focus = Annotated[str, StringConstraints(strip_whitespace=True, max_length=600)]
Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Selection = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
ParagraphText = Annotated[str, StringConstraints(max_length=800)]


class QuizRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: QuizText  # 読み終えたページの段落
    focus: Focus = ""  # その中で最も難しい段落(拡張の difficulty.js)


class AskParagraph(BaseModel):
    model_config = ConfigDict(extra="forbid")
    i: Annotated[int, Field(ge=0, le=100_000)]  # ページの中の段落の番号(根拠を光で指すため)
    text: ParagraphText


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: Question
    selection: Selection = ""
    context: list[AskParagraph] = Field(default_factory=list, max_length=8)  # 読み終えた直近の段落
    judge: bool  # 本についての問いか、答えと一緒に決めさせるか


def _check_quiz(data: dict) -> dict:
    """生成されたクイズを検める(問題文・選択肢ちょうど3つ・正解の番号 0〜2)。"""
    question = str(data.get("question", "")).strip()
    choices = data.get("choices")
    idx = data.get("answer_index")
    if not question or not isinstance(choices, list) or len(choices) != 3:
        return {"ok": False, "error": "rejected_quiz"}
    choices = [str(c or "").strip() for c in choices]
    if any(not c for c in choices) or isinstance(idx, bool) or not isinstance(idx, int) or not 0 <= idx <= 2:
        return {"ok": False, "error": "rejected_quiz"}
    return {
        "ok": True,
        "quiz": {"question": question[:300], "choices": [c[:120] for c in choices], "answer_index": idx},
    }


@app.post("/quiz")
def quiz(
    req: QuizRequest,
    request: Request,
    x_rs_install: str | None = Header(default=None),
):
    install, denied = _install_guard(request, x_rs_install)
    if denied is not None:
        return denied
    if _over_limit(install, _client_ip(request)):
        _log("quiz", status="rate_limited")
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    # 焦点(ページで最も難しい段落)があれば、そこの理解を確かめる問いにする
    focus = f"\n特に次の箇所の理解を確かめる問いにする:\n{req.focus}\n" if req.focus and req.focus in req.text else ""
    user = f"次の段落から3択クイズを1問。正解は段落を読んでいれば分かるものにする。{focus}\n---\n{req.text}"
    data, error = _generate("quiz", QUIZ_SYSTEM, user, QUIZ_SCHEMA, "medium")
    if error is not None:
        return {"ok": False, "error": error}
    return _check_quiz(data)


@app.post("/ask")
def ask(
    req: AskRequest,
    request: Request,
    x_rs_install: str | None = Header(default=None),
):
    install, denied = _install_guard(request, x_rs_install)
    if denied is not None:
        return denied
    if _over_limit(install, _client_ip(request)):
        _log("ask", status="rate_limited")
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    ctx = "\n\n".join(f"[{c.i}] {c.text}" for c in req.context)
    selection = f"読者が選択している本文: {req.selection}\n\n" if req.selection else ""
    # 本文を先・質問を後に置く(関係のない頼みごとを、よく断れた並び)
    user = f"読了済みの段落:\n{ctx}\n\n{selection}質問: {req.question}"
    if req.judge:
        data, error = _generate("ask", JUDGED_ANSWER_SYSTEM, user, JUDGED_ANSWER_SCHEMA, "low")
    else:
        data, error = _generate("ask", ANSWER_SYSTEM, user, ANSWER_SCHEMA, "low")
    if error is not None:
        return {"ok": False, "error": error}
    if req.judge and data.get("unrelated") is True:
        return {"ok": False, "error": "off_topic"}  # 本と関係のない頼みごとには答えない
    answer = str(data.get("answer", "")).strip()
    if not answer or len(answer) > 600 or _URLISH.search(answer):
        return {"ok": False, "error": "rejected_answer"}
    src = data.get("source_index")
    known = {c.i for c in req.context}
    source_index = src if isinstance(src, int) and not isinstance(src, bool) and src in known else -1
    return {"ok": True, "answer": answer, "source_index": source_index}


# ---- 使われ方の要約(#28) -----------------------------------------------------------
#
# 拡張は、セッションを閉じたあとに、その要約を送り待ちに積んでまとめて送る(本人がオフにしていなければ)。
# ここではそれを Postgres(Vercel Marketplace の Neon)に貯めるだけ。一方通行で、返すのは 204 だけ
# (θ・演出・画面に戻すものは無い)。項目は下の TmSession / TmHello だけで、それ以外が付いてきたら 422。
# 値は数・真偽・決まった語・版の番号だけ(自由な文字列の項目が無いので、本文や書名が混ざる余地が型で無い)。
# IP は保存しない。ログは状態・行の数・所要時間だけで、項目の値も ID も出さない。
# DATABASE_URL が無ければ、受け取って捨てる(ローカルでも拡張を止めない)。

DATABASE_URL = os.environ.get("DATABASE_URL") or None
TM_LIMIT_PER_ID = _int_env("RS_TM_LIMIT_PER_ID", 100)  # 1日の POST・DELETE の回数(拡張はセッションを閉じるごとに1回)
TM_LIMIT_GLOBAL = _int_env("RS_TM_LIMIT_GLOBAL", 50000)
TM_MAX_ROWS = 50  # 1回に受ける行の数(拡張の送り待ちの上限と同じ)
_SQL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sql")

Count = Annotated[int, Field(ge=0, le=100_000)]
Ms = Annotated[int, Field(ge=0, le=86_400_000)]  # 24時間まで
Theta = Annotated[float, Field(ge=0, le=8, allow_inf_nan=False)]  # 0〜THETA_MAX
Version = Annotated[str, StringConstraints(pattern=r"^\d{1,4}(\.\d{1,4}){0,3}$")]


class TmSession(BaseModel):
    """セッションの要約。拡張の telemetry.js(sessionRow)と同じ項目・同じ範囲。
    どちらかを変えたら、もう片方と sql/・tests/fixtures/telemetry.json も揃える。"""

    model_config = ConfigDict(extra="forbid")
    kind: Literal["session"]
    v: Literal[1]  # 行の形の版
    ext: Version  # そのセッションを測った拡張の版
    session_id: uuid.UUID  # 送り直しの重なりを除くため
    date: datetime.date  # 端末の日付
    hour: Annotated[int, Field(ge=0, le=23)]
    theta: Theta
    theta_base: Theta
    theta_after: Theta | None
    controller_reason: (
        Literal["success", "fail", "graduate", "homeostat_redeploy", "homeostat_recover", "down", "up", "hold", "explore_hold"]
        | None
    )
    read_ms: Ms
    escapes: Count
    away_total_ms: Ms
    quick_returns: Count
    longest_streak_ms: Ms
    completion_pct: Annotated[int, Field(ge=0, le=100)]
    success: bool
    stability: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)] | None
    end_reason: Literal["manual", "close", "idle"] | None
    hints_shown: Count
    effects_shown: Count
    pages_read: Count
    pace_wpm: Annotated[float, Field(ge=0, le=100_000, allow_inf_nan=False)] | None
    pace_cv: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)] | None
    slow_pages: Count
    fast_pages: Count
    backs: Count
    quiz_answered: Count
    quiz_correct: Count
    questions_asked: Count  # 数だけ(問いの文は受け取らない)
    position_read: bool  # Play ブックスのページ表示が読めたか
    reached_end: bool


class TmHello(BaseModel):
    """環境の行(オンボーディングの完了・版が変わったとき)。拡張の telemetry.js(helloRow)と同じ項目。"""

    model_config = ConfigDict(extra="forbid")
    kind: Literal["hello"]
    v: Literal[1]
    ext: Version
    build: Literal["store", "dev"]
    chrome: Annotated[int, Field(ge=1, le=999)] | None  # メジャー版だけ
    theta0: Theta | None  # 診断で置いた θ の初期値
    goal: Literal["level1", "level2", "level3"] | None
    trivia: bool  # うんちくのサーバを使うか


class TelemetryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[Annotated[TmSession | TmHello, Field(discriminator="kind")]] = Field(min_length=1, max_length=TM_MAX_ROWS)


_SESSION_COLUMNS = [name for name in TmSession.model_fields if name != "kind"]
_INSERT_SESSION = (
    f"INSERT INTO tm_sessions (telemetry_id, {', '.join(_SESSION_COLUMNS)}) "
    f"VALUES (%(telemetry_id)s, {', '.join(f'%({c})s' for c in _SESSION_COLUMNS)}) "
    "ON CONFLICT (telemetry_id, session_id) DO NOTHING"
)
_TOUCH_INSTALL = "INSERT INTO tm_installs (id) VALUES (%s) ON CONFLICT (id) DO UPDATE SET last_seen = now()"
_HELLO_COLUMNS = [name for name in TmHello.model_fields if name not in ("kind", "v")]
_UPDATE_HELLO = (
    f"UPDATE tm_installs SET hello_at = now(), {', '.join(f'{c} = %({c})s' for c in _HELLO_COLUMNS)} WHERE id = %(id)s"
)

_schema_lock = threading.Lock()
_schema_ready = False


def _connect():
    # Neon の pooled の URL は PgBouncer(transaction mode)を通るので、サーバ側の prepared statement は使わない
    return psycopg.connect(DATABASE_URL, connect_timeout=5, prepare_threshold=None)


def _ensure_schema(conn) -> None:
    """sql/ の SQL を、インスタンスごとに最初の1回だけ流す(どれも何度流しても同じになる書き方)。"""
    global _schema_ready
    with _schema_lock:
        if _schema_ready:
            return
        for name in sorted(os.listdir(_SQL_DIR)):
            if name.endswith(".sql"):
                with open(os.path.join(_SQL_DIR, name), encoding="utf-8") as f:
                    conn.execute(f.read())
        conn.commit()
        _schema_ready = True


def _store(tid: str, rows: list[TmSession | TmHello]) -> None:
    sessions = [r for r in rows if isinstance(r, TmSession)]
    hello = next((r for r in reversed(rows) if isinstance(r, TmHello)), None)
    with _connect() as conn:  # 抜けるときに commit(例外なら rollback)して閉じる
        _ensure_schema(conn)
        with conn.cursor() as cur:
            cur.execute(_TOUCH_INSTALL, (tid,))
            if hello is not None:
                cur.execute(_UPDATE_HELLO, {"id": tid, **hello.model_dump(include=set(_HELLO_COLUMNS))})
            if sessions:
                cur.executemany(
                    _INSERT_SESSION,
                    [{"telemetry_id": tid, **s.model_dump(include=set(_SESSION_COLUMNS))} for s in sessions],
                )


def _forget(tid: str) -> None:
    with _connect() as conn:
        _ensure_schema(conn)
        conn.execute("DELETE FROM tm_sessions WHERE telemetry_id = %s", (tid,))
        conn.execute("DELETE FROM tm_installs WHERE id = %s", (tid,))


def _tm_log(**fields) -> None:
    """1行の JSON ログ。項目の値も telemetry_id も出さない。"""
    print(json.dumps({"event": "telemetry", **fields}))


def _tm_guard(request: Request, tid: str | None, op: str) -> JSONResponse | None:
    """ID・オリジン・1日の回数を確かめる。通さないときは返す応答。"""
    if tid is None:
        return JSONResponse({"ok": False, "error": "no_telemetry_id"}, status_code=401)
    if ALLOWED_ORIGINS and request.headers.get("origin") not in ALLOWED_ORIGINS:
        return JSONResponse({"ok": False, "error": "forbidden"}, status_code=403)
    day = _day()
    counts = _incr([f"tm:{day}:id:{tid}", f"tm:{day}:global"])
    if counts is not None and (counts[0] > TM_LIMIT_PER_ID or counts[1] > TM_LIMIT_GLOBAL):
        _tm_log(op=op, status="rate_limited")
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)
    return None


def _telemetry_id(value: str | None) -> str | None:
    """拡張が作るランダムな UUID(うんちくの install_id とは別)。無い・形が違うものは None。"""
    try:
        return str(uuid.UUID(value or ""))
    except ValueError:
        return None


@app.post("/telemetry", status_code=204)
def telemetry(
    req: TelemetryRequest,
    request: Request,
    x_rs_telemetry: str | None = Header(default=None),
):
    tid = _telemetry_id(x_rs_telemetry)
    denied = _tm_guard(request, tid, "post")
    if denied is not None:
        return denied
    if not DATABASE_URL:
        _tm_log(op="post", status="discarded", rows=len(req.rows))
        return Response(status_code=204)
    started = time.monotonic()
    try:
        _store(tid, req.rows)
    except Exception as e:  # DB に届かない・落ちている。拡張は送り待ちに残して、あとで送り直す
        _tm_log(op="post", status="db_error", error=type(e).__name__, ms=round((time.monotonic() - started) * 1000))
        return JSONResponse({"ok": False, "error": "unavailable"}, status_code=503)
    _tm_log(op="post", status="stored", rows=len(req.rows), ms=round((time.monotonic() - started) * 1000))
    return Response(status_code=204)


@app.delete("/telemetry", status_code=204)
def telemetry_forget(
    request: Request,
    x_rs_telemetry: str | None = Header(default=None),
):
    """その ID の行を全部消す(ダッシュボードの「送ったものを消す」と全消去)。"""
    tid = _telemetry_id(x_rs_telemetry)
    denied = _tm_guard(request, tid, "delete")
    if denied is not None:
        return denied
    if not DATABASE_URL:
        _tm_log(op="delete", status="discarded")
        return Response(status_code=204)
    started = time.monotonic()
    try:
        _forget(tid)
    except Exception as e:
        _tm_log(op="delete", status="db_error", error=type(e).__name__, ms=round((time.monotonic() - started) * 1000))
        return JSONResponse({"ok": False, "error": "unavailable"}, status_code=503)
    _tm_log(op="delete", status="deleted", ms=round((time.monotonic() - started) * 1000))
    return Response(status_code=204)
