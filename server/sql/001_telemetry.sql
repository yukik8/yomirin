-- 使われ方の要約(#28)。main.py が最初に DB を使うときに流す(何度流しても同じになる書き方だけ)。
-- 列は拡張の telemetry.js の表と、main.py の TmSession / TmHello と揃える。自由な文字列の列は作らない
-- (text の列は、決まった語か版の番号だけが入る。サーバが pydantic で検めてから入れる)。
-- IP・UA・本・本文は持たない。行は本人が消すまで残る(ダッシュボードの「送ったものを消す」と全消去で DELETE)。

-- インストールごとに1行。hello の項目は最後に届いた hello で上書きする
CREATE TABLE IF NOT EXISTS tm_installs (
  id          uuid PRIMARY KEY,                    -- telemetry_id(拡張が作るランダムな UUID。うんちくの install_id とは別)
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  hello_at    timestamptz,                         -- 最後に hello が届いた時刻
  ext         text,                                -- 拡張の版(0.27 など)
  build       text,                                -- store | dev
  chrome      smallint,                            -- Chrome のメジャー版
  theta0      real,                                -- 診断で置いた θ の初期値
  goal        text,                                -- level1 | level2 | level3
  trivia      boolean                              -- うんちくのサーバを使うか
);

-- セッションごとに1行。(telemetry_id, session_id) が同じものは送り直されても1行のまま
CREATE TABLE IF NOT EXISTS tm_sessions (
  telemetry_id      uuid NOT NULL,
  session_id        uuid NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  v                 smallint NOT NULL,              -- 行の形の版
  ext               text NOT NULL,                  -- そのセッションを測った拡張の版
  date              date NOT NULL,                  -- 端末の日付
  hour              smallint NOT NULL,              -- 端末の時刻(時)
  theta             real NOT NULL,                  -- 実効θ
  theta_base        real NOT NULL,                  -- 制御器の基準θ
  theta_after       real,                           -- 制御器が動かしたあとの θ
  controller_reason text,                           -- success / fail / graduate / homeostat_* / down / up / hold / explore_hold
  read_ms           integer NOT NULL,
  escapes           integer NOT NULL,
  away_total_ms     integer NOT NULL,
  quick_returns     integer NOT NULL,
  longest_streak_ms integer NOT NULL,
  completion_pct    smallint NOT NULL,
  success           boolean NOT NULL,
  stability         real,
  end_reason        text,                           -- manual / close / idle
  hints_shown       integer NOT NULL,
  effects_shown     integer NOT NULL,
  pages_read        integer NOT NULL,
  pace_wpm          real,
  pace_cv           real,
  slow_pages        integer NOT NULL,
  fast_pages        integer NOT NULL,
  backs             integer NOT NULL,
  quiz_answered     integer NOT NULL,
  quiz_correct      integer NOT NULL,
  questions_asked   integer NOT NULL,               -- 数だけ(問いの文は送らない)
  position_read     boolean NOT NULL,               -- Play ブックスのページ表示が読めたか
  reached_end       boolean NOT NULL,
  PRIMARY KEY (telemetry_id, session_id)
);
