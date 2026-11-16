/* QQ's update reminder ("更新提醒" — 立即重启更新 / 下次启动更新).
 *
 * With 禁止 QQ 自动更新 on, the reminder still popped up after the computer
 * woke from sleep, could not be clicked or closed (user, 2026-11-16), and is
 * not wanted at all. It is recognised by its fixed labels only — the title
 * 更新提醒 and a 下次启动更新 button — and dismissed the way QQ offers:
 * the theme presses 下次启动更新 itself. If the reminder is still on screen
 * a moment later, the host hides the window it is in (only a window that is
 * nothing but this reminder). Message text is never read: only leaf labels
 * of dialogs are compared with those fixed strings. Setting: blockUpdate.
 */
(() => {
  'use strict';
  let enabled = true;
  let timer = 0;
  let busy = false;
  const debug = { seen: 0, pressed: 0, hidden: 0, last: '' };
  const TITLE = '更新提醒';
  const LATER = /^下次启动(时)?更新$|^稍后(再说|更新)?$|^以后再说$/;
  function label(node) {
    return node.childElementCount === 0 ? node.textContent.replace(/\s+/g, '') : null;
  }
  // Where to look: in the main window only dialogs; any other window is
  // small and is searched whole.
  function scopes() {
    if (document.body?.dataset.liuliScope === 'main')
      return [...document.querySelectorAll('.q-dialog, [role="dialog"], .q-popup__main, .q-dialog-main, [class*="upgrade"], [class*="update-"]')];
    return document.body ? [document.body] : [];
  }
  function find() {
    for (const root of scopes()) {
      const nodes = root.querySelectorAll('div, span, h1, h2, h3, p, button');
      if (nodes.length > 3000) continue;
      let title = null,
        later = null;
      for (const node of nodes) {
        const text = label(node);
        if (!text) continue;
        if (!title && text === TITLE) title = node;
        else if (!later && LATER.test(text)) later = node.closest('button, [role="button"], .q-button') || node;
        if (title && later) return { root, title, later };
      }
    }
    return null;
  }
  function press(el) {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, view: window, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup'])
      el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, at));
    el.click();
  }
  function check() {
    timer = 0;
    if (!enabled) return;
    if (busy) return schedule();
    const hit = find();
    if (!hit) return;
    busy = true;
    debug.seen++;
    debug.last = document.body?.dataset.liuliScope || '';
    window.LiuliHost?.diagLog?.({ event: 'update-prompt', scope: debug.last, action: 'later' });
    press(hit.later);
    debug.pressed++;
    setTimeout(() => {
      busy = false;
      if (!hit.title.isConnected || !hit.title.getClientRects().length) return;
      // still there: a window that is only this reminder is hidden
      if (document.body?.dataset.liuliScope !== 'main' && window.LiuliHost?.hideOwnWindow) {
        debug.hidden++;
        window.LiuliHost.hideOwnWindow('update-prompt').catch(() => {});
      } else {
        // a dialog inside the main window: take it off screen
        const dialog = hit.title.closest('.q-dialog, [role="dialog"], .q-popup__main, .q-dialog-main') || hit.root;
        dialog.setAttribute('data-liuli-dismissed', '');
        const mask = dialog.closest('.q-dialog-modal, .q-popup__modal, .q-modal-mask, .modal-mask');
        mask?.setAttribute('data-liuli-dismissed', '');
        debug.hidden++;
      }
    }, 800);
  }
  function schedule() {
    if (!enabled || timer) return;
    timer = setTimeout(check, 400);
  }
  function configure(next) {
    if (next && 'enabled' in next) enabled = next.enabled !== false;
    schedule();
  }
  window.LiuliUpdatePrompt = Object.freeze({ schedule, configure, check, debug: () => ({ enabled, ...debug }) });
})();
