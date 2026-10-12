"""うんちくサーバ(main.py)のテスト。入口(受け取るもの)と出口(返すもの・ログ)を確かめる。

受け取るのは単語の候補だけで、本文は受けない(docs/design.md §11-7)。単語と生成文はログに出さない(README)。

    cd server && ./.venv/bin/python -m pytest
"""

import json
import uuid

import anthropic
import httpx
import pytest

import main

ID = str(uuid.uuid4())
HEAD = {"X-RS-Install": ID}
TERMS = ["活動写真館", "蓄音機"]
SAID = "活動写真館は映画館の古い呼び方なんだって!"


def post(client, body, headers=HEAD):
    return client.post("/trivia", json=body, headers=headers)


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


# ---- 入口: 受け取るもの -------------------------------------------------------


@pytest.mark.parametrize("headers", [{}, {"X-RS-Install": "not-a-uuid"}])
def test_インストールIDが無い_形が違うと401(client, fake, headers):
    r = post(client, {"terms": TERMS}, headers)
    assert r.status_code == 401
    assert fake.calls == []


@pytest.mark.parametrize(
    "body",
    [
        {"terms": TERMS, "text": "本文の段落"},  # 単語の候補のほかに本文が付いてきた
        {"terms": TERMS, "title": "銀河鉄道の夜"},
        {"terms": [f"語{i}" for i in range(9)]},  # 9語
        {"terms": ["あ" * 17]},  # 17字
        {"terms": []},
        {"text": "本文だけ"},
    ],
)
def test_単語の候補のほかは受けない(client, fake, body):
    assert post(client, body).status_code == 422
    assert fake.calls == []


def test_URL_数字だけ_空白入りの語は捨て_残らなければ呼ばない(client, fake):
    r = post(client, {"terms": ["http://x.jp", "12345", "活動 写真", "www.x.jp"]})
    assert r.json() == {"ok": False, "error": "no_terms"}
    assert fake.calls == []


def test_Anthropicへ渡すのは単語の候補の並びだけ(client, fake):
    post(client, {"terms": [*TERMS, "活動写真館"]})  # 重なりは1つに
    (call,) = fake.calls
    assert call["model"] == main.MODEL
    (msg,) = call["messages"]
    assert msg == {"role": "user", "content": "単語の候補:\n- 活動写真館\n- 蓄音機"}


def test_回数の上限を超えると429(client, fake, monkeypatch):
    monkeypatch.setattr(main, "LIMIT_PER_INSTALL", 2)
    assert post(client, {"terms": ["蓄音機"]}).status_code == 200
    assert post(client, {"terms": ["蓄音機"]}).status_code == 200  # 覚えた答えを返すときも数える
    r = post(client, {"terms": ["手風琴"]})
    assert r.status_code == 429
    assert r.json() == {"ok": False, "error": "rate_limited"}
    # ほかのインストールは数えが別
    assert post(client, {"terms": ["手風琴"]}, {"X-RS-Install": str(uuid.uuid4())}).status_code == 200


def test_IPごと_全体の上限も効く(client, fake, monkeypatch):
    monkeypatch.setattr(main, "LIMIT_PER_IP", 1)
    assert post(client, {"terms": ["蓄音機"]}).status_code == 200
    assert post(client, {"terms": ["蓄音機"]}, {"X-RS-Install": str(uuid.uuid4())}).status_code == 429
    main._mem_counts.clear()
    monkeypatch.setattr(main, "LIMIT_PER_IP", 400)
    monkeypatch.setattr(main, "LIMIT_GLOBAL", 1)
    assert post(client, {"terms": ["蓄音機"]}).status_code == 200
    assert post(client, {"terms": ["蓄音機"]}, {"X-RS-Install": str(uuid.uuid4()), "X-Forwarded-For": "203.0.113.9"}).status_code == 429


def test_RS_ALLOWED_ORIGINSがあると_ほかのオリジンは403(client, fake, monkeypatch):
    ext = "chrome-extension://" + "a" * 32
    monkeypatch.setattr(main, "ALLOWED_ORIGINS", [ext])
    assert post(client, {"terms": TERMS}, {**HEAD, "Origin": "chrome-extension://" + "b" * 32}).status_code == 403
    assert post(client, {"terms": TERMS}, {**HEAD, "Origin": ext}).status_code == 200


def test_CORSは拡張のオリジンにだけ返す(client):
    preflight = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-rs-install"}
    ext = "chrome-extension://" + "abcdefghijklmnop" * 2
    ok = client.options("/trivia", headers={**preflight, "Origin": ext})
    assert ok.headers.get("access-control-allow-origin") == ext
    ng = client.options("/trivia", headers={**preflight, "Origin": "https://example.com"})
    assert "access-control-allow-origin" not in ng.headers


# ---- 出口: 返すもの -----------------------------------------------------------


def test_言い切れるうんちくを返す_同じ候補には覚えた答えを返す(client, fake):
    fake.reply = {"text": SAID, "term": "活動写真館", "kind": "word", "sure": True}
    r = post(client, {"terms": TERMS})
    assert r.json() == {"ok": True, "trivia": {"text": SAID, "term": "活動写真館"}}
    assert post(client, {"terms": list(reversed(TERMS))}).json() == r.json()
    assert len(fake.calls) == 1


@pytest.mark.parametrize(
    ("reply", "error"),
    [
        ({"text": SAID, "term": "活動写真館", "sure": False}, "nothing_certain"),
        ({"text": "", "term": "活動写真館", "sure": True}, "nothing_certain"),
        ({"text": SAID, "term": "映画館", "sure": True}, "unknown_term"),  # 候補に無い語
        ({"text": "ゴロゴロは雷の音なんだって!", "term": "ゴロゴロ", "sure": True}, "soundish_term"),
        ({"text": "あ" * 91, "term": "活動写真館", "sure": True}, "rejected_text"),
        ({"text": "詳しくは https://example.com を見てね", "term": "活動写真館", "sure": True}, "rejected_text"),
    ],
)
def test_生成を検めて_だめなものは返さない(client, fake, reply, error):
    fake.reply = {"kind": "word", **reply}
    r = post(client, {"terms": [*TERMS, "ゴロゴロ"]})
    assert r.json() == {"ok": False, "error": error}


@pytest.mark.parametrize(
    ("setup", "error"),
    [
        (lambda f: setattr(f, "stop_reason", "refusal"), "refusal"),
        (lambda f: setattr(f, "stop_reason", "max_tokens"), "truncated"),
        (lambda f: setattr(f, "raw", "{壊れた"), "bad_json"),
    ],
)
def test_拒否_途中で切れた_壊れたJSONは返さない(client, fake, setup, error):
    setup(fake)
    assert post(client, {"terms": TERMS}).json() == {"ok": False, "error": error}


def _status_error():
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return anthropic.InternalServerError("内部の詳細", response=httpx.Response(500, request=req), body=None)


@pytest.mark.parametrize(
    "error",
    [_status_error(), anthropic.APITimeoutError(request=httpx.Request("POST", "https://api.anthropic.com")), RuntimeError("内部の詳細")],
)
def test_Anthropicに届かないときは中身を返さない(client, fake, error):
    fake.error = error
    r = post(client, {"terms": TERMS})
    assert r.status_code == 200
    assert r.json() == {"ok": False, "error": "unavailable"}
    assert "内部の詳細" not in r.text


def test_ログに単語も生成文も出さない(client, fake, monkeypatch, capsys):
    fake.reply = {"text": SAID, "term": "活動写真館", "kind": "word", "sure": True}
    post(client, {"terms": TERMS})  # 話せた
    fake.reply = {"text": SAID, "term": "映画館", "kind": "word", "sure": True}
    post(client, {"terms": ["蓄音機"]})  # 検めて捨てた
    fake.error = _status_error()
    post(client, {"terms": ["手風琴"]})  # 届かなかった
    monkeypatch.setattr(main, "LIMIT_PER_INSTALL", 0)
    post(client, {"terms": ["譜面台"]})  # 回数の上限

    out = capsys.readouterr().out
    lines = [json.loads(line) for line in out.splitlines() if line.strip()]
    assert [line["status"] for line in lines] == ["end_turn", "end_turn", "api_error", "rate_limited"]
    for word in [*TERMS, "蓄音機", "手風琴", "譜面台", "映画館", SAID]:
        assert word not in out


def test_擬音らしい語_拡張と同じ表(terms_table):
    for w in terms_table["sound"]:
        assert main._looks_like_sound(w), w
    for w in terms_table["word"]:
        assert not main._looks_like_sound(w), w
