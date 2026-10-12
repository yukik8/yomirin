// 拡張の版の確かめ(CI・#19)。版の上げ忘れと、docs/design.md §12 の版の表の書き忘れを止める。依存なし。
//
//   node tools/ci/version.mjs pr main       PR: extension/ が main から変わっていたら、版が上がり、版の表にその行があること
//   node tools/ci/version.mjs tag v0.26.1   タグ: タグが manifest の版と同じ・update_url が無い・版の表にその行がある。
//                                           その行の「できたこと」を出す(Release の本文にする)
//
// リポジトリの一番上で動かす。

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const readManifest = () => JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
const parse = (v) => String(v).split('.').map(Number);

/** a が b より新しければ正、同じなら 0 */
function compare(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** 版の表での書き方: 0.26.0 → v0.26、0.26.1 → v0.26.1 */
function label(v) {
  const [major, minor, patch = 0] = parse(v);
  return patch === 0 ? `v${major}.${minor}` : `v${major}.${minor}.${patch}`;
}

/** 版の表のその版の行の「できたこと」。無ければ null */
function row(v) {
  const want = label(v);
  for (const line of readFileSync('docs/design.md', 'utf8').split('\n')) {
    const cells = line.split('|').map((s) => s.trim()); // | 日付 | 版 | できたこと |
    if (cells.length >= 5 && cells[2] === want) return cells[3];
  }
  return null;
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const [mode, arg] = process.argv.slice(2);

if (mode === 'pr' && arg) {
  const base = `origin/${arg}`;
  const changed = git('diff', '--name-only', `${base}...HEAD`, '--', 'extension/');
  if (!changed) {
    console.log('extension/ は変わっていない。版はそのままでよい');
    process.exit(0);
  }
  const before = JSON.parse(git('show', `${base}:extension/manifest.json`)).version;
  const after = readManifest().version;
  if (compare(after, before) <= 0) {
    fail(`extension/ を変えたのに、manifest の version が ${after}(${arg} は ${before})。上げる: 動きが変わるなら 0.x、直しだけなら 0.x.y(docs/release.md §2)`);
  }
  if (!row(after)) fail(`docs/design.md §12 の版の表に ${label(after)} の行が無い`);
  console.log(`版 ${before} → ${after}・版の表に ${label(after)} の行がある`);
} else if (mode === 'tag' && arg) {
  const manifest = readManifest();
  if (arg !== `v${manifest.version}`) fail(`タグ ${arg} が manifest の版 v${manifest.version} と違う`);
  if ('update_url' in manifest) fail('manifest に update_url がある(ストアが付けるもの。zip に入れると、入れた人の手元でもストア版として動く)');
  const notes = row(manifest.version);
  if (!notes) fail(`docs/design.md §12 の版の表に ${label(manifest.version)} の行が無い`);
  console.log(notes);
} else {
  console.error('usage: node tools/ci/version.mjs pr <base> | tag <tag>');
  process.exit(2);
}
