// 本を開いたときの「計測しますか?」のカード(#32・docs/design.md §3)。「読む」の押し忘れ対策。
// 計測していないとき、SW(background/prompt.js)が Play ブックスのリーダーの最上位のフレームへ入れる。
// 「はい」で計測を始める(送り元とセッションの有無は SW が確かめる)。答えるまで何も測らない・何も送らない。
// 演出ではない: θ と無関係で、乱数・ご褒美・動きは無い(入場だけ)。見た目は静(docs/style.md)。
// ページを改変しない: 閉じた Shadow DOM の層を1つ足すだけ(不変条件 §11-1)。
// executeScript の files で入れるので classic script(import は使えない)。
(() => {
  if (window.__yomirinStartPrompt) return; // 出ているあいだは二重に出さない

  const CSS = `
    :host { all: initial; }
    .card {
      display: grid;
      grid-template-columns: auto auto;
      align-items: center;
      column-gap: 12px;
      padding: 12px 16px 12px 12px;
      background: #fdfaf3;
      color: #4f3a2c;
      border: 1px solid rgba(79, 58, 44, 0.1);
      border-radius: 16px;
      box-shadow: 0 1px 2px rgba(79, 58, 44, 0.05), 0 6px 18px rgba(79, 58, 44, 0.06);
      font-family: 'Hiragino Maru Gothic ProN', 'Zen Maru Gothic', 'M PLUS Rounded 1c', 'Hiragino Sans', sans-serif;
      font-size: 14px;
      line-height: 1.7;
      letter-spacing: 0.01em;
      -webkit-font-smoothing: antialiased;
      animation: rise 0.4s ease-out both;
    }
    @keyframes rise { from { opacity: 0; transform: translateY(6px); } }
    @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
    .bear { grid-row: span 2; width: 44px; height: auto; user-select: none; }
    .q { margin: 0; font-weight: 600; }
    .actions { display: flex; gap: 8px; margin-top: 6px; }
    button {
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.04em;
      padding: 5px 18px;
      border: 1px solid rgba(79, 58, 44, 0.1);
      border-radius: 999px;
      background: #fdfaf3;
      color: #4f3a2c;
      box-shadow: 0 1px 2px rgba(79, 58, 44, 0.06);
      cursor: pointer;
    }
    button:hover { background: #f4ecdf; }
    button.yes { background: #ecd7c3; border-color: transparent; }
    button.yes:hover { background: #e5cbb3; }
    button:disabled { opacity: 0.5; cursor: default; }
    button:focus-visible { outline: 2px solid #6b8fba; outline-offset: 2px; }
    .err { grid-column: 2; margin: 6px 0 0; font-size: 12.5px; color: rgba(79, 58, 44, 0.68); }
  `;

  const host = document.createElement('div');
  host.style.cssText = 'all: initial; position: fixed; right: 24px; bottom: 24px; z-index: 2147483646;';
  // 閉じた Shadow DOM: ページのスクリプトはボタンに届かない(届いても合成のクリックは下で捨てる)
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${CSS}</style>
    <div class="card" role="group" aria-label="よみりん">
      <img class="bear" alt="" draggable="false">
      <p class="q">計測しますか?</p>
      <div class="actions">
        <button class="yes" type="button">はい</button>
        <button class="no" type="button">いいえ</button>
      </div>
      <p class="err" hidden></p>
    </div>`;
  root.querySelector('.bear').src = chrome.runtime.getURL('assets/bear/read.webp');
  const yes = root.querySelector('.yes');
  const no = root.querySelector('.no');
  const err = root.querySelector('.err');

  function close() {
    host.remove();
    removeEventListener('pagehide', close);
    window.__yomirinStartPrompt = null;
  }

  yes.addEventListener('click', async (e) => {
    if (!e.isTrusted) return; // 本人のクリックだけ
    yes.disabled = no.disabled = true;
    let res = null;
    try {
      // Msg.START_PROMPTED(shared/events.js)
      res = await chrome.runtime.sendMessage({ type: 'start_prompted' });
    } catch {
      /* 拡張が更新・再読み込みされた */
    }
    if (res?.ok) {
      close(); // 計測が始まった(loader.js も畳む)
      return;
    }
    err.textContent = typeof res?.error === 'string' && res.error !== 'forbidden' ? res.error : '開始できませんでした';
    err.hidden = false;
    yes.disabled = no.disabled = false;
  });
  no.addEventListener('click', (e) => {
    if (e.isTrusted) close();
  });
  addEventListener('pagehide', close, { once: true });

  // 計測が始まったら(popup の「読む」からでも)loader.js が畳む
  window.__yomirinStartPrompt = { close };
  document.documentElement.append(host);
})();
