/* QQ's floating cards (group card under the chat title, a member's profile
 * card, …) are not part of the main page: QQ opens a transparent child window
 * (window.open, about:blank) and renders the card into it from the main
 * window. The theme never loaded there (about: pages are skipped on purpose),
 * so those cards kept QQ's own look whatever the theme did (user diagnostics,
 * 2026-11-15: two about:blank windows, no card in the main page).
 *
 * The main window wraps window.open; when QQ opens such a window the theme
 * copies its stylesheet, colour variables and theme attributes into it, makes
 * the window background transparent and gives the card itself the theme's
 * glass tint, clearing QQ's white and "miracle" sheets inside it. Nothing of
 * QQ's card content or behaviour is touched.
 */
(() => {
  'use strict';
  const STYLE = 'liuli-popup-theme';
  const adopted = new WeakSet();
  const records = [];

  function rgba(color) {
    const m = /rgba?\(([^)]+)\)/.exec(color || '');
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  // white/black-ish fill, at least faintly visible
  function sheetFill(css) {
    const c = rgba(css.backgroundColor);
    if (css.backgroundImage !== 'none' && !/^linear-gradient\(/.test(css.backgroundImage)) return /url\(/.test(css.backgroundImage) ? 'image' : false;
    if (!c || c.a < 0.12) return false;
    const l = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 24 && (l >= 0.8 || l <= 0.2) ? 'fill' : false;
  }
  function themeCss() {
    return (document.getElementById('liuli-dsh-theme')?.textContent || '') + POPUP_CSS;
  }
  const POPUP_CSS = `
html, body, body > #app, body > div:first-child {
  background: transparent !important;
  background-color: transparent !important;
}
body[data-liuli-popup-doc] #app::before,
body[data-liuli-popup-doc] #app::after {
  content: none !important;
}
[data-liuli-popup-card] {
  --bg_white: transparent !important;
  --bg_top_light: transparent !important;
  --bg_top_standard: transparent !important;
  --bg_bottom_standard: transparent !important;
  --bg_middle_standard: transparent !important;
  --bg_grey_standard: transparent !important;
  background: var(--ll-glass-wash), rgba(var(--ll-acrylic), var(--ll-popup-card-alpha, 0.72)) !important;
  backdrop-filter: var(--ll-material-blur) !important;
  -webkit-backdrop-filter: var(--ll-material-blur) !important;
  box-shadow: var(--ll-popup-edge), var(--ll-shadow-float) !important;
  border-color: transparent !important;
  color: var(--ll-on-glass) !important;
}
[data-liuli-popup-clear] {
  background: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
}
`;
  function copyTheme(w) {
    const doc = w.document;
    let style = doc.getElementById(STYLE);
    if (!style) {
      style = doc.createElement('style');
      style.id = STYLE;
      (doc.head || doc.documentElement).appendChild(style);
    }
    const css = themeCss();
    if (style.textContent !== css) style.textContent = css;
    const body = doc.body;
    for (const [k, v] of Object.entries(document.body.dataset))
      if (k.startsWith('liuli') && !/^liuli(Scope|VideoWallpaper|RNav|RL|RR|NavPin|NavMoving|Av|Header|PopupWindow|AutohideActions|ControlsPinned)$/.test(k) && body.dataset[k] !== v)
        body.dataset[k] = v;
    body.dataset.liuliScope = 'aux';
    body.setAttribute('data-liuli-popup-doc', '');
    // keeps the theme's white window base off (foundation.css)
    body.setAttribute('data-liuli-popup-window', '');
    for (let i = 0; i < document.body.style.length; i++) {
      const name = document.body.style[i];
      if (name.startsWith('--ll-')) body.style.setProperty(name, document.body.style.getPropertyValue(name));
    }
    // With Windows' acrylic on the window, the glass can stay thin; without
    // it nothing behind is blurred, so the tint carries legibility.
    const acrylic = body.classList.contains('acrylic') || document.body.classList.contains('acrylic');
    body.style.setProperty('--ll-popup-card-alpha', acrylic ? 'clamp(0.36, calc(var(--ll-material-opacity) * 0.64 + 0.24), 0.8)' : '0.86');
  }
  // The card: the largest element in the window that paints a fill or a
  // picture. Inside it, QQ's white sheets and decorative picture layers go.
  function paintCard(w) {
    const doc = w.document;
    const area = w.innerWidth * w.innerHeight;
    if (!doc.body || area <= 0) return;
    let card = null;
    let best = 0;
    for (const el of doc.body.querySelectorAll('div, section')) {
      const r = el.getBoundingClientRect();
      const a = r.width * r.height;
      if (a < area * 0.3 || a <= best) continue;
      const css = w.getComputedStyle(el);
      if (!sheetFill(css) && css.backdropFilter === 'none' && !el.querySelector('.q-miracle-background')) continue;
      card = el;
      best = a;
    }
    if (!card) return;
    // the outermost painted box of that size is the card
    for (let p = card.parentElement; p && p !== doc.body; p = p.parentElement) {
      const r = p.getBoundingClientRect();
      if (r.width * r.height > best * 1.15) break;
      const css = w.getComputedStyle(p);
      if (sheetFill(css) || css.backdropFilter !== 'none') card = p;
    }
    if (!card.hasAttribute('data-liuli-popup-card')) card.setAttribute('data-liuli-popup-card', '');
    const box = card.getBoundingClientRect();
    for (const inner of card.querySelectorAll('div, section, header, main, ul')) {
      if (inner.closest('button, [role="button"], .q-button, input, textarea, [class*="avatar"], .q-tag, [class*="tag"]')) continue;
      const css = w.getComputedStyle(inner);
      const kind = sheetFill(css);
      const r = inner.getBoundingClientRect();
      const big = r.width >= box.width * 0.6 && r.height >= Math.min(60, box.height * 0.3);
      const decorative = css.pointerEvents === 'none' && r.width * r.height >= box.width * box.height * 0.6;
      if ((kind && big) || (kind === 'image' && decorative) || css.backdropFilter !== 'none') {
        if (!inner.hasAttribute('data-liuli-popup-clear')) inner.setAttribute('data-liuli-popup-clear', '');
      }
    }
    for (const img of card.querySelectorAll('img, canvas')) {
      const r = img.getBoundingClientRect();
      if (w.getComputedStyle(img).pointerEvents === 'none' && r.width * r.height >= box.width * box.height * 0.6)
        img.setAttribute('data-liuli-popup-clear', ''), (img.style.visibility = 'hidden');
    }
    record(w, card);
  }
  // Diagnostics: the card's structure (class names, sizes, fills; no text).
  function record(w, card) {
    if (records.some(r => r.card === card)) return;
    const shot = (el, depth) => {
      const r = el.getBoundingClientRect();
      const c = w.getComputedStyle(el);
      const out = { tag: el.tagName.toLowerCase(), cls: String(typeof el.className === 'string' ? el.className : '').slice(0, 80), rect: [r.left, r.top, r.width, r.height].map(Math.round) };
      if (c.backgroundColor !== 'rgba(0, 0, 0, 0)') out.bg = c.backgroundColor;
      if (c.backgroundImage !== 'none') out.bgImage = c.backgroundImage.includes('url(') ? 'url' : 'gradient';
      if (c.backdropFilter !== 'none') out.backdrop = c.backdropFilter;
      for (const a of el.attributes) if (a.name.startsWith('data-liuli')) (out.liuli ||= []).push(a.name.slice(11));
      if (depth > 0) {
        const kids = [...el.children].slice(0, 12).map(k => shot(k, depth - 1));
        if (kids.length) out.children = kids;
      }
      return out;
    };
    try {
      records.push({ card, at: new Date().toISOString(), size: [w.innerWidth, w.innerHeight], acrylic: w.document.body.classList.contains('acrylic'), tree: shot(w.document.body, 7) });
      while (records.length > 4) records.shift();
    } catch (e) {}
  }
  function adopt(w) {
    if (!w || adopted.has(w)) return;
    adopted.add(w);
    let tries = 0;
    const start = () => {
      let doc;
      try {
        doc = w.document;
      } catch (e) {
        return; // not ours (cross-origin)
      }
      if (w.closed) return;
      if (!doc?.body) {
        if (++tries < 120) return void setTimeout(start, 25);
        return;
      }
      copyTheme(w);
      let frame = 0;
      const pass = () => {
        frame = 0;
        if (w.closed) return;
        try {
          copyTheme(w);
          paintCard(w);
        } catch (e) {}
      };
      new w.MutationObserver(() => {
        if (!frame) frame = w.requestAnimationFrame(pass);
      }).observe(doc.documentElement, { childList: true, subtree: true });
      w.addEventListener('resize', () => {
        if (!frame) frame = w.requestAnimationFrame(pass);
      });
      pass();
    };
    start();
  }
  function install() {
    if (window.__liuliPopupWindows) return;
    window.__liuliPopupWindows = true;
    const open = window.open;
    window.open = function (...args) {
      const w = open.apply(this, args);
      try {
        const url = String(args[0] || '');
        if (w && (url === '' || url.startsWith('about:'))) adopt(w);
      } catch (e) {}
      return w;
    };
  }
  window.LiuliPopupWindows = Object.freeze({
    install,
    adopt,
    report: () => records.map(({ card, ...rest }) => rest)
  });
})();
