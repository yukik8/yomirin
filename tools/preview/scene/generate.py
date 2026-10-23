"""場面の絵の試作(#50): passages.json の節を Claude に渡し、形のデータを samples/ に保存する。

    server/.venv/bin/python tools/preview/scene/generate.py                       # Opus 5.5 で3場面 × 3回
    server/.venv/bin/python tools/preview/scene/generate.py --model claude-sonnet-5-5 --runs 1
    server/.venv/bin/python tools/preview/scene/generate.py --scene lemon --runs 1

API キーは環境変数 ANTHROPIC_API_KEY(無ければ server/.env の同じ名前)。費用がかかる(#50 の見込みは全部で $2 ほど)。
渡すのは本文だけ(書名・作者は渡さない。#34 で拡張が送るのも読み終えた段落だけ)。
JSON Schema は scene.js から取る(node tools/preview/scene/check.mjs --schema)。検査と集計は check.mjs。
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
SAMPLES = HERE / "samples"

SYSTEM = (
    "あなたは読書アプリの挿絵描き。渡された本文(読み終えたページ)の場面を、本の余白に置く小さな絵にする。"
    "絵は形のデータで返す。SVG の path の d を、決まった層に分けて書く。キャンバスは横320・縦240(viewBox 0 0 320 240)。"
    "画風(色鉛筆の線の揺れ・水彩のにじみ・紙の質感・光の輪)は表示する側が付けるので、形と色の名前だけを決める。\n"
    "描くもの: 本文に書いてある物・場所・光だけ。本文に無い物を足さない。この先の展開を推測して描かない。\n"
    "人物は描かない(人の姿・顔・手・影も)。人がいる場面でも、その場の物と景色だけを描く。"
    "文字・数字・記号・吹き出し・題は描かない。\n"
    "items: 描いた物ごとに、根拠になる本文の語句を、本文からそのまま写す(30字まで)。\n"
    "層: ground は奥の大きな面(空・壁・地面・水面)。forms は物の面で、奥から手前の順に並べる(手前の物が奥の物を隠す)。"
    "lines は色鉛筆の線。主な物の輪郭は、面とは別に必ず線でも描く(最初の段では線だけを見せるので、線だけで何の絵か分かるように)。"
    "陰影・模様・細部の線も足す。light は光るものそのものの形(灯り・星・光る物・水面のきらめき)。無ければ空でよい。\n"
    "d はコマンド(M L H V C S Q T A Z と小文字)と数字だけ。同じ色の小さな形は、一つの d に複数の M でまとめる。"
    "主役を大きく、はっきり描き、小さく表示しても何の場面か分かる構図にする。"
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


def _schema() -> dict:
    out = subprocess.run(["node", str(HERE / "check.mjs"), "--schema"], check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def generate(client: anthropic.Anthropic, schema: dict, passage: dict, model: str, effort: str, run: int) -> dict:
    params = dict(
        model=model,
        max_tokens=32000,
        system=SYSTEM,
        messages=[{"role": "user", "content": f"<本文>\n{passage['text']}\n</本文>\nこの場面の絵を描いて。"}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    )
    # 分類器がまれに拒否した場合もサーバ側で替わりのモデルに回す(server/main.py と同じ)。Haiku には無い
    if not model.startswith("claude-haiku"):
        params.update(betas=["server-side-fallback-2026-07-01"], extra_body={"fallbacks": "default"})
    record = {"scene": passage["id"], "model": model, "run": run, "effort": effort}
    started = time.monotonic()
    first_text = None
    try:
        with client.beta.messages.stream(**params) as stream:
            for event in stream:
                if first_text is None and event.type == "content_block_delta" and event.delta.type == "text_delta":
                    first_text = time.monotonic()
            message = stream.get_final_message()
            request_id = stream.request_id
    except anthropic.APIStatusError as e:
        return {**record, "ms": round((time.monotonic() - started) * 1000), "error": f"api_error {e.status_code}", "request_id": getattr(e, "request_id", None), "data": None}
    except anthropic.APIConnectionError as e:
        return {**record, "ms": round((time.monotonic() - started) * 1000), "error": type(e).__name__, "data": None}
    finished = time.monotonic()
    usage = message.usage
    record.update(
        served_model=message.model,
        ms=round((finished - started) * 1000),
        first_text_ms=round((first_text - started) * 1000) if first_text else None,
        usage={"input_tokens": usage.input_tokens, "output_tokens": usage.output_tokens},
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default="claude-opus-5-5")
    parser.add_argument("--effort", default="medium", choices=["low", "medium", "high", "xhigh", "max"])
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--scene", help="passages.json の id(省略で全部)")
    args = parser.parse_args()

    key = _api_key()
    if not key:
        print("ANTHROPIC_API_KEY がありません(環境変数か server/.env)", file=sys.stderr)
        return 1
    client = anthropic.Anthropic(api_key=key, max_retries=1)
    schema = _schema()
    passages = json.loads((HERE / "passages.json").read_text(encoding="utf-8"))["passages"]
    if args.scene:
        passages = [p for p in passages if p["id"] == args.scene]
        if not passages:
            print(f"場面 {args.scene} がありません", file=sys.stderr)
            return 1

    SAMPLES.mkdir(exist_ok=True)
    for passage in passages:
        for run in range(1, args.runs + 1):
            path = SAMPLES / f"{passage['id']}.{args.model}.{run}.json"
            if path.exists():
                print(f"{path.name}: もうある(消すと作り直す)")
                continue
            record = generate(client, schema, passage, args.model, args.effort, run)
            path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            usage = record.get("usage") or {}
            print(f"{path.name}: {record.get('stop_reason') or record.get('error')} {record['ms'] / 1000:.1f}秒 出力 {usage.get('output_tokens', '—')} トークン")
    subprocess.run(["node", str(HERE / "check.mjs"), "--index"], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
