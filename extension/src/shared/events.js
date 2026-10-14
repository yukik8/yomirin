// IndexedDBのeventsストアに入るイベント型。append-only。消すのは全消去のときと、
// 保持期間(config.js の RETENTION)を過ぎた細かい計測(dwell_tick・scroll)だけ。
//
// payloadの中身(設計ドキュメント §4):
//   SESSION_START  { url_domain, article_len_words, level, theta }
//   DWELL_TICK     { visible_paragraph_range }
//   SCROLL         { depth_pct }
//   TAB_ESCAPE     { to_domain }            // ドメインのみ。URL全体とタイトルは保存しない
//   TAB_RETURN     { away_ms }
//   HINT_SHOWN     { hint_id, kind }        // kind: canned | llm
//   HINT_CLICKED   { hint_id }
//   EFFECT_SHOWN   { effect_id }
//   SESSION_END    { reason, read_ms, completion_pct }
export const EventType = {
  SESSION_START: 'session_start',
  DWELL_TICK: 'dwell_tick',
  SCROLL: 'scroll',
  TAB_ESCAPE: 'tab_escape',
  TAB_RETURN: 'tab_return',
  HINT_SHOWN: 'hint_shown',
  HINT_CLICKED: 'hint_clicked',
  EFFECT_SHOWN: 'effect_shown',
  QUIZ_ANSWERED: 'quiz_answered', // { correct }
  QUESTION_ASKED: 'question_asked', // { chars } 文面は入れない(本文は記録層のquestionsのみ)
  SESSION_END: 'session_end',
  THETA_UPDATE: 'theta_update', // { from, to, reason } 制御器の動き(本人には通知しない・分析用)
  PAGE_TURN: 'page_turn', // {} Play ブックスのページ送り(URLの pg= の変化)
  PAGE_READ: 'page_read', // { words, ms, d } めくる直前まで見えていたページ(語数・滞在時間・難しさ0〜1)。速さの素材
};

export const SessionState = {
  IDLE: 'idle',
  ACTIVE: 'active',
  ESCAPED: 'escaped',
  ENDED: 'ended',
};

export const EndReason = {
  MANUAL: 'manual',
  CLOSE: 'close',
  IDLE: 'idle',
};

// content script ⇄ service worker のメッセージ種別。
export const Msg = {
  START_SESSION: 'start_session',
  END_SESSION: 'end_session',
  REPORT: 'report', // content scriptからの計測報告(EventTypeを載せる)
  GET_STATUS: 'get_status',
  GET_MIRROR: 'get_mirror',
  GET_LIBRARY: 'get_library', // 記録層の一覧(読んだもの+クイズ正答)
  SET_THETA: 'set_theta', // θ手動ダイヤル(連続値。ドッグフーディング用、W3で自動化)
  SET_GOAL: 'set_goal', // 週次目標の選択(評価レイヤーのみ。制御器は読まない)
  COMPLETE_ONBOARDING: 'complete_onboarding', // 初回診断+目標選択の確定(θの初期配置)
  QUIZ_REQUEST: 'quiz_request', // content→SW: 段落テキストからクイズ生成(端末内の Nano のみ・まだ記録しない)
  QUIZ_SHOWN: 'quiz_shown', // content→SW: クイズを出した。ここで記録層に残し quiz_id を返す
  ASK_OPEN: 'ask_open', // content→SW: 問いの欄を開いた(打っている間に内蔵AIを起こしておく)
  ASK_REQUEST: 'ask_request', // content→SW: 自分からの問い(道具。Nanoのみ・1問1答)
  TRIVIA_REQUEST: 'trivia_request', // content→SW: くまのうんちく(同意があれば単語の候補だけをサーバへ・なければ Nano)
  SET_TELEMETRY: 'set_telemetry', // dashboard→SW: 使われ方の要約を送るか(#28)
  FORGET_TELEMETRY: 'forget_telemetry', // dashboard→SW: 送った使われ方の要約をサーバから消す
  WIPE_ALL: 'wipe_all',
};
