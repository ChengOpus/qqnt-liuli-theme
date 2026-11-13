/* Card-type messages (mail reminders, share / mini-program cards, file cards,
 * any message that brings its own opaque sheet).
 *
 * These are rendered by the client from templates the theme cannot enumerate:
 * the sheet is a hard white (or, in dark mode, near-black) fill with fixed
 * black/grey text, sitting inside the theme's glass bubble as a second box.
 * Class names differ per template, so nothing here matches on class names of
 * the card's inside. Each card is measured once and classified by what it
 * actually paints:
 *   sheet — large, opaque, colourless, near-white / near-black fill
 *   ink   — colourless text on such a sheet, by lightness (1 / 2 / 3)
 *   line  — colourless hairline (border or ≤1.5px rule)
 * Marked nodes get theme colours through cards.css. Anything with a colour of
 * its own (brand buttons, tags, pictures, media, red packets) is left alone.
 * Only data-* attributes are written; no native style, class or node changes.
 */
(() => {
  "use strict";
  const D = window.LiuliDOM;
  const done = new WeakMap(); // wrapper -> descendant count when classified
  const SKIP =
    "canvas,video,webview,embed,iframe,.lucky-money,.container--personalization,.pic-element,.video-element,.market-face";
  const CARD_HINT =
    ".ark-view-message,.ark-msg-content-container,.ark-item-container,.rich-ui-app-wrapper,[data-view-id],.forward-msg,.file-element,.normal-file,[class*='file-message'],[class*='card']";
  function parse(color) {
    const m = /rgba?\(([^)]+)\)/.exec(color || "");
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  const neutral = (c) =>
    Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 14;
  const light = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  function set(node, name, value) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  function ownText(node) {
    for (const child of node.childNodes)
      if (child.nodeType === 3 && child.nodeValue.trim()) return true;
    return false;
  }
  function classify(wrapper) {
    const nodes = [wrapper, ...wrapper.querySelectorAll("*")];
    if (nodes.length > 600) return;
    const box = wrapper.getBoundingClientRect();
    if (box.width < 40 || box.height < 20) return;
    // Read everything first, write afterwards: one style/layout pass per card.
    const facts = [],
      byNode = new Map();
    for (const node of nodes) {
      if (node.closest(".liuli-owned-ui")) continue;
      const css = getComputedStyle(node);
      const bg = css.backgroundImage === "none" ? parse(css.backgroundColor) : null;
      const rect = bg && bg.a >= 0.9 && neutral(bg) ? node.getBoundingClientRect() : null;
      const fact = { node, css, bg, rect, color: css.color };
      facts.push(fact);
      byNode.set(node, fact);
    }
    // sheet node -> its native lightness (kept in the attribute, because once
    // marked the fill computes as transparent and a later pass could not tell).
    const sheets = new Map(),
      rules = [];
    for (const f of facts) {
      const known = f.node.getAttribute("data-liuli-card-sheet");
      if (known) {
        sheets.set(f.node, known === "dark" ? 0.1 : 1);
        continue;
      }
      if (!f.rect) continue;
      const l = light(f.bg);
      // A hairline is a hairline in any grey.
      if (f.rect.height <= 1.5 && f.rect.width >= box.width * 0.4) {
        rules.push(f.node);
        continue;
      }
      if (l < 0.9 && l > 0.16) continue; // mid greys are deliberate fills
      if (
        f.rect.width >= box.width * 0.6 &&
        f.rect.height >= 28 &&
        f.node.textContent.trim() !== ""
      )
        sheets.set(f.node, l);
    }
    if (!sheets.size && !rules.length) return;
    for (const [node, l] of sheets)
      set(node, "data-liuli-card-sheet", l < 0.5 ? "dark" : "light");
    // Tell the framing bubble directly; a :has() rule for this would be
    // re-evaluated for every bubble on every message change.
    if (sheets.size) {
      const bubble = wrapper.querySelector(
        ":scope > .msg-content-container.ark-msg-content-container, :scope > .msg-content-container:has(.ark-view-message)",
      );
      if (bubble) set(bubble, "data-liuli-card", "");
    }
    rules.forEach((node) => set(node, "data-liuli-card-rule", ""));
    const sheetOf = (node) => {
      for (let p = node; p && p !== wrapper.parentElement; p = p.parentElement)
        if (sheets.has(p)) return p;
      return null;
    };
    for (const f of facts) {
      // Ink and hairlines only inside a sheet that became glass.
      const sheet = sheetOf(f.node);
      if (!sheet) continue;
      for (const side of ["Top", "Bottom"]) {
        const width = parseFloat(f.css["border" + side + "Width"]) || 0,
          c = width > 0 && width <= 2 ? parse(f.css["border" + side + "Color"]) : null;
        if (c && c.a > 0.2 && neutral(c)) set(f.node, "data-liuli-card-line", "");
      }
      if (!ownText(f.node)) continue;
      // A fill of its own between the text and the sheet keeps its text colour.
      let covered = false;
      for (let p = f.node; p && p !== sheet; p = p.parentElement) {
        const own = byNode.get(p);
        if (
          own &&
          ((own.bg && own.bg.a > 0.3 && (!neutral(own.bg) || (light(own.bg) > 0.16 && light(own.bg) < 0.9))) ||
            own.css.backgroundImage !== "none")
        ) {
          covered = true;
          break;
        }
      }
      if (covered || f.node.hasAttribute("data-liuli-ink")) continue;
      const ink = parse(f.color);
      if (!ink || ink.a < 0.3 || !neutral(ink)) continue;
      // Distance from the sheet's own lightness tells primary from secondary.
      const contrast = Math.abs(light(ink) - sheets.get(sheet)) * (ink.a || 1);
      set(f.node, "data-liuli-ink", contrast > 0.72 ? "1" : contrast > 0.3 ? "2" : "3");
    }
  }
  function adapt(root) {
    if (!root || document.body.hasAttribute("data-liuli-av")) return;
    for (const wrapper of D.within(root, ".message-content__wrapper")) {
      // Plain text bubbles are the overwhelming majority: one query, no reads.
      if (!wrapper.querySelector(CARD_HINT)) continue;
      if (wrapper.querySelector(SKIP) || !D.safe(wrapper)) continue;
      const size = wrapper.getElementsByTagName("*").length;
      if (done.get(wrapper) === size) continue;
      done.set(wrapper, size);
      try {
        classify(wrapper);
      } catch (e) {}
    }
  }
  window.LiuliCards = Object.freeze({ adapt });
})();
