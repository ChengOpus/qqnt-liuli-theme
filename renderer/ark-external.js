// Adapted from qqnt-liuli-theme @ dda858b7.
(() => {
  function recordOf(el) {
    return window.LiuliQQ.messageRecord(el);
  }
  function fixUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (!/^[a-z]+:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    return /^https?:\/\//i.test(u) ? u : '';
  }
  function arkUrl(rec) {
    const el = rec && Array.isArray(rec.elements) && rec.elements.find(x => x && x.arkElement);
    if (!el) return '';
    let data;
    try {
      data = JSON.parse(el.arkElement.bytesData);
    } catch (e) {
      return '';
    }
    for (const v of Object.values((data && data.meta) || {})) {
      if (!v || typeof v !== 'object') continue;
      const u = fixUrl(v.qqdocurl) || fixUrl(v.jumpUrl) || fixUrl(v.url);
      if (u) return u;
    }
    return '';
  }
  function installArkExternal(api) {
    if (window.__liuliArkExternal || !api || typeof api.openExternal !== 'function') return;
    window.__liuliArkExternal = true;
    const target = e => {
      if (window.qq_enhance || e.button !== 0) return '';
      const card =
        e.target &&
        e.target.closest &&
        e.target.closest('.ark-msg-content-container .ark-item-container');
      return card ? arkUrl(recordOf(card)) : '';
    };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'].forEach(type =>
      document.addEventListener(
        type,
        e => {
          const url = target(e);
          if (!url) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          if (type === 'click') api.openExternal(url).catch(() => {});
        },
        true
      )
    );
  }
  window.LiuliArk = { installArkExternal };
})();
