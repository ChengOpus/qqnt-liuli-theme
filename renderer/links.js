/* Links in messages open straight in the browser.
 *
 * QQ hands a clicked web link to the browser wrapped in its own safety page
 * (c.pc.qq.com/middlem.html?pfurl=…&pfuin=<QQ number>…), where the link has
 * to be copied out by hand (user request, 2026-11-15). A left click on a
 * link in a message is taken here instead: the link is read from the link
 * itself (its address, or its text when that is a web address) and opened
 * through the theme's host, which only opens http(s) links. A link whose
 * address cannot be read (a hyperlink with other text) is left to QQ; the
 * host's guard (load.js installLinkGuard) unwraps QQ's safety page for those
 * and for every other place QQ opens a web link from. Setting: directLinks.
 */
(() => {
  'use strict';
  let enabled = true;
  const debug = { opened: 0, left: 0, last: '' };
  const LINK = 'a[href], .text-link, .text--link, [class*="text-link"], [class*="link-element"]';
  const INSIDE = '.ml-item, .message-content, .msg-content-container, .message-container';
  function webAddress(raw) {
    let text = String(raw || '').trim().replace(/[​-‏⁠﻿]/g, '');
    if (!text || /\s/.test(text) || text.length > 4096) return '';
    if (/^(javascript|data|file|vbscript|about|blob|app|chrome|qq|tencent):/i.test(text)) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      // www.example.com/path, docs.qq.com/sheet/… : a host with a dot
      if (!/^([\w-]+\.)+[a-z]{2,}(:\d+)?([/?#]|$)/i.test(text)) return '';
      text = 'http://' + text;
    }
    try {
      const url = new URL(text);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (e) {
      return '';
    }
  }
  function linkOf(event) {
    if (!enabled || event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return null;
    const el = event.target?.closest?.(LINK);
    if (!el || !el.closest(INSIDE)) return null;
    // the theme's own UI and the composer (editing a link) are not messages
    // (card messages have their own opener, ark-external.js)
    if (el.closest('.liuli-owned-ui, .chat-input-area, [contenteditable="true"], .ark-msg-content-container')) return null;
    const href = el.getAttribute('href');
    const url =
      (href && webAddress(href)) ||
      webAddress(el.getAttribute('data-href')) ||
      webAddress(el.getAttribute('data-url')) ||
      webAddress(el.getAttribute('title')) ||
      webAddress(el.textContent);
    return url ? { el, url } : null;
  }
  function onEvent(event) {
    const hit = linkOf(event);
    if (!hit) return;
    // QQ's own handler never sees the press (it may open on press rather
    // than on click, which would open the link twice)
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== 'click') return;
    const host = window.LiuliHost;
    if (!host?.openExternal) {
      debug.left++;
      return;
    }
    debug.opened++;
    try {
      debug.last = new URL(hit.url).hostname;
    } catch (e) {}
    host.openExternal(hit.url).catch(() => {});
  }
  let installed = false;
  function install() {
    if (installed) return;
    installed = true;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick'])
      document.addEventListener(type, onEvent, true);
  }
  function configure(next) {
    if (next && 'enabled' in next) enabled = next.enabled !== false;
  }
  window.LiuliLinks = Object.freeze({ install, configure, webAddress, debug: () => ({ enabled, ...debug }) });
})();
