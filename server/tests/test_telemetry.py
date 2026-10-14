"""使われ方の要約(/telemetry・#28)のテスト。受け取るのは表の項目だけで、値は数・真偽・決まった語だけ。
ログに項目の値も ID も出さない。消せる。

    cd server && ./.venv/bin/python -m pytest
    RS_TEST_DATABASE_URL=postgresql://... ./.venv/bin/python -m pytest   # 表まで確かめる(捨ててよい DB で)
"""

import json
import uuid

import psycopg
import pytest

import main

TID = str(uuid.uuid4())
HEAD = {"X-RS-Telemetry": TID}


def post(client, rows, headers=HEAD):
    return client.post("/telemetry", json={"rows": rows}, headers=headers)


def forget(client, headers=HEAD):
    return client.delete("/telemetry", headers=headers)


# ---- 入口: 受け取るもの -------------------------------------------------------


def test_要約を受け取って204を返すだけ_DBが無ければ捨てる(client, tm_rows, capsys):
    r = post(client, [tm_rows["session"], tm_rows["hello"]])
    assert r.status_code == 204
    assert r.content == b""  # θ・演出・画面に戻すものは無い(一方通行)
    (line,) = [json.loads(s) for s in capsys.readouterr().out.splitlines() if s.strip()]
    assert line == {"event": "telemetry", "op": "post", "status": "discarded", "rows": 2}


def test_項目は見本と同じ(tm_rows):
    # 拡張のテスト(tests/extension/invariants.test.mjs)も同じ見本と比べる
    assert set(main.TmSession.model_fields) == set(tm_rows["session"])
    assert set(main.TmHello.model_fields) == set(tm_rows["hello"])


def test_自由な文字列の項目が無い():
    """文字列を受ける項目は、決まった語(enum)・版の番号(pattern)・UUID・日付だけ。本文や書名が入る余地が型で無い。"""

    def free_strings(schema, name):
        for branch in schema.get("anyOf", [schema]):
            if branch.get("type") == "string" and not ({"enum", "const", "pattern"} & branch.keys()):
                if branch.get("format") not in ("uuid", "date"):
                    yield name

    for model in (main.TmSession, main.TmHello):
        props = model.model_json_schema()["properties"]
        assert [n for n, s in props.items() for n in free_strings(s, n)] == [], model.__name__


@pytest.mark.parametrize("headers", [{}, {"X-RS-Telemetry": "not-a-uuid"}, {"X-RS-Install": TID}])
def test_telemetry_idが無い_形が違うと401(client, tm_rows, headers):
    assert post(client, [tm_rows["session"]], headers).status_code == 401
    assert forget(client, headers).status_code == 401


@pytest.mark.parametrize(
    ("kind", "change"),
    [
        # 記録層の項目(本・本文・問い)は付いてきたら受けない
        ("session", {"title": "銀河鉄道の夜"}),
        ("session", {"page_id": "ab" * 32}),
        ("session", {"url": "https://play.google.com/books/reader?id=x"}),
        ("session", {"question": "「槌」の読み方は?"}),
        ("hello", {"ua": "Mozilla/5.0 ..."}),
        # 決まった語のところに自由な文字列
        ("session", {"controller_reason": "本文の段落"}),
        ("session", {"end_reason": "本文の段落"}),
        ("session", {"ext": "0.27 銀河鉄道"}),
        ("hello", {"goal": "本文の段落"}),
        ("hello", {"build": "beta"}),
        # 数のところに文字列・範囲の外
        ("session", {"read_ms": "本文の段落"}),
        ("session", {"read_ms": 86_400_001}),  # 24時間を超える
        ("session", {"theta": 9}),
        ("session", {"stability": 1.5}),
        ("session", {"completion_pct": 101}),
        ("session", {"hour": 24}),
        ("session", {"escapes": -1}),
        ("session", {"date": "きのう"}),
        ("session", {"session_id": "s-1"}),
        ("session", {"v": 2}),
        ("hello", {"chrome": 0}),
        # 項目が足りない・種類が違う
        ("session", {"read_ms": None}),
        ("session", {"kind": "page"}),
    ],
)
def test_表の項目と範囲のほかは422(client, tm_rows, kind, change):
    row = {**tm_rows[kind], **change}
    assert post(client, [row]).status_code == 422


def test_項目が欠けても_行の外に何か付いても_行が多すぎても422(client, tm_rows):
    missing = {k: v for k, v in tm_rows["session"].items() if k != "pace_wpm"}
    assert post(client, [missing]).status_code == 422
    r = client.post("/telemetry", json={"rows": [tm_rows["hello"]], "install_id": TID}, headers=HEAD)
    assert r.status_code == 422
    assert post(client, []).status_code == 422
    many = [{**tm_rows["session"], "session_id": str(uuid.uuid4())} for _ in range(main.TM_MAX_ROWS + 1)]
    assert post(client, many).status_code == 422
    assert post(client, many[: main.TM_MAX_ROWS]).status_code == 204


def test_回数の上限を超えると429(client, tm_rows, monkeypatch):
    monkeypatch.setattr(main, "TM_LIMIT_PER_ID", 2)
    assert post(client, [tm_rows["hello"]]).status_code == 204
    assert forget(client).status_code == 204  # 消すのも同じ数えに入る
    r = post(client, [tm_rows["hello"]])
    assert r.status_code == 429
    assert r.json() == {"ok": False, "error": "rate_limited"}
    # ほかの ID は数えが別。うんちくの数えとも別
    assert post(client, [tm_rows["hello"]], {"X-RS-Telemetry": str(uuid.uuid4())}).status_code == 204
    assert not any(k.startswith("rs:") for k in main._mem_counts)


def test_RS_ALLOWED_ORIGINSがあると_ほかのオリジンは403(client, tm_rows, monkeypatch):
    ext = "chrome-extension://" + "a" * 32
    monkeypatch.setattr(main, "ALLOWED_ORIGINS", [ext])
    assert post(client, [tm_rows["hello"]], {**HEAD, "Origin": "chrome-extension://" + "b" * 32}).status_code == 403
    assert post(client, [tm_rows["hello"]], {**HEAD, "Origin": ext}).status_code == 204


def test_CORSは拡張のオリジンにDELETEとX_RS_Telemetryを許す(client):
    ext = "chrome-extension://" + "abcdefghijklmnop" * 2
    for method in ("POST", "DELETE"):
        r = client.options(
            "/telemetry",
            headers={"Origin": ext, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": "content-type,x-rs-telemetry"},
        )
        assert r.headers.get("access-control-allow-origin") == ext, method


def test_DBに届かなければ503で_拡張は送り直す(client, tm_rows, monkeypatch):
    def down():
        raise psycopg.OperationalError("connection to server at 10.0.0.1 failed: 中身の詳細")

    monkeypatch.setattr(main, "DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(main, "_connect", down)
    r = post(client, [tm_rows["session"]])
    assert r.status_code == 503
    assert r.json() == {"ok": False, "error": "unavailable"}
    assert "中身の詳細" not in r.text
    assert forget(client).status_code == 503


def test_ログに項目の値もIDも出さない(client, tm_rows, monkeypatch, capsys):
    session = tm_rows["session"]
    post(client, [session, tm_rows["hello"]])  # 捨てた
    forget(client)
    monkeypatch.setattr(main, "DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(main, "_connect", lambda: (_ for _ in ()).throw(psycopg.OperationalError(f"key ({TID})")))
    post(client, [session])  # DB に届かない
    monkeypatch.setattr(main, "TM_LIMIT_PER_ID", 0)
    post(client, [session])  # 回数の上限

    out = capsys.readouterr().out
    lines = [json.loads(s) for s in out.splitlines() if s.strip()]
    assert [(line["op"], line["status"]) for line in lines] == [
        ("post", "discarded"),
        ("delete", "discarded"),
        ("post", "db_error"),
        ("post", "rate_limited"),
    ]
    for line in lines:
        assert set(line) <= {"event", "op", "status", "rows", "ms", "error"}
    for value in [TID, session["session_id"], session["date"], str(session["read_ms"])]:
        assert value not in out


# ---- 表: 捨ててよい Postgres で(RS_TEST_DATABASE_URL) --------------------------


def _sessions(conn, tid=TID):
    cur = conn.execute("SELECT * FROM tm_sessions WHERE telemetry_id = %s ORDER BY session_id", (tid,))
    names = [d.name for d in cur.description]
    return [dict(zip(names, row)) for row in cur.fetchall()]


def _install(conn, tid=TID):
    cur = conn.execute("SELECT * FROM tm_installs WHERE id = %s", (tid,))
    row = cur.fetchone()
    return dict(zip([d.name for d in cur.description], row)) if row else None


def test_DB_表の列は見本の項目と同じ(client, db, tm_rows):
    post(client, [tm_rows["hello"]])
    cols = lambda t: {r[0] for r in db.execute("SELECT column_name FROM information_schema.columns WHERE table_name = %s", (t,))}  # noqa: E731
    assert cols("tm_sessions") == (set(tm_rows["session"]) - {"kind"}) | {"telemetry_id", "received_at"}
    assert cols("tm_installs") == (set(tm_rows["hello"]) - {"kind", "v"}) | {"id", "first_seen", "last_seen", "hello_at"}


def test_DB_送った行が1行ずつ入り_送り直しても重ならない(client, db, tm_rows):
    s = tm_rows["session"]
    other = {**s, "session_id": str(uuid.uuid4()), "success": False, "pace_wpm": None, "controller_reason": None}
    assert post(client, [s, tm_rows["hello"]]).status_code == 204
    assert post(client, [s, other]).status_code == 204  # 届いたのに応答を受け取れず、送り直した

    rows = _sessions(db)
    assert len(rows) == 2
    got = next(r for r in rows if str(r["session_id"]) == s["session_id"])
    assert str(got["date"]) == s["date"]
    for key in ("v", "ext", "hour", "read_ms", "escapes", "completion_pct", "success", "end_reason", "controller_reason", "position_read"):
        assert got[key] == s[key], key
    assert got["theta"] == pytest.approx(s["theta"], rel=1e-6)
    assert next(r for r in rows if str(r["session_id"]) == other["session_id"])["pace_wpm"] is None

    install = _install(db)
    assert install["ext"] == "0.27" and install["build"] == "dev" and install["chrome"] == 141
    assert install["goal"] == "level1" and install["trivia"] is False and install["theta0"] == 6


def test_DB_helloは最後に届いたもので上書きし_セッションだけなら残す(client, db, tm_rows):
    post(client, [tm_rows["hello"]])
    post(client, [tm_rows["session"]])
    assert _install(db)["goal"] == "level1"  # セッションだけでは hello の項目を消さない
    first_seen = _install(db)["first_seen"]
    post(client, [{**tm_rows["hello"], "ext": "0.28", "goal": None, "theta0": None, "trivia": True}])
    install = _install(db)
    assert (install["ext"], install["goal"], install["theta0"], install["trivia"]) == ("0.28", None, None, True)
    assert install["first_seen"] == first_seen
    assert install["last_seen"] >= first_seen


def test_DB_消すとそのIDの行だけ消える(client, db, tm_rows):
    other = str(uuid.uuid4())
    post(client, [tm_rows["session"], tm_rows["hello"]])
    post(client, [tm_rows["session"], tm_rows["hello"]], {"X-RS-Telemetry": other})
    assert forget(client).status_code == 204
    assert _sessions(db) == [] and _install(db) is None
    assert len(_sessions(db, other)) == 1 and _install(db, other) is not None
    assert forget(client).status_code == 204  # 何も無くても 204(送り直しても同じ)
