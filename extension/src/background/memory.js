// 記憶の層(docs/design.md §8)。読んだものが自分の知識として残る、の実体。
//
// 原則: 自分で思い出す(retrieval practice)> LLM の要約。本人が残した主張・本人が問うたこと・
// 答えたクイズだけを「思い出す項目」にし、FSRS-5(shared/fsrs.js)の間隔で思い出す。
// 記録カテゴリなので、演出なし・褒めない・催促しない。無視すれば次回まで出ない。
//
// 項目の3種:
//   claim     セッションの終わりに本人が書いた一文。手がかりは書名。見せるのは本人の文
//   question  本人が読書中に問うたこと(questions)。手がかりは本人の問い。見せるのは選んでいた箇所と答え
//   quiz      出題されたクイズ。最初の回答が最初の復習。正誤で自動評価(自己評価は聞かない)
//
// ここは SW・ダッシュボード・popup から直接呼ばれる(拡張のページは同じ IndexedDB を見る)。

import { MEMORY } from '../shared/config.js';
import { initCard, reviewCard, Grade } from '../shared/fsrs.js';
import {
  addMark,
  getAllMarks,
  getMemoryItem,
  putMemoryItem,
  getAllMemoryItems,
  addRecall,
  getAllRecalls,
  getAllPages,
  getAllQuestions,
  getAllQuizzes,
  getAllReadings,
} from './store.js';

const DAY = 86_400_000;
const opts = () => ({ desiredRetention: MEMORY.desiredRetention });

/**
 * セッションの終わりに本人が残した主張。marks に残し、思い出す項目にする(最初の評価は GOOD:
 * 読んだ直後に自分の言葉で書けた)。
 * @returns {Promise<number>} mark_id
 */
export async function addClaim({ page_id, session_id, text, now = Date.now() }) {
  const clean = String(text ?? '').trim().slice(0, MEMORY.claimMaxChars);
  if (!clean || !page_id) throw new Error('empty claim');
  // そのセッションで読んだ区間の終わり = 主張を書いたときの位置
  const reading = (await getAllReadings()).find((r) => r.session_id === session_id) ?? null;
  const markId = await addMark({
    page_id,
    session_id: session_id ?? null,
    kind: 'claim',
    book_page: reading?.range?.to ?? null,
    book_total: reading?.range?.total ?? null,
    text: clean,
    created_at: now,
  });
  await putMemoryItem({
    item_id: `claim:${markId}`,
    kind: 'claim',
    target_id: markId,
    page_id,
    created_at: now,
    ...initCard(Grade.GOOD, now, opts()),
  });
  return markId;
}

/**
 * クイズに答えた。項目が無ければ作り(最初の回答が最初の復習)、あれば復習として更新する。
 * セッション中の回答(session.js)と、ダッシュボードでの想起(recordRecall)の両方から呼ばれる。
 */
export async function onQuizAnswered({ quiz_id, page_id, correct, now = Date.now() }) {
  if (quiz_id === null || quiz_id === undefined) return;
  const itemId = `quiz:${quiz_id}`;
  const grade = correct ? Grade.GOOD : Grade.AGAIN;
  const existing = await getMemoryItem(itemId);
  if (!existing) {
    await putMemoryItem({
      item_id: itemId,
      kind: 'quiz',
      target_id: quiz_id,
      page_id: page_id ?? null,
      created_at: now,
      ...initCard(grade, now, opts()),
    });
  } else {
    const { card } = reviewCard(existing, grade, now, opts());
    await putMemoryItem({ ...existing, ...card });
  }
}

/**
 * 既存の記録から項目を作る(冪等)。本人の問い(questions)は、問うた時点を最初の復習として置く。
 * ダッシュボードを開いたときに走らせる。
 */
export async function ensureItems(now = Date.now()) {
  const [items, questions] = await Promise.all([getAllMemoryItems(), getAllQuestions()]);
  const have = new Set(items.map((i) => i.item_id));
  for (const q of questions) {
    const itemId = `question:${q.question_id}`;
    if (have.has(itemId) || !q.page_id) continue;
    const at = q.created_at ?? now;
    await putMemoryItem({
      item_id: itemId,
      kind: 'question',
      target_id: q.question_id,
      page_id: q.page_id,
      created_at: at,
      ...initCard(Grade.GOOD, at, opts()),
    });
  }
}

/**
 * いま思い出す項目(期日が来たもの・古い順・上限つき)。表示に要るものをすべて添える。
 * @returns {Promise<Array<{ item_id, kind, title, book_page, days_since_read, due,
 *   cue, reveal: { text, selection? }, choices?, answer_index? }>>}
 */
export async function buildDue(now = Date.now()) {
  await ensureItems(now);
  const [items, pages, marks, questions, quizzes] = await Promise.all([
    getAllMemoryItems(),
    getAllPages(),
    getAllMarks(),
    getAllQuestions(),
    getAllQuizzes(),
  ]);
  const titleOf = new Map(pages.map((p) => [p.page_id, p.title || p.domain || '']));
  const markById = new Map(marks.map((m) => [m.mark_id, m]));
  const qById = new Map(questions.map((q) => [q.question_id, q]));
  const quizById = new Map(quizzes.map((q) => [q.quiz_id, q]));

  const due = items
    .filter((i) => i.due <= now && !i.retired)
    .sort((a, b) => a.due - b.due)
    .slice(0, MEMORY.maxDuePerVisit);

  const out = [];
  for (const i of due) {
    const base = {
      item_id: i.item_id,
      kind: i.kind,
      title: titleOf.get(i.page_id) ?? '',
      days_since_read: Math.round((now - i.created_at) / DAY),
      due: i.due,
    };
    if (i.kind === 'claim') {
      const m = markById.get(i.target_id);
      if (!m) continue;
      out.push({
        ...base,
        book_page: m.book_page ?? null,
        cue: 'この本で「いちばん大事」と残したことは?',
        reveal: { text: m.text },
      });
    } else if (i.kind === 'question') {
      const q = qById.get(i.target_id);
      if (!q) continue;
      out.push({
        ...base,
        book_page: q.book_page ?? null,
        cue: `あなたが問うたこと:「${q.question}」— 答えは?`,
        reveal: { text: q.answer ?? '', selection: q.selection ?? null },
      });
    } else if (i.kind === 'quiz') {
      const q = quizById.get(i.target_id);
      if (!q) continue;
      out.push({
        ...base,
        book_page: q.book_page ?? null,
        cue: q.question,
        choices: q.choices,
        answer_index: q.answer_index,
        reveal: { text: q.choices?.[q.answer_index] ?? '' },
      });
    }
  }
  return out;
}

/**
 * 想起の結果を記録し、次の期日を置く。
 * claim/question: grade は本人の自己評価 1(思い出せなかった)/2(おぼろげ)/3(はっきり)
 * quiz: chosen_index から正誤を決め、grade は 3 か 1
 * @returns {Promise<{ next_days: number }>} 次に出るまでの日数(事実として表示する)
 */
export async function recordRecall({ item_id, grade, chosen_index = null, response = null, now = Date.now() }) {
  const item = await getMemoryItem(item_id);
  if (!item) throw new Error('unknown item');
  let g = Number(grade);
  let correct = null;
  if (item.kind === 'quiz') {
    const quizzes = await getAllQuizzes();
    const q = quizzes.find((x) => x.quiz_id === item.target_id);
    correct = Boolean(q) && Number(chosen_index) === q.answer_index;
    g = correct ? Grade.GOOD : Grade.AGAIN;
  }
  if (![Grade.AGAIN, Grade.HARD, Grade.GOOD].includes(g)) throw new Error('bad grade');

  const { card, elapsed_days, R } = reviewCard(item, g, now, opts());
  await addRecall({
    item_id,
    kind: item.kind,
    page_id: item.page_id ?? null,
    grade: g,
    correct,
    chosen_index: item.kind === 'quiz' ? Number(chosen_index) : null,
    response: response ? String(response).slice(0, 500) : null,
    answered_at: now,
    elapsed_days,
    retrievability: R,
    days_since_read: Math.round((now - item.created_at) / DAY),
    before: { D: item.D, S: item.S },
    after: { D: card.D, S: card.S },
  });
  await putMemoryItem({ ...item, ...card });
  return { next_days: Math.max(1, Math.round((card.due - now) / DAY)) };
}

/**
 * 「時間がたっても残っていること」: 読んでから N 日以上たった想起のうち、思い出せた割合。
 * その場の正答率の代わりに出す事実(docs/design.md §8)。
 * @returns {Promise<{ claims: number, items: number, due_now: number,
 *   retention: Array<{ days, recalled, total }> }>}
 */
export async function buildRetention(now = Date.now()) {
  const [items, recalls, marks] = await Promise.all([getAllMemoryItems(), getAllRecalls(), getAllMarks()]);
  const retention = MEMORY.retentionDays.map((days) => {
    const rows = recalls.filter((r) => r.days_since_read >= days);
    return { days, total: rows.length, recalled: rows.filter((r) => r.grade >= Grade.HARD).length };
  });
  return {
    claims: marks.filter((m) => m.kind === 'claim').length,
    items: items.length,
    due_now: items.filter((i) => i.due <= now).length,
    retention,
  };
}
