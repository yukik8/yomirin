"""サーバのテストの土台。本物の Anthropic と Upstash は使わない(課金と鍵)。

    cd server && ./.venv/bin/python -m pytest

main.py は import のときに環境変数と server/.env を読むので、その前に置いておく
(.env は「まだ無い変数だけ」埋めるので、ここで置いたものが勝つ)。
"""

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

SERVER = Path(__file__).resolve().parents[1]
FIXTURES = SERVER.parent / "tests" / "fixtures"

os.environ.update(
    {
        "ANTHROPIC_API_KEY": "test-dummy",  # 偽の client に差し替えるので使われない
        "UPSTASH_REDIS_REST_URL": "",  # 回数はメモリで数える
        "UPSTASH_REDIS_REST_TOKEN": "",
        "KV_REST_API_URL": "",
        "KV_REST_API_TOKEN": "",
        "RS_ALLOWED_ORIGINS": "",
    }
)
sys.path.insert(0, str(SERVER))

import main  # noqa: E402


class FakeMessages:
    """client.beta.messages の代わり。返すもの(または投げる例外)を決めておき、呼ばれた引数を残す。"""

    def __init__(self):
        self.calls = []
        self.reply = {"text": "", "term": "", "kind": "word", "sure": False}
        self.stop_reason = "end_turn"
        self.raw = None  # 文字列を置くと、JSON にせずそのまま返す
        self.error = None

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        text = self.raw if self.raw is not None else json.dumps(self.reply, ensure_ascii=False)
        return SimpleNamespace(
            stop_reason=self.stop_reason,
            content=[SimpleNamespace(type="text", text=text)],
            usage=SimpleNamespace(input_tokens=10, output_tokens=20),
            _request_id="req_test",
        )


@pytest.fixture
def fake(monkeypatch):
    messages = FakeMessages()
    monkeypatch.setattr(main, "client", SimpleNamespace(beta=SimpleNamespace(messages=messages)))
    monkeypatch.setattr(main, "_REDIS_URL", None)
    monkeypatch.setattr(main, "ALLOWED_ORIGINS", [])
    main._cache.clear()
    main._mem_counts.clear()
    return messages


@pytest.fixture
def client(fake):
    from fastapi.testclient import TestClient

    return TestClient(main.app)


@pytest.fixture
def terms_table():
    return json.loads((FIXTURES / "terms.json").read_text(encoding="utf-8"))
