/* Back to the newest message.
 *
 * After reading far up a conversation, a round glass button appears at the
 * top-right corner of the floating composer; one click brings the view back
 * to the newest message. It shows only once the view is well away from the
 * end (more than about one and a half screens) and hides again near the end.
 *
 * Only the message scroller's position is changed — the same thing the
 * mouse wheel does. A far jump first moves (instantly) to a screen above the
 * end and then glides the rest, so the virtual list does not have to render
 * every message in between; the end is checked again for a moment after,
 * because rows measured on arrival change the list height. Setting: jumpBottom.
 */
(() => {
  'use strict';
  let enabled = true;
  let button = null;
  let frame = 0;
  let shown = false;
  let settleUntil = 0;

  function scroller() {
    try {
      return window.LiuliComposer?.scroller() || null;
    } catch (e) {
      return null;
    }
  }
  function reversed(node) {
    const css = getComputedStyle(node);
    return /flex/.test(css.display) && css.flexDirection === 'column-reverse';
  }
  function fromEnd(node) {
    const max = node.scrollHeight - node.clientHeight;
    if (max <= 0) return 0;
    return node.scrollTop < 0 || reversed(node) ? Math.abs(node.scrollTop) : max - node.scrollTop;
  }
  function endTop(node) {
    return reversed(node) ? 0 : node.scrollHeight - node.clientHeight;
  }
  function make() {
    const b = document.createElement('button');
    b.id = 'liuli-jump-bottom';
    b.className = 'liuli-owned-ui';
    b.type = 'button';
    b.title = '回到最新消息';
    b.setAttribute('aria-label', '回到最新消息');
    b.innerHTML =
      '<svg class="liuli-ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v13M6 12l6 6 6-6"/></svg>';
    // pointerdown: the composer must not take focus or close a menu first
    b.addEventListener('pointerdown', e => e.preventDefault());
    b.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      jump();
    });
    return b;
  }
  function jump() {
    const node = scroller();
    if (!node) return;
    const screen = node.clientHeight || 600;
    if (fromEnd(node) > screen * 2) node.scrollTop = reversed(node) ? -screen : endTop(node) - screen;
    node.scrollTo({ top: endTop(node), behavior: 'smooth' });
    settleUntil = performance.now() + 1200;
    setShown(false);
    const settle = () => {
      if (!node.isConnected || performance.now() > settleUntil) return;
      // a wheel or drag by the reader in the meantime wins
      if (fromEnd(node) > 2) {
        const left = fromEnd(node);
        if (left < screen * 1.2) node.scrollTop = endTop(node);
      }
      requestAnimationFrame(settle);
    };
    setTimeout(() => requestAnimationFrame(settle), 380);
  }
  function setShown(next) {
    if (shown === next) return;
    shown = next;
    if (button) button.toggleAttribute('data-shown', next);
  }
  function check() {
    frame = 0;
    const node = scroller();
    const area = window.LiuliComposer?.area?.();
    const chatWindow = document.body.dataset.liuliScope === 'main' || /^#\/chat/.test(location.hash);
    if (!enabled || !node || !area || !chatWindow) {
      setShown(false);
      return;
    }
    if (!button) button = make();
    if (button.parentElement !== area) {
      shown = false;
      button.removeAttribute('data-shown');
      area.append(button);
    }
    if (performance.now() < settleUntil) return setShown(false);
    const far = fromEnd(node);
    const screen = node.clientHeight || 600;
    if (far > Math.max(600, screen * 1.5)) setShown(true);
    else if (far < 160) setShown(false);
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(check);
  }
  function onScroll(e) {
    const node = scroller();
    if (node && (e.target === node || e.target === document)) schedule();
  }
  // the reader takes over: stop putting the view back at the end
  function cancel() {
    settleUntil = 0;
  }
  function install() {
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    for (const type of ['wheel', 'pointerdown', 'keydown']) document.addEventListener(type, cancel, { capture: true, passive: true });
    addEventListener('resize', schedule, { passive: true });
    addEventListener('hashchange', schedule);
    schedule();
  }
  function configure(next) {
    if (next && 'enabled' in next) enabled = next.enabled !== false;
    if (!enabled && button) {
      button.remove();
      shown = false;
    }
    schedule();
  }
  function state() {
    const node = scroller();
    return { enabled, shown, mounted: !!button?.isConnected, fromEnd: node ? Math.round(fromEnd(node)) : null };
  }
  window.LiuliJumpBottom = Object.freeze({ install, configure, schedule, jump, state });
})();
