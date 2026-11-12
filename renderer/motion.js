(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map();
  const messages = new Set();
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
    messages.clear();
  }
  preference.addEventListener('change', () => {
    if (preference.matches) cancelAll();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAll();
  });

  function enterMessages(items) {
    if (!enabled() || !items.length) return 0;
    const viewport = window.LiuliComposer?.viewport();
    if (!viewport) return 0;
    const bounds = viewport.getBoundingClientRect();
    const top = Math.max(0, bounds.top);
    const bottom = Math.min(innerHeight, bounds.bottom);
    if (bottom <= top) return 0;
    const visible = [];
    // Measure once per candidate, before starting any animation. Prefer recent messages.
    for (const item of [...new Set(items)].reverse()) {
      if (!item.isConnected || item.querySelector('video,webview,embed,.video-element,.container--personalization')) continue;
      const rect = item.getBoundingClientRect();
      if (
        rect.width < 1 ||
        rect.height < 1 ||
        rect.bottom <= top ||
        rect.top >= bottom ||
        rect.right <= Math.max(0, bounds.left) ||
        rect.left >= Math.min(innerWidth, bounds.right)
      )
        continue;
      const bubble = item.querySelector('.message-content__wrapper') || item;
      visible.push({ bubble, top: rect.top });
      if (visible.length === 8) break;
    }
    visible.sort((a, b) => a.top - b.top);
    let started = 0;
    visible.forEach(({ bubble }, index) => {
      // Bursts arriving in successive frames share the same animation budget.
      if (messages.size >= 8) {
        const oldest = messages.values().next().value;
        messages.delete(oldest);
        oldest.cancel();
      }
      const animation = play(
        bubble,
        [
          { opacity: .65, translate: '0 4px' },
          { opacity: 1, translate: '0 0' }
        ],
        {
          duration: 180,
          delay: Math.min(index * 12, 84),
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
        }
      );
      if (animation) {
        messages.add(animation);
        started += 1;
        const release = () => messages.delete(animation);
        animation.finished.then(release, release);
      }
    });
    return started;
  }

  window.LiuliMotion = Object.freeze({
    play,
    enterMessages,
    get reduced() {
      return preference.matches;
    }
  });
})();
