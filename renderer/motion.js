(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map();
  const enabled = () => !preference.matches && !document.hidden;

  function play(element, frames, options) {
    if (!enabled() || !element.isConnected || typeof element.animate !== 'function') return;
    running.get(element)?.cancel();
    const animation = element.animate(frames, { ...options, fill: 'backwards' });
    running.set(element, animation);
    const release = () => {
      if (running.get(element) === animation) running.delete(element);
    };
    animation.finished.then(() => {
      release();
      animation.cancel();
    }, release);
    return animation;
  }

  function cancelAll() {
    for (const animation of running.values()) animation.cancel();
    running.clear();
    for (const shift of shifts.values()) shift.animation.cancel();
    shifts.clear();
  }
  preference.addEventListener('change', () => {
    if (preference.matches) cancelAll();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAll();
  });

  // ── Chat in motion ───────────────────────────────────────────────────────
  // Every glass bubble is its own backdrop-filter surface. At rest that costs
  // nothing; while the list moves, each one is re-blurred every frame. For the
  // duration of a scroll or an arrival animation the pane carries
  // data-liuli-moving and the bubbles drop their blur (motion.css); they get it
  // back 160ms after the list stops.
  const settle = new WeakMap();
  function moving(pane, ms = 160) {
    if (!pane) return;
    if (!pane.hasAttribute('data-liuli-moving')) pane.setAttribute('data-liuli-moving', '');
    clearTimeout(settle.get(pane));
    settle.set(
      pane,
      setTimeout(() => pane.removeAttribute('data-liuli-moving'), ms)
    );
  }

  // ── New messages, Telegram-style ─────────────────────────────────────────
  // When a message arrives (or is sent) while the reader is at the newest end,
  // the client has already moved the content up by the new rows' height. The
  // list is put back where it was and glides up into place; the new bubbles
  // fade in from their avatar side. Transform/opacity only, on one element.
  // History loaded by scrolling and a freshly opened chat are never animated.
  const shifts = new Map(); // list element -> { animation, from, start, duration }
  const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const DURATION = 280;
  function reversed(node) {
    const css = getComputedStyle(node);
    return /flex/.test(css.display) && css.flexDirection === 'column-reverse';
  }
  function fromEnd(node) {
    const max = node.scrollHeight - node.clientHeight;
    if (max <= 0) return 0;
    return node.scrollTop < 0 || reversed(node) ? Math.abs(node.scrollTop) : max - node.scrollTop;
  }
  // Remaining offset of a running shift, without reading computed transforms.
  function remaining(shift) {
    const t = Math.min(1, (performance.now() - shift.start) / shift.duration);
    // cubic-bezier(0.22,1,0.36,1) is close to easeOutQuint; good enough to chain
    return shift.from * Math.pow(1 - t, 5);
  }
  function arrive(items, scroller) {
    if (!enabled() || !scroller || !items.length) return 0;
    if (fromEnd(scroller) > 3) return 0; // reading history: leave the view alone
    const list =
      items[0].parentElement && scroller.contains(items[0].parentElement)
        ? items[0].parentElement
        : null;
    if (!list || list === scroller) return 0;
    let delta = 0;
    for (const item of items) delta += item.offsetHeight;
    if (delta < 1) return 0;
    delta = Math.min(delta, scroller.clientHeight);
    const previous = shifts.get(list);
    const from = delta + (previous ? remaining(previous) : 0);
    previous?.animation.cancel();
    moving(scroller.closest('.aio') || scroller, DURATION + 40);
    // `translate`, not `transform`: a virtual list may position itself with
    // transform, and an animation of the same property would override it.
    const animation = list.animate(
      [{ translate: `0 ${from}px` }, { translate: '0 0' }],
      { duration: DURATION, easing: EASE }
    );
    const shift = { animation, from, start: performance.now(), duration: DURATION };
    shifts.set(list, shift);
    const done = () => {
      if (shifts.get(list) === shift) shifts.delete(list);
    };
    animation.finished.then(done, done);
    for (const item of items) {
      const self = !!item.querySelector('.message-container--self, .container--self');
      const bubble = item.querySelector('.message-content__wrapper') || item;
      bubble.style.transformOrigin = self ? '100% 100%' : '0 100%';
      play(
        bubble,
        [
          { opacity: 0, scale: '0.94' },
          { opacity: 1, scale: '1' }
        ],
        { duration: 220, delay: 30, easing: EASE }
      );
    }
    return items.length;
  }

  window.LiuliMotion = Object.freeze({
    play,
    arrive,
    moving,
    get reduced() {
      return preference.matches;
    }
  });
})();
