"""クイズと問い(/quiz・/ask)のテスト。本文を受け取る受け口なので、入口の上限と「残さない」を確かめる。

拡張の開発版で、本人がオンにしたときだけ呼ばれる(ストア版は呼ばない・docs/design.md §9・§11-7)。
本文・問い・生成文はログに出さない(README)。

    cd server && ./.venv/bin/python -m pytest
"""

import json
import uuid

import pytest

import main

ID = str(uuid.uuid4())
HEAD = {"X-RS-Install": ID}
PARA = "ゴーシュは町の活動写真館でセロを弾く係りでした。けれどもあんまり上手でないという評判でした。" * 2
QUIZ = {"question": "ゴーシュの係りは?", "choices": ["セロを弾く", "切符を売る", "絵を描く"], "answer_index": 0}
ANSWER = "セロを弾く係りでした。"


def quiz_body(**extra):
    return {"text": PARA, "focus": "", **extra}


def ask_body(**extra):
    return {"question": "ゴーシュの係りは?", "selection": "", "context": [{"i": 3, "text": PARA}], "judge": False, **extra}


# ---- 入口 -------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/quiz", "/ask"])
@pytest.mark.parametrize("headers", [{}, {"X-RS-Install": "not-a-uuid"}])
def test_インストールIDが無い_形が違うと401(client, fake, path, headers):
    body = quiz_body() if path == "/quiz" else ask_body()
    assert client.post(path, json=body, headers=headers).status_code == 401
    assert fake.calls == []


@pytest.mark.parametrize(
    "body",
    [
        quiz_body(title="セロ弾きのゴーシュ"),  # 書名などのほかの項目
        quiz_body(url="https://play.google.com/books/reader?id=x"),
        {"text": "短い"},  # 読み終えた本文が短すぎる
        {"text": "あ" * 2001},  # 拡張が切り詰める長さを超えた
        quiz_body(focus="あ" * 601),
    ],
)
def test_クイズは決まった項目と長さのほかは受けない(client, fake, body):
    assert client.post("/quiz", json=body, headers=HEAD).status_code == 422
    assert fake.calls == []


@pytest.mark.parametrize(
    "body",
    [
        ask_body(title="セロ弾きのゴーシュ"),
        ask_body(question=""),
        ask_body(question="あ" * 301),
        ask_body(selection="あ" * 501),
        ask_body(context=[{"i": n, "text": "段落"} for n in range(9)]),  # 9段落
        ask_body(context=[{"i": 0, "text": "あ" * 801}]),
        ask_body(context=[{"i": 0, "text": "段落", "page": 3}]),
        {"question": "係りは?", "context": []},  # judge が無い
    ],
)
def test_問いは決まった項目と長さのほかは受けない(client, fake, body):
    assert client.post("/ask", json=body, headers=HEAD).status_code == 422
    assert fake.calls == []


def test_回数の上限はうんちくと同じものを数える(client, fake, monkeypatch):
    monkeypatch.setattr(main, "LIMIT_PER_INSTALL", 2)
    fake.reply = QUIZ
    assert client.post("/quiz", json=quiz_body(), headers=HEAD).status_code == 200
    assert client.post("/trivia", json={"terms": ["活動写真館"]}, headers=HEAD).status_code == 200
    assert client.post("/ask", json=ask_body(), headers=HEAD).status_code == 429
    assert client.post("/quiz", json=quiz_body(), headers=HEAD).status_code == 429
    assert len(fake.calls) == 2


# ---- 出口 -------------------------------------------------------------------


def test_クイズを返す_焦点は本文の中にあるときだけ渡す(client, fake):
    fake.reply = QUIZ
    r = client.post("/quiz", json=quiz_body(focus="けれどもあんまり上手でないという評判でした。"), headers=HEAD)
    assert r.json() == {"ok": True, "quiz": QUIZ}
    assert "特に次の箇所" in fake.calls[0]["messages"][0]["content"]
    client.post("/quiz", json=quiz_body(focus="本文に無い一文"), headers=HEAD)
    assert "特に次の箇所" not in fake.calls[1]["messages"][0]["content"]


@pytest.mark.parametrize(
    "reply",
    [
        {**QUIZ, "choices": ["セロを弾く", "切符を売る"]},  # 2つ
        {**QUIZ, "choices": ["セロを弾く", "", "絵を描く"]},
        {**QUIZ, "answer_index": 3},
        {**QUIZ, "answer_index": True},
        {**QUIZ, "question": " "},
    ],
)
def test_形の合わないクイズは返さない(client, fake, reply):
    fake.reply = reply
    assert client.post("/quiz", json=quiz_body(), headers=HEAD).json() == {"ok": False, "error": "rejected_quiz"}


def test_答えを返す_根拠の番号は渡した段落のどれかだけ(client, fake):
    fake.reply = {"answer": ANSWER, "source_index": 3}
    assert client.post("/ask", json=ask_body(), headers=HEAD).json() == {"ok": True, "answer": ANSWER, "source_index": 3}
    fake.reply = {"answer": ANSWER, "source_index": 7}  # 渡していない番号
    assert client.post("/ask", json=ask_body(), headers=HEAD).json()["source_index"] == -1
    assert fake.calls[0]["system"] == main.ANSWER_SYSTEM


def test_judgeのときは_関係のない頼みごとを断る(client, fake):
    fake.reply = {"unrelated": True, "answer": "", "source_index": -1}
    r = client.post("/ask", json=ask_body(question="Pythonで累積和を出すコード", judge=True), headers=HEAD)
    assert r.json() == {"ok": False, "error": "off_topic"}
    assert fake.calls[0]["system"] == main.JUDGED_ANSWER_SYSTEM
    fake.reply = {"unrelated": False, "answer": ANSWER, "source_index": 3}
    assert client.post("/ask", json=ask_body(judge=True), headers=HEAD).json()["ok"] is True


@pytest.mark.parametrize("answer", ["", "あ" * 601, "詳しくは https://example.com を見てね"])
def test_空_長すぎる_URL入りの答えは返さない(client, fake, answer):
    fake.reply = {"answer": answer, "source_index": -1}
    assert client.post("/ask", json=ask_body(), headers=HEAD).json() == {"ok": False, "error": "rejected_answer"}


def test_拒否_途中で切れたものは返さない(client, fake):
    fake.stop_reason = "refusal"
    assert client.post("/quiz", json=quiz_body(), headers=HEAD).json() == {"ok": False, "error": "refusal"}
    fake.stop_reason = "max_tokens"
    assert client.post("/ask", json=ask_body(), headers=HEAD).json() == {"ok": False, "error": "truncated"}


def test_ログに本文も問いも生成文も出さない(client, fake, monkeypatch, capsys):
    fake.reply = QUIZ
    client.post("/quiz", json=quiz_body(focus="けれどもあんまり上手でないという評判でした。"), headers=HEAD)
    fake.reply = {"answer": ANSWER, "source_index": 3}
    client.post("/ask", json=ask_body(selection="活動写真館"), headers=HEAD)
    fake.raw = "{壊れた"
    client.post("/ask", json=ask_body(), headers=HEAD)
    monkeypatch.setattr(main, "LIMIT_PER_INSTALL", 0)
    client.post("/quiz", json=quiz_body(), headers=HEAD)

    out = capsys.readouterr().out
    lines = [json.loads(line) for line in out.splitlines() if line.strip()]
    assert [(line["event"], line["status"]) for line in lines] == [
        ("quiz", "end_turn"),
        ("ask", "end_turn"),
        ("ask", "end_turn"),
        ("quiz", "rate_limited"),
    ]
    for word in ["ゴーシュ", "活動写真館", "評判", "セロを弾く", "切符", ANSWER, ID]:
        assert word not in out
