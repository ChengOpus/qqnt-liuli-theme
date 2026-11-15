/* Window base in the main window.
 *
 * The wallpaper (picture or video) sits under QQ's .global-container. In the
 * user's QQ (body.is-colorful-theme, 2026-11-15 diagnostics) the video layer,
 * its canvas and #app were all visible, opaque and correctly stacked, nothing
 * hit-testable in the container had a background, and still the window showed
 * a pale lavender picture instead of the video. What covers it is something
 * the hit test cannot see: a pseudo-element, or an element that takes no
 * pointer events, painting a full-window background inside the container.
 *
 * This finds such layers by what they are — covering most of the window and
 * painting a fill, an image, a backdrop filter, or being an <img>/<canvas>/
 * <video> — walking only the big boxes from .global-container down (plus the
 * pseudo-elements of html, body and #app), and marks them; CSS in
 * integration.css clears exactly the marked part. Nothing else of QQ's is
 * touched, and the marks are removed when the scope or the layout changes.
 */
(() => {
  'use strict';
  const MARK = 'data-liuli-cover';
  const MEDIA = new Set(['IMG', 'CANVAS', 'VIDEO', 'PICTURE', 'SVG']);
  let found = [];

  // the theme's own layers and surfaces, and QQ's transient full-window
  // masks (dialogs, viewers) are never cleared
  const SKIP = /dialog|modal|mask|overlay|popup|viewer|toast|mini-buddy|drawer|webview/i;
  function own(el) {
    if (el.id && el.id.indexOf('liuli-') === 0) return true;
    if (el.closest?.('[id^="liuli-"]')) return true;
    if (el.hasAttribute?.('data-liuli-surface')) return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    return SKIP.test(cls);
  }
  function paints(cs, pseudo) {
    if (!cs) return false;
    if (pseudo && (cs.content === 'none' || cs.content === 'normal' || cs.display === 'none')) return false;
    if (cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor || '');
    const alpha = m ? (m[1].split(',').length > 3 ? Number(m[1].split(',')[3]) : 1) : 0;
    return (
      alpha > 0.03 ||
      (cs.backgroundImage && cs.backgroundImage !== 'none') ||
      (cs.backdropFilter && cs.backdropFilter !== 'none')
    );
  }
  // A pseudo-element's own box cannot be measured; a positioned one with a
  // used size, or one on a host that already covers the window, counts.
  function pseudoCovers(cs, hostCovers, area) {
    const w = parseFloat(cs.width),
      h = parseFloat(cs.height);
    if (Number.isFinite(w) && Number.isFinite(h)) return w * h >= 0.6 * area;
    return hostCovers;
  }
  // on-screen part only: a virtual list is 300000px tall
  function covers(el, area) {
    const r = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return w * h >= 0.6 * area;
  }
  // QQ's window background is not inside a scroller or a message
  // …nor inside the page area beside the navigation: its white panes are
  // pages (Contacts, Channels …) and become glass panels (surfaces.js), they
  // are not a window background to remove.
  const LEAF = '.q-scroll-view, .virtual-scroll-area, .ml-list, .ml-area, .chat-msg-area, .ml-item, [data-liuli-composer-scroll], .chat-input-area, .container-content-view';
  function inspect(el, area, hostCovers, out, parts = ['self', 'before', 'after']) {
    // A part already cleared stays cleared while the box still covers the
    // window: re-reading it now would see the cleared style, drop the mark,
    // bring the fill back and mark it again on the next pass.
    const prev = (el.getAttribute(MARK) || '').split(' ').filter(Boolean);
    const marks = hostCovers ? prev.filter(part => parts.includes(part)) : [];
    if (marks.length === 3) return out.push({ el, marks });
    if (parts.includes('self') && hostCovers && !marks.includes('self')) {
      const cs = getComputedStyle(el);
      if (paints(cs, false) || (MEDIA.has(el.tagName.toUpperCase()) && cs.visibility !== 'hidden')) marks.push('self');
    }
    for (const which of ['before', 'after']) {
      if (!parts.includes(which) || marks.includes(which)) continue;
      const cs = getComputedStyle(el, '::' + which);
      if (paints(cs, true) && pseudoCovers(cs, hostCovers, area)) marks.push(which);
    }
    if (marks.length) out.push({ el, marks: ['self', 'before', 'after'].filter(part => marks.includes(part)) });
  }
  function scan() {
    const main = document.body?.dataset.liuliScope === 'main';
    const next = [];
    if (main) {
      const area = innerWidth * innerHeight;
      const container = document.querySelector('.global-container');
      if (area > 0 && container) {
        // html/body: pseudo-elements only (their own fill is under #app's).
        inspect(document.documentElement, area, true, next, ['before', 'after']);
        inspect(document.body, area, true, next, ['before', 'after']);
        const app = document.getElementById('app');
        if (app) inspect(app, area, true, next, ['after']); // ::before is the theme's wallpaper
        // Down from the container through boxes that still cover the window.
        const queue = [container];
        let budget = 400;
        while (queue.length && budget-- > 0) {
          const el = queue.shift();
          if (own(el)) continue;
          const big = covers(el, area);
          inspect(el, area, big, next);
          if (!big || el.matches(LEAF)) continue;
          for (const child of el.children) if (!own(child)) queue.push(child);
        }
        // The container itself: its own fill is already cleared by
        // foundation.css; marking it too is harmless and keeps the record.
      }
    }
    // apply marks
    const keep = new Set(next.map(x => x.el));
    for (const node of document.querySelectorAll('[' + MARK + ']'))
      if (!keep.has(node)) node.removeAttribute(MARK);
    for (const { el, marks } of next) {
      const value = marks.join(' ');
      if (el.getAttribute(MARK) !== value) el.setAttribute(MARK, value);
    }
    found = next;
    return next.length;
  }
  // for diagnostics: class names, size and the parts cleared — no text
  function report() {
    return found.map(({ el, marks }) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '')
          .replace(/\d{5,}/g, '#')
          .slice(0, 80),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        marks
      };
    });
  }
  window.LiuliBackdrop = Object.freeze({ scan, report });
})();
