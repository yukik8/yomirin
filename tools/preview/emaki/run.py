"""章の絵巻の試作(#51): 本を1ページずつ読み進め、端末が決めた回に Claude を呼び、記録を runs/ に書く。
絵巻は読んだ話を演じる(場面が移ると次の区画へ流れ、物が所から所へ動き、灯る)。

    server/.venv/bin/python tools/preview/emaki/run.py --book torokko                  # 下調べあり・読み取り Sonnet・描く Opus
    server/.venv/bin/python tools/preview/emaki/run.py --book torokko --no-brief       # 下調べなし(比べる)
    server/.venv/bin/python tools/preview/emaki/run.py --book torokko --start 6        # 6ページ目から読み始める(途中から)
    server/.venv/bin/python tools/preview/emaki/run.py --book ginga --chapters 6       # 銀河鉄道の夜の6章まで
    server/.venv/bin/python tools/preview/emaki/run.py --book torokko --reader claude-haiku-5-5 --drawer claude-sonnet-5-5
    server/.venv/bin/python tools/preview/emaki/run.py --unknown                       # 知らない本の下調べだけ(books.json の unknown)

区切り・送るもの・描くかどうか・返ってきたものの検めは、端末の側(emaki.js。device.mjs で呼ぶ)が決める。
ここはサーバの役(Claude への指示と呼び出し)だけ。指示は、見込みが立てば server/main.py に移す。
API キーは環境変数 ANTHROPIC_API_KEY(無ければ server/.env の同じ名前)。費用がかかる(見込みは README)。
記録は1回呼ぶごとに書く。途中で止まったら、同じ引数でもう一度動かすと続きから(終わった記録は作り直さない。消すと作り直す)。
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import anthropic

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RUNS = HERE / "runs"
FORMAT = 2  # 記録の形の版。2 は、所(spots)と動き(beats)を描く係に返させる形(1 は、描き足すだけで物が動かない形)

# 端末の画風に任せる部分は、#50 の generate.py と同じ言い方にそろえる
BRIEF_SYSTEM = (
    "あなたは読書アプリの裏方。書名と著者を受け取り、その本について、あなたが確かに知っていることを書く。"
    "読者には見せない。挿絵を描くときに、場面を読み違えないための下調べに使う。\n"
    "- その本を確かに知っているときだけ known を yes にする。題が同じ・似ている別の本と取り違えていないか、著者で確かめる。"
    "知らない・自信がない・著者が合わないときは known を no にし、ほかは空にする。推測で埋めない。\n"
    "- whole は始まりから結末までのあらすじ(800字まで)。順を追って、場所と時の移り変わりが分かるように書く。\n"
    "- world は時代・土地・季節・建物や道具の様子(200字まで)。"
)

READ_SYSTEM = (
    "あなたは読書アプリの読み取り係。読者がいま読み終えたページ(<新しく読んだ段落>)を受け取り、"
    "余白の挿絵のための場面メモを書く。挿絵は章ごとの絵巻で、読んだ話を演じる: 場面が移ると次の区画へ流れ、"
    "同じ場面のうちは物が動く・現れる・去る・灯る・日が暮れる。メモは読者には見せず、描く係と端末に渡す。\n"
    "ネタバレの決まり(いちばん大事):\n"
    "- <下調べ> はこの本の全体(結末まで)。誰が・どこで・何が起きているかを読み違えないためだけに使う。\n"
    "- 書いてよいのは、<新しく読んだ段落> と、それより前に読んだこと(<ここまでの話>)から分かることだけ。"
    "この先に起きること・明かされること・物の正体や行く末は、言い換えやほのめかしも含めて書かない。"
    "雰囲気も、いま読んだ所のものにする(この先を先取りしない)。\n"
    "- quote は <新しく読んだ段落> からそのまま写す(40字まで・言い換えない・前の段落からは写さない)。"
    "写せる語句が無いものは書かない。端末が照らし合わせ、段落に無い語句を付けたものは捨てる。\n"
    "書くもの:\n"
    "- seed: 「seed: 頼む」のときだけ。本の始まりから <新しく読んだ段落> の直前までのあらすじ(300字まで)。"
    "段落が本の始まりなら空。「seed: 頼まない」なら空。\n"
    "- events: <新しく読んだ段落> で起きたこと(順に・4つまで・各60字まで)。\n"
    "- scenes: 段落の中の場面を、読んだ順に2つまで。段落の最後の場面は必ず入れる。"
    "段落の中で場面が三つ以上あるときは、話の上でいちばん大事な場面と、最後の場面にする。\n"
    "  - change: 一つ前の場面(最初は <いまの場面>)から、場所が移った・時が大きく飛んだ・夢や回想に入ったら new(絵巻が流れて次の区画へ進む)。"
    "道のりでも、見えている景色の主な物(畑・林・海・店など)が替わったら new。同じ場所で物が動く・増える・灯る・日が暮れるだけなら same。"
    "<いまの場面> が無ければ new。\n"
    "  - time・weather・mood は決まった語から選び、根拠の語句を写す。本文から分からなければ unknown にし、語句は空。"
    "same の場面で時刻が移ったら(日が暮れた・夜が明けた)、新しい時刻を書く。\n"
    "  - keep: new のときだけ。一つ前の場面の物のうち、この場面にも続けて見える物の名前(名前はそのまま)。\n"
    "  - things: この場面に新しく出てきた、絵に描ける物(物・建物・乗り物・道・植物・動物・空や水・光)。"
    "一つ前の場面の物や keep に有る物は入れない。人は入れない(人の姿・顔・手・影も)。主な物から順に、場面の絵に要る物だけ(keep と合わせて6つほどまで)。\n"
    "  - changes: この場面の物の形が変わったとき(積み上がる・壊れる)。描き直す。名前はそのまま。\n"
    "  - beats: same のときだけ。<いまの場面の物> が動いた(所へ)・去った・灯った・消えたことを、読んだ順に。"
    "move の to は <いまの場面の所> の名前から選ぶ(合う所が無ければ書かない)。人が押す・乗る・運ぶ物も、物の動きとして書く。"
)

DRAW_SYSTEM = (
    "あなたは読書アプリの挿絵描きで、演出家。読者が読み進めている本の、章ごとの絵巻の一区画(いまの場面)を描く。"
    "絵は読んだ話を演じる: 物は、話に沿って区画の中の所(spots)を動き、去り、灯る。"
    "絵は形のデータで返す。SVG の path の d を、決まった層に分けて書く。キャンバスは横320・縦240(viewBox 0 0 320 240)。"
    "画風(色鉛筆の線の揺れ・水彩のにじみ・紙の質感・光の輪)と動き(所から所への移り)は表示する側が付けるので、形・色の名前・所・動きだけを決める。\n"
    "- 描くのは <物> の一覧の物と、場所の地(空・地面・壁・水面)だけ。一覧に無い物を足さない。物は id ごとに返す(一覧に無い id は捨てられる)。\n"
    "- <ここまでの話> は、構図と色を話に沿わせるために使う(いまの場面が話の中でどんな時かを、置き方・大きさ・明るさ・色で表す)。"
    "話の出来事そのものや人物は描かない。\n"
    "- 人物は描かない(人の姿・顔・手・影も)。文字・数字・記号・吹き出し・題は描かない。\n"
    "- spots: 物が居られる所・動いて行ける所を、名前と座標で決める(坂の上・坂の下・茶店の前・画面の外の左など)。"
    "y は物の足もとが来る高さ。scale は、その所での物の大きさ(奥は小さく、手前は大きく)。"
    "動く物(乗り物・持ち運べる物・動物・日や月)が、話の中で行き来しそうな所を用意する。\n"
    "- 物ごとに、at(足もとの点)・spot(いま居る所。動かない物は空)・lit(灯りがいま灯っているか)を書く。"
    "物は spot の所に、at がその所の座標に来るように描く。\n"
    "- mode が new: 新しい区画。地と、一覧の物をすべて描き、所を決める。物は <この回の出来事> の最初の出来事の前の様子で描き、"
    "beats に、出来事に沿った動き(どの出来事で、どの物が、どこへ動く・去る・灯る・消える)を順に書く。\n"
    "- mode が add: <いまの絵> と所はそのまま残る。「描く」の付いた物だけを返す(新しく出た物と、形が変わった物。変わった物は前の形と置き換わる)。"
    "いまの構図を崩さず、空いている所か、話に合う所に置く。地は返さない。所は、足す所だけ。beats は空。\n"
    "層: forms は物の面(奥から手前の順)。lines は色鉛筆の線で、物の輪郭は面とは別に必ず線でも描く。陰影・模様・細部の線も足す。"
    "light は光るものそのものの形(灯り・星・光る物・水面のきらめき)。\n"
    "d はコマンド(M L H V C S Q T A Z と小文字)と数字だけ。同じ色の小さな形は、一つの d に複数の M でまとめる。"
    "主役を大きく、はっきり描き、小さく表示しても何の場面か分かる構図にする。"
)

SUMMARY_SYSTEM = (
    "あなたは読書アプリの裏方。読者が読み終えた章の出来事の一覧を受け取り、章のまとめを書く(200字まで)。"
    "一覧に無いことは書かない(この先のことも書かない)。読者には見せず、次の章の挿絵のために使う。"
)

JUDGE_SYSTEM = (
    "あなたは読書アプリの検査役。余白の挿絵の係が、読者がまだ読んでいない所の情報を使っていないかを調べる。\n"
    "渡すもの: 本の全文(ページ番号つき)と、回ごとに「何ページまで読んだか」と、そのとき端末に残っていて描く係に渡るもの"
    "(ここまでの話・場面・物の名前と見た目・描いたか)。\n"
    "回ごとに、読んだ所より後で初めて分かること(出来事・物・場所・物の正体や行く末・この先を先取りした雰囲気)が入っていないかを見る。"
    "読んだ所までに書いてあることや、そこから素直に分かることはネタバレではない。"
    "迷うものは spoiler を true にし、何ページで初めて分かることかを書く。渡した回はすべて判定する。"
)


def _api_key() -> str | None:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return os.environ["ANTHROPIC_API_KEY"]
    env = ROOT / "server" / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "ANTHROPIC_API_KEY":
                return value.strip().strip('"').strip("'")
    return None


def device(op: str, payload: dict | None = None) -> dict:
    out = subprocess.run(["node", str(HERE / "device.mjs"), op], input=json.dumps(payload or {}, ensure_ascii=False), check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def call(client: anthropic.Anthropic, model: str, effort: str, system: list[dict], user: str, schema: dict, max_tokens: int) -> dict:
    """1回呼んで記録を返す。構造化出力・ストリーミング。Opus・Sonnet ではサーバ側のフォールバックを付ける(server/main.py と同じ)"""
    params = dict(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    )
    if not model.startswith("claude-haiku"):
        params.update(betas=["server-side-fallback-2026-07-01"], extra_body={"fallbacks": "default"})
    record = {"model": model, "effort": effort}
    started = time.monotonic()
    try:
        with client.beta.messages.stream(**params) as stream:
            message = stream.get_final_message()
            request_id = stream.request_id
    except anthropic.APIStatusError as e:
        return {**record, "ms": round((time.monotonic() - started) * 1000), "error": f"api_error {e.status_code}", "request_id": getattr(e, "request_id", None), "data": None}
    except anthropic.APIConnectionError as e:
        return {**record, "ms": round((time.monotonic() - started) * 1000), "error": type(e).__name__, "data": None}
    usage = message.usage
    record.update(
        served_model=message.model,
        ms=round((time.monotonic() - started) * 1000),
        usage={
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "cache_creation_input_tokens": usage.cache_creation_input_tokens or 0,
            "cache_read_input_tokens": usage.cache_read_input_tokens or 0,
        },
        stop_reason=message.stop_reason,
        request_id=request_id,
    )
    text = next((b.text for b in message.content if b.type == "text"), None)
    if message.stop_reason != "end_turn" or text is None:
        return {**record, "data": None, "raw": text}
    try:
        record["data"] = json.loads(text)
    except json.JSONDecodeError:
        record.update(data=None, raw=text)
    return record


def cached(*texts: str) -> list[dict]:
    """system を区切りごとに渡し、最後の区切りまでをキャッシュする(下調べは本ごとに同じ)"""
    blocks = [{"type": "text", "text": t} for t in texts]
    blocks[-1]["cache_control"] = {"type": "ephemeral"}
    return blocks


def story_text(story: dict) -> str:
    parts = []
    if story["seed"]:
        parts.append(f"(読み始める前のあらすじ){story['seed']}")
    for i, summary in enumerate(story["chapters"], 1):
        parts.append(f"(前の章 {i}){summary}")
    if story["events"]:
        parts.append("(この章)" + " / ".join(story["events"]))
    return "\n".join(parts) or "(まだ無い)"


def scene_text(scene: dict | None) -> str:
    if not scene:
        return "(無い。この章の最初)"
    return f"場所: {scene['place'] or '分からない'} / 時刻: {scene['time']} / 天気: {scene['weather']} / 雰囲気: {scene['mood']}"


def brief_text(brief: dict | None) -> str:
    if not brief:
        return "<下調べ>\n無い(この本を知らない)。読んだ所だけで読み取る。\n</下調べ>"
    return f"<下調べ>\n作品: {brief['work']}\n全体: {brief['whole']}\n世界: {brief['world']}\n</下調べ>"


def read_message(req: dict) -> str:
    def thing(t: dict) -> str:
        state = [f"所: {t['spot']}" if t["spot"] else "", "" if t["shown"] else "去った", "" if t["lit"] else "灯っていない"]
        return f"{t['name']}({t['look']}){'・'.join(x for x in state if x)}"

    things = "\n".join(thing(t) for t in req["things"]) or "(無い)"
    return (
        f"<ここまでの話>\n{story_text(req['story'])}\n</ここまでの話>\n"
        f"<いまの場面>{scene_text(req['scene'])}</いまの場面>\n"
        f"<いまの場面の物>\n{things}\n</いまの場面の物>\n"
        f"<いまの場面の所>{'・'.join(req['spots']) or '(無い)'}</いまの場面の所>\n"
        f"<新しく読んだ段落>\n{req['text']}\n</新しく読んだ段落>\n"
        f"seed: {'頼む' if req['seed'] else '頼まない'}"
    )


def draw_message(req: dict) -> str:
    def thing(t: dict) -> str:
        marks = [m for m, on in (("主役", t["main"]), ("描く", t["draw"]), (f"所: {t['spot']}", t["spot"])) if on]
        return f"{t['id']} {t['name']}({t['look']}){'・'.join(marks)}"

    text = (
        f"mode: {req['mode']}\n"
        f"<ここまでの話>\n{story_text(req['story'])}\n</ここまでの話>\n"
        f"<場面>{scene_text(req['scene'])}</場面>\n"
        f"<物>\n" + "\n".join(thing(t) for t in req["things"]) + "\n</物>"
    )
    if req["mode"] == "new":
        events = "\n".join(f"{i} {e}" for i, e in enumerate(req["events"])) or "(無い)"
        text += f"\n<この回の出来事>\n{events}\n</この回の出来事>"
    if req["current"]:
        text += f"\n<所>\n{json.dumps(req['spots'], ensure_ascii=False)}\n</所>"
        text += f"\n<いまの絵>\n{json.dumps(req['current'], ensure_ascii=False)}\n</いまの絵>"
    return text


def judge_message(req: dict) -> str:
    rows = []
    def state(x: dict) -> str:
        marks = ["描いた" if x["drawn"] else "", f"所: {x['spot']}" if x["spot"] else "", "" if x["shown"] else "去った", "" if x["lit"] else "灯っていない"]
        return "・".join(m for m in marks if m)

    for t in req["ticks"]:
        things = "、".join(f"{x['name']}({x['look']}){state(x)}" for x in t["things"]) or "(無い)"
        rows.append(f"回 {t['tick']}: {t['read_to_page']}ページまで読んだ\n  ここまでの話: {story_text(t['story'])}\n  場面: {scene_text(t['scene'])}\n  物: {things}")
    return f"<本文>\n{req['text']}\n</本文>\n<回ごと>\n" + "\n".join(rows) + "\n</回ごと>"


def label(args: argparse.Namespace) -> str:
    short = lambda m: m.removeprefix("claude-").split("-")[0]  # noqa: E731
    parts = [args.book, "brief" if args.brief else "nobrief", f"{short(args.reader)}-{short(args.drawer)}"]
    if args.start:
        parts.append(f"from{args.start}")
    if args.chapters:
        parts.append(f"ch{args.chapters}")
    return ".".join(parts + [str(args.run)])


def save(path: Path, run: dict) -> None:
    path.write_text(json.dumps(run, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def index() -> None:
    files = sorted(p.name for p in RUNS.glob("*.json") if p.name != "index.json")
    (RUNS / "index.json").write_text(json.dumps({"files": files}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def unknown_briefs(client: anthropic.Anthropic, schemas: dict, args: argparse.Namespace) -> int:
    path = RUNS / "unknown.json"
    if path.exists():
        print(f"{path.name}: もうある(消すと作り直す)")
        return 0
    titles = device("book", {"id": "torokko"})["unknown"]
    results = []
    for t in titles:
        rec = call(client, args.brief_model, args.effort, cached(BRIEF_SYSTEM), f"書名: {t['title']}\n著者: {t['author']}", schemas["brief"], 4000)
        results.append({**t, "record": rec})
        print(f"{t['title']} / {t['author']}: {(rec.get('data') or {}).get('known', rec.get('error'))}")
    save(path, {"unknown": results})
    index()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--book", help="books.json の id(torokko・lemon・ginga)")
    parser.add_argument("--brief", action=argparse.BooleanOptionalAction, default=True, help="書名から下調べを作って読み取りに渡す")
    parser.add_argument("--start", type=int, default=0, help="何ページ目から読み始めるか(試写室のページ番号。省略で最初から)")
    parser.add_argument("--chapters", type=int, default=0, help="何章まで読むか(0 は最後まで)")
    parser.add_argument("--reader", default="claude-sonnet-5-5")
    parser.add_argument("--drawer", default="claude-opus-5-5")
    parser.add_argument("--brief-model", default="claude-opus-5-5")
    parser.add_argument("--judge-model", default="claude-opus-5-5")
    parser.add_argument("--judge", action=argparse.BooleanOptionalAction, default=True, help="読み終えたら判定役に、ネタバレが無いかを見させる")
    parser.add_argument("--effort", default="medium", choices=["low", "medium", "high", "xhigh", "max"])
    parser.add_argument("--run", type=int, default=1)
    parser.add_argument("--unknown", action="store_true", help="知らない本の下調べだけを確かめる")
    args = parser.parse_args()

    key = _api_key()
    if not key:
        print("ANTHROPIC_API_KEY がありません(環境変数か server/.env)", file=sys.stderr)
        return 1
    client = anthropic.Anthropic(api_key=key, max_retries=1)
    schemas = device("schemas")
    RUNS.mkdir(exist_ok=True)
    if args.unknown:
        return unknown_briefs(client, schemas, args)
    if not args.book:
        parser.error("--book か --unknown を付ける")
    book = device("book", {"id": args.book})
    if "error" in book:
        print(f"本 {args.book} がありません: {book['books']}", file=sys.stderr)
        return 1

    path = RUNS / f"{label(args)}.json"
    run = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    if run and run.get("format") != FORMAT:
        print(f"{path.name}: 前の形の記録なので続きから回せない(名前を変えるか消すと、新しく作る)", file=sys.stderr)
        return 1
    if run and run.get("finished"):
        print(f"{path.name}: もうある(消すと作り直す)")
        return 0
    if not run:
        settings = {**book["settings"], "start": max(args.start - 1, 0), "chapters": args.chapters or None}
        run = {"format": FORMAT, "book": args.book, "label": path.stem, "settings": settings, "models": {"brief": args.brief_model if args.brief else None, "reader": args.reader, "drawer": args.drawer, "summary": args.reader, "judge": args.judge_model}, "brief": None, "ticks": []}
        if args.brief:
            # 書名と著者だけを渡す(本文は渡さない)
            run["brief"] = call(client, args.brief_model, args.effort, cached(BRIEF_SYSTEM), f"書名: {book['title']}\n著者: {book['author']}", schemas["brief"], 4000)
            print(f"下調べ: {(run['brief'].get('data') or {}).get('known', run['brief'].get('error'))} {run['brief']['ms'] / 1000:.1f}秒")
        save(path, run)
    brief = (run["brief"] or {}).get("data")
    brief = brief if brief and brief.get("known") == "yes" else None

    while True:
        step = device("next", {"run": run})
        if step["op"] == "done":
            break
        req = step["request"]
        if step["op"] == "read":
            rec = call(client, args.reader, args.effort, cached(READ_SYSTEM, brief_text(brief)), read_message(req), schemas["read"], 16000)
            run["ticks"].append({**step["tick"], "reader": rec, "drawers": [], "summary": None})
            a, b = (n + 1 for n in step["tick"]["pages"])
            what = f"{a}{f'〜{b}' if b > a else ''}ページ 読み取り"
        elif step["op"] == "draw":
            rec = call(client, args.drawer, args.effort, cached(DRAW_SYSTEM), draw_message(req), schemas["draw"], 32000)
            run["ticks"][-1]["drawers"].append(rec)
            what = f"  描く({step['draw']['mode']}・{len(step['draw']['ids'])}つ)"
        else:
            events = "\n".join(f"- {e}" for e in req["events"]) or "(無い)"
            rec = call(client, args.reader, args.effort, cached(SUMMARY_SYSTEM), f"<この章の出来事>\n{events}\n</この章の出来事>", schemas["summary"], 4000)
            run["ticks"][-1]["summary"] = rec
            what = "  章のまとめ"
        save(path, run)
        usage = rec.get("usage") or {}
        print(f"{what}: {rec.get('stop_reason') or rec.get('error')} {rec['ms'] / 1000:.1f}秒 出力 {usage.get('output_tokens', '—')}")

    if args.judge and not run.get("judge"):
        req = device("judge", {"run": run})
        run["judge"] = call(client, args.judge_model, args.effort, cached(JUDGE_SYSTEM), judge_message(req), schemas["judge"], 16000)
        flagged = [t["tick"] for t in (run["judge"].get("data") or {}).get("ticks", []) if t.get("spoiler")]
        print(f"判定役: {run['judge'].get('stop_reason') or run['judge'].get('error')} ネタバレの疑い {flagged or 'なし'}")
    run["finished"] = True
    save(path, run)
    index()
    return 0


if __name__ == "__main__":
    sys.exit(main())
