// IndexedDB。生イベントはここにしか置かない。
//
// 3層構造(docs/design.md §8):
//   計測層: events(append-only) / sessions(集計キャッシュ)
//   制御層: state(単一レコード・連続θ)
//   記録層: pages(本) / readings(読んだ区間) / quizzes / quiz_attempts / questions
//           (読書メモリ=本人の資産。ローカルのみ)
//   記憶層(v5): marks(本人が残した主張) / memory_items(思い出す項目と FSRS の状態) /
//           recalls(想起の記録・append-only)

import { THETA_MAX } from '../shared/config.js';

const DB_NAME = 'reading-scaffold';
const DB_VERSION = 5;

let dbPromise = null;

/** @returns {Promise<IDBDatabase>} */
export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // v1: 計測層+制御層
      if (!db.objectStoreNames.contains('events')) {
        const events = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
        events.createIndex('by_session', 'session_id');
        events.createIndex('by_t', 't');
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'session_id' });
        sessions.createIndex('by_date', 'date');
      }
      if (!db.objectStoreNames.contains('state')) {
        db.createObjectStore('state', { keyPath: 'key' });
      }
      // v2: 記録層(読書メモリ)
      if (!db.objectStoreNames.contains('pages')) {
        const pages = db.createObjectStore('pages', { keyPath: 'page_id' });
        pages.createIndex('by_last_read', 'last_read_at');
      }
      if (!db.objectStoreNames.contains('quizzes')) {
        const quizzes = db.createObjectStore('quizzes', { keyPath: 'quiz_id', autoIncrement: true });
        quizzes.createIndex('by_page', 'page_id');
        quizzes.createIndex('by_hash', 'paragraph_hash');
      }
      if (!db.objectStoreNames.contains('quiz_attempts')) {
        const attempts = db.createObjectStore('quiz_attempts', {
          keyPath: 'attempt_id',
          autoIncrement: true,
        });
        attempts.createIndex('by_quiz', 'quiz_id');
        attempts.createIndex('by_page', 'page_id');
      }
      // v3: 自分からの問い(道具カテゴリの記録。docs/design.md §7)
      if (!db.objectStoreNames.contains('questions')) {
        const questions = db.createObjectStore('questions', {
          keyPath: 'question_id',
          autoIncrement: true,
        });
        questions.createIndex('by_page', 'page_id');
      }
      // v4: 読んだ区間(1セッション=1行。本の中のどこを読んだか。docs/design.md §8)
      if (!db.objectStoreNames.contains('readings')) {
        const readings = db.createObjectStore('readings', { keyPath: 'session_id' });
        readings.createIndex('by_page', 'page_id');
        readings.createIndex('by_started', 'started_at');
      }
      // v5: 記憶の層(docs/design.md §8)。本人が残した主張、思い出す項目(FSRS)、想起の記録
      if (!db.objectStoreNames.contains('marks')) {
        const marks = db.createObjectStore('marks', { keyPath: 'mark_id', autoIncrement: true });
        marks.createIndex('by_page', 'page_id');
      }
      if (!db.objectStoreNames.contains('memory_items')) {
        const items = db.createObjectStore('memory_items', { keyPath: 'item_id' });
        items.createIndex('by_due', 'due');
        items.createIndex('by_page', 'page_id');
      }
      if (!db.objectStoreNames.contains('recalls')) {
        const recalls = db.createObjectStore('recalls', { keyPath: 'recall_id', autoIncrement: true });
        recalls.createIndex('by_item', 'item_id');
        recalls.createIndex('by_page', 'page_id');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 新しい版の拡張が DB を上げようとしたら、古い接続はすぐ閉じて道を空ける
      // (開いたままのダッシュボード等が握っていると、上げる側が永久に待たされる)
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    // 古い接続が閉じるのを待っている。閉じれば onsuccess まで進むので、ここでは待つだけ
    req.onblocked = () => {};
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const req = fn(t.objectStore(storeName));
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

function runIndex(storeName, indexName, key) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, 'readonly');
        const req = t.objectStore(storeName).index(indexName).get(key);
        t.oncomplete = () => resolve(req.result ?? null);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

/** SHA-256の16進文字列。page_id・段落ハッシュに使う。 */
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- 計測層 ---------------------------------------------------------------

/** イベントを1件追記する。append-only。 */
export function appendEvent(sessionId, type, payload, t = Date.now()) {
  return run('events', 'readwrite', (s) => s.add({ session_id: sessionId, t, type, payload }));
}

/**
 * before より古い、types の型のイベントを消す(保持期間を過ぎた細かい計測)。
 * 時刻の索引で古い方から辿る。数の多い鼓動が消えた後は、辿るのは残す型の少ない件数だけ。
 */
export function pruneEvents(before, types) {
  const kinds = new Set(types);
  return run('events', 'readwrite', (s) => {
    const req = s.index('by_t').openCursor(IDBKeyRange.upperBound(before, true));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if (kinds.has(cursor.value.type)) cursor.delete();
      cursor.continue();
    };
    return null;
  });
}

/** セッションの集計キャッシュを書く。 */
export function putSession(session) {
  return run('sessions', 'readwrite', (s) => s.put(session));
}

export function getAllSessions() {
  return run('sessions', 'readonly', (s) => s.getAll()).then((rows) => rows ?? []);
}

/** 1セッションの生イベント(古い順)。 */
export function getEventsBySession(sessionId) {
  return run('events', 'readonly', (s) => s.index('by_session').getAll(sessionId)).then(
    (rows) => rows ?? [],
  );
}

// ---- 制御層 ---------------------------------------------------------------

const STATE_KEY = 'singleton';

const DEFAULT_STATE = {
  key: STATE_KEY,
  theta: THETA_MAX, // 連続値[0, THETA_MAX]。Levelは廃止(2026-08-16)
  success_streak: 0,
  fail_streak: 0,
  day: null, // 1日の総変化上限の判定用
  day_start_theta: null,
  diag_answers: null,
  theta0: null, // 診断で置いた θ の初期値(使われ方の要約の hello に載せるだけ。制御器は読まない)
  goal: null, // 週次目標のキー(GOALS)。評価レイヤー専用 — 制御器は読まない
  onboarded_at: null, // 初回診断+目標選択の完了時刻。nullの間はpopupがオンボーディングへ誘導
  updated_at: null,
};

/** state(単一レコード)。無ければ初期値を返す。 */
export function getState() {
  return run('state', 'readonly', (s) => s.get(STATE_KEY)).then((row) => {
    if (!row) return { ...DEFAULT_STATE };
    // v1(Level制)からの移行: thetaはそのまま生かし、levelは無視する
    return { ...DEFAULT_STATE, ...row };
  });
}

export function putState(state) {
  return run('state', 'readwrite', (s) => s.put({ ...state, key: STATE_KEY, updated_at: Date.now() }));
}

// ---- 記録層(読書メモリ) -------------------------------------------------

export function getPage(pageId) {
  return run('pages', 'readonly', (s) => s.get(pageId)).then((row) => row ?? null);
}

export function putPage(page) {
  return run('pages', 'readwrite', (s) => s.put(page));
}

/** クイズを保存してquiz_idを返す。 */
export function addQuiz(quiz) {
  return run('quizzes', 'readwrite', (s) => s.add(quiz));
}

/** 同じ段落から生成済みのクイズがあれば返す(サーバキャッシュと対になる重複防止)。 */
export function getQuizByHash(paragraphHash) {
  return runIndex('quizzes', 'by_hash', paragraphHash);
}

export function addQuizAttempt(attempt) {
  return run('quiz_attempts', 'readwrite', (s) => s.add(attempt));
}

export function getAllPages() {
  return run('pages', 'readonly', (s) => s.getAll()).then((rows) => rows ?? []);
}

export function getAllQuizzes() {
  return run('quizzes', 'readonly', (s) => s.getAll()).then((rows) => rows ?? []);
}

export function getAllEvents() {
  return run('events', 'readonly', (s) => s.getAll()).then((rows) => rows ?? []);
}

export function getAllQuizAttempts() {
  return run('quiz_attempts', 'readonly', (s) => s.getAll()).then((rows) => rows ?? []);
}

/** 自分からの問い(記録層)。問いと答えの本文はここにだけ置く。 */
export function addQuestion(question) {
  return run('questions', 'readwrite', (s) => s.add(question));
}

export function getAllQuestions() {
  return run('questions', 'readonly', (s) => s.getAll()).then((rows) => rows ?? []);
}

/** 読んだ区間(記録層)。1セッション=1行。 */
export function putReading(reading) {
  return run('readings', 'readwrite', (s) => s.put(reading));
}

export function getAllReadings() {
  return run('readings', 'readonly', (s) => s.getAll()).then((rows) => rows ?? []);
}

// ---- 記憶層 ---------------------------------------------------------------

/** 本人が残した主張(記録層の「本人が起点の痕跡」)。mark_id を返す。 */
export function addMark(mark) {
  return run('marks', 'readwrite', (s) => s.add(mark));
}

export function getAllMarks() {
  return run('marks', 'readonly', (s) => s.getAll()).then((rows) => rows ?? []);
}

/** 思い出す項目(FSRS の状態と期日)。item_id は 'claim:N' | 'question:N' | 'quiz:N'。 */
export function getMemoryItem(itemId) {
  return run('memory_items', 'readonly', (s) => s.get(itemId)).then((row) => row ?? null);
}

export function putMemoryItem(item) {
  return run('memory_items', 'readwrite', (s) => s.put(item));
}

export function getAllMemoryItems() {
  return run('memory_items', 'readonly', (s) => s.getAll()).then((rows) => rows ?? []);
}

/** 想起の記録(append-only)。本人の FSRS 最適化の材料になる。 */
export function addRecall(recall) {
  return run('recalls', 'readwrite', (s) => s.add(recall));
}

export function getAllRecalls() {
  return run('recalls', 'readonly', (s) => s.getAll()).then((rows) => rows ?? []);
}

// ---- 削除 -----------------------------------------------------------------

/** データ削除。設定から1タップで呼ぶ。記録層(資産)も含めて全消去する。 */
export async function wipeAll() {
  for (const store of [
    'events',
    'sessions',
    'state',
    'pages',
    'readings',
    'quizzes',
    'quiz_attempts',
    'questions',
    'marks',
    'memory_items',
    'recalls',
  ]) {
    await run(store, 'readwrite', (s) => s.clear());
  }
  await chrome.storage.session.clear();
  await chrome.storage.local.clear();
}
