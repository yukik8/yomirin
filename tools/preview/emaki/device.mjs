// run.py が呼ぶ端末の側。標準入力の JSON を受け取り、標準出力に JSON を返す(決まりは emaki.js)。
//
//   node tools/preview/emaki/device.mjs schemas             # Claude に渡す JSON Schema(下調べ・読み取り・描く・章のまとめ・判定役)
//   node tools/preview/emaki/device.mjs next  < {run}       # 次にすること(読み取り・描く・章のまとめ・終わり)と、送るもの
//   node tools/preview/emaki/device.mjs judge < {run}       # 判定役に渡すもの
//   node tools/preview/emaki/device.mjs book  < {id}        # 本の題・著者・ページと読み取りの間隔と、知らない本の下調べに使う題
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMAKI, briefSchema, drawSchema, judgeRequest, judgeSchema, next, paginate, readSchema, summarySchema } from './emaki.js';

const here = dirname(fileURLToPath(import.meta.url));
const { books, unknown } = JSON.parse(readFileSync(join(here, 'books.json'), 'utf8'));
const op = process.argv[2];
const out = (value) => process.stdout.write(JSON.stringify(value));

if (op === 'schemas') {
  out({ brief: briefSchema(), read: readSchema(), draw: drawSchema(), summary: summarySchema(), judge: judgeSchema() });
} else {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (op === 'book') {
    const book = books.find((b) => b.id === input.id);
    out(book ? { id: book.id, title: book.title, author: book.author, chapters: book.chapters.length, settings: { pageSize: EMAKI.pageSize, every: EMAKI.every }, unknown } : { error: 'no_book', books: books.map((b) => b.id) });
  } else {
    const book = books.find((b) => b.id === input.run.book);
    const pages = paginate(book, input.run.settings.pageSize);
    if (op === 'next') out(next(input.run, pages));
    else if (op === 'judge') out(judgeRequest(input.run, pages));
    else { process.stderr.write(`知らない op: ${op}\n`); process.exit(1); }
  }
}
