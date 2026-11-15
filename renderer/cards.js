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
    ".lucky-money,.container--personalization,.pic-element,.video-element,.market-face";
  // media inside a card (an icon drawn on a canvas, a preview) does not make
  // the message a picture; only media covering most of it does
  const MEDIA = "canvas,video,webview,embed,iframe";
  // Group announcements (群公告, user screenshot 2026-11-15) and other
  // templates whose names say notice/announce/ark were not hinted before.
  const CARD_HINT =
    ".ark-view-message,.ark-msg-content-container,.ark-item-container,.rich-ui-app-wrapper,[data-view-id],.forward-msg,.file-element,.normal-file,[class*='file-message'],[class*='card'],[class*='ark-'],[class*='notice'],[class*='announce'],[class*='bulletin']";
  function mediaMessage(wrapper) {
    const media = wrapper.querySelectorAll(MEDIA);
    if (!media.length) return false;
    const box = wrapper.getBoundingClientRect();
    const area = Math.max(1, box.width * box.height);
    for (const m of media) {
      const r = m.getBoundingClientRect();
      if (r.width * r.height >= area * 0.5) return true;
    }
    return false;
  }
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
    if (nodes.length > 600) return true;
    const box = wrapper.getBoundingClientRect();
    // not laid out yet (a row the virtual list is still measuring): try
    // again on a later pass instead of remembering it as done
    if (box.width < 40 || box.height < 20) return false;
    // Read everything first, write afterwards: one style/layout pass per card.
    const facts = [],
      byNode = new Map();
    for (const node of nodes) {
      if (node.closest(".liuli-owned-ui")) continue;
      const css = getComputedStyle(node);
      let bg = css.backgroundImage === "none" ? parse(css.backgroundColor) : null;
      let gradient = false;
      // a white sheet with a decorative picture on it is still a sheet; the
      // picture stays (data-liuli-card-keep-image)
      let keepImage = false;
      if (!bg && /url\(/.test(css.backgroundImage)) {
        const c = parse(css.backgroundColor);
        if (c && c.a >= 0.6) {
          bg = c;
          keepImage = true;
        }
      }
      // a plain white/black gradient sheet counts as a fill of that colour
      if (!bg && /^linear-gradient/.test(css.backgroundImage) && !/url\(/.test(css.backgroundImage)) {
        const stops = (css.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(Boolean);
        if (stops.length && stops.every((c) => neutral(c) && c.a >= 0.6) && stops.every((c) => (light(c) >= 0.9) === (light(stops[0]) >= 0.9) && (light(c) <= 0.16 || light(c) >= 0.9))) {
          bg = stops[0];
          gradient = true;
        }
      }
      const rect = bg && bg.a >= 0.6 && neutral(bg) ? node.getBoundingClientRect() : null;
      const fact = { node, css, bg: gradient || keepImage ? null : bg, sheetBg: bg, keepImage, rect, color: css.color };
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
      const l = light(f.sheetBg);
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
    if (!sheets.size && !rules.length) return true;
    for (const [node, l] of sheets) {
      set(node, "data-liuli-card-sheet", l < 0.5 ? "dark" : "light");
      if (byNode.get(node)?.keepImage) set(node, "data-liuli-card-keep-image", "");
    }
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
    return true;
  }

  // ── Card messages QQ draws on a canvas ────────────────────────────────
  // QQ 9.9.36 renders ark cards (群公告 and other templates) as pixels:
  // .ark-item-container > canvas.ark-view-message (user diagnostics
  // 2026-11-15, cardRows). There is nothing inside to restyle, so the white
  // sheet becomes see-through with a colour-to-alpha filter: the paler a
  // pixel, the more transparent (white fully), its colour unchanged — text
  // stays dark, icons keep their hue, and the bubble's glass shows where the
  // white was. A dark card (QQ in dark mode) the same with black. Only cards
  // that are mostly plain white/black are filtered: a card showing a picture
  // (a link preview, a mini-program cover) stays as it is, and a canvas QQ
  // drew a remote picture into cannot be sampled and is left alone too.
  const ARK_K = 1.8;
  function arkFilters() {
    if (document.getElementById("liuli-ark-filters")) return;
    const k = ARK_K, t = (k / 3).toFixed(4);
    const box = document.createElement("div");
    box.id = "liuli-ark-filters";
    box.className = "liuli-owned-ui";
    box.setAttribute("aria-hidden", "true");
    box.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    box.innerHTML =
      '<svg width="0" height="0" focusable="false">' +
      '<filter id="liuli-ark-light" color-interpolation-filters="sRGB" x="0" y="0" width="1" height="1">' +
      '<feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -' + t + " -" + t + " -" + t + " 0 " + k + '" result="m"/>' +
      '<feComposite in="m" in2="SourceAlpha" operator="in"/></filter>' +
      '<filter id="liuli-ark-dark" color-interpolation-filters="sRGB" x="0" y="0" width="1" height="1">' +
      '<feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  ' + t + " " + t + " " + t + ' 0 0" result="m"/>' +
      '<feComposite in="m" in2="SourceAlpha" operator="in"/></filter></svg>';
    document.body.append(box);
  }
  const arkTries = new WeakMap();
  let sampler = null;
  // "light" | "dark" | "keep" (a picture, or cannot be read) | null (not drawn yet)
  function arkKind(canvas) {
    if (!canvas.width || !canvas.height) return null;
    sampler ||= document.createElement("canvas");
    sampler.width = 24;
    sampler.height = 16;
    const ctx = sampler.getContext("2d", { willReadFrequently: true });
    let data;
    try {
      ctx.clearRect(0, 0, 24, 16);
      ctx.drawImage(canvas, 0, 0, 24, 16);
      data = ctx.getImageData(0, 0, 24, 16).data;
    } catch (e) {
      return "keep";
    }
    let opaque = 0, white = 0, black = 0, colour = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      opaque++;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
      if (lo >= 232) white++;
      else if (hi <= 44) black++;
      if (hi - lo > 70) colour++;
    }
    if (opaque < 40) return null;
    if (colour / opaque > 0.18) return "keep";
    if (white / opaque >= 0.55) return "light";
    if (black / opaque >= 0.55) return "dark";
    return "keep";
  }
  // The list reuses rows: a canvas now showing another message is looked at
  // again.
  const arkKeys = new WeakMap();
  function arkCanvas(canvas) {
    const key = (canvas.closest(".ml-item")?.id || "") + ":" + canvas.width + "x" + canvas.height;
    if (arkKeys.get(canvas) !== key) {
      arkKeys.set(canvas, key);
      arkTries.delete(canvas);
      canvas.removeAttribute("data-liuli-ark-glass");
      canvas.closest(".msg-content-container")?.removeAttribute("data-liuli-ark-bubble");
    }
    if (canvas.hasAttribute("data-liuli-ark-glass")) return;
    const kind = arkKind(canvas);
    if (kind) {
      if (kind !== "keep") arkFilters();
      canvas.setAttribute("data-liuli-ark-glass", kind);
      // the bubble around it becomes an ordinary message bubble: the same
      // fill and blur as a text message from the same side (user, .31: the
      // card was a faint pane, not the glass the other messages have)
      const bubble = canvas.closest(".msg-content-container");
      if (bubble) {
        if (kind !== "keep") set(bubble, "data-liuli-ark-bubble", "");
        else bubble.removeAttribute("data-liuli-ark-bubble");
      }
      return;
    }
    // not drawn yet: look again a few times
    const n = (arkTries.get(canvas) || 0) + 1;
    arkTries.set(canvas, n);
    if (n <= 8) setTimeout(() => canvas.isConnected && arkKeys.get(canvas) === key && arkCanvas(canvas), 150 * n);
  }
  function adapt(root) {
    if (!root || document.body.hasAttribute("data-liuli-av")) return;
    for (const canvas of D.within(root, "canvas.ark-view-message")) arkCanvas(canvas);
    for (const wrapper of D.within(root, ".message-content__wrapper")) {
      // Plain text bubbles are the overwhelming majority: one query, no reads.
      if (!wrapper.querySelector(CARD_HINT)) continue;
      if (wrapper.querySelector(SKIP) || !D.safe(wrapper) || mediaMessage(wrapper)) continue;
      const size = wrapper.getElementsByTagName("*").length;
      if (done.get(wrapper) === size) continue;
      try {
        if (classify(wrapper) !== false) done.set(wrapper, size);
      } catch (e) {
        done.set(wrapper, size);
      }
    }
  }
  // For diagnostics: visible messages that still paint a large white or black
  // sheet the classifier did not take — structure only (tags, classes,
  // sizes, fills), never text.
  function misses() {
    const out = [];
    for (const wrapper of document.querySelectorAll(".message-content__wrapper")) {
      if (out.length >= 6) break;
      const box = wrapper.getBoundingClientRect();
      if (box.bottom < 0 || box.top > innerHeight || box.width < 40) continue;
      let hit = null;
      for (const node of wrapper.querySelectorAll("*")) {
        if (node.hasAttribute("data-liuli-card-sheet")) continue;
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (!bg || bg.a < 0.5 || !neutral(bg) || (light(bg) < 0.9 && light(bg) > 0.16)) continue;
        const r = node.getBoundingClientRect();
        if (r.width >= box.width * 0.6 && r.height >= 28) {
          hit = node;
          break;
        }
      }
      if (!hit) continue;
      const tree = [];
      const walk = (n, depth) => {
        if (depth > 7 || tree.length > 40) return;
        const r = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        tree.push(
          "  ".repeat(depth) + n.tagName.toLowerCase() + "." + String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className || "").replace(/\d{5,}/g, "#").slice(0, 70) +
            " [" + Math.round(r.width) + "x" + Math.round(r.height) + "] " + cs.backgroundColor + (cs.backgroundImage !== "none" ? " +img" : ""),
        );
        for (const c of n.children) walk(c, depth + 1);
      };
      walk(wrapper, 0);
      out.push({
        hinted: !!wrapper.querySelector(CARD_HINT),
        skipped: !!wrapper.querySelector(SKIP) || mediaMessage(wrapper),
        safe: D.safe(wrapper),
        tree,
      });
    }
    return out;
  }
  // For diagnostics: messages titled 群公告 (group announcements), found by
  // that fixed title only; recorded as structure — tags, classes, sizes,
  // fills, pseudo-element fills, marks — never text. Rows the list keeps off
  // screen count too.
  function notices() {
    const out = [];
    const titled = [];
    for (const node of document.querySelectorAll(".ml-item span, .ml-item div, .ml-item p")) {
      if (titled.length >= 3) break;
      if (node.children.length === 0 && node.textContent.trim() === "群公告") titled.push(node);
    }
    for (const title of titled) {
      const item = title.closest(".ml-item");
      const root = title.closest(".message-content__wrapper") || item;
      const describe = (n) => {
        const r = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        const pseudo = (which) => {
          const p = getComputedStyle(n, which);
          if (p.content === "none" || p.content === "normal") return "";
          return which + ":" + p.backgroundColor + (p.backgroundImage !== "none" ? "+img" : "") + (p.boxShadow !== "none" ? "+shadow" : "");
        };
        const marks = [...n.attributes].filter((a) => a.name.startsWith("data-liuli")).map((a) => a.name.slice(11));
        return (
          n.tagName.toLowerCase() + "." + String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className || "").replace(/\d{5,}/g, "#").slice(0, 70) +
          " [" + Math.round(r.width) + "x" + Math.round(r.height) + "] " + cs.backgroundColor +
          (cs.backgroundImage !== "none" ? (/url\(/.test(cs.backgroundImage) ? " +url" : " +gradient") : "") +
          (cs.boxShadow !== "none" ? " +shadow" : "") +
          (cs.opacity !== "1" ? " op" + cs.opacity : "") +
          " " + pseudo("::before") + " " + pseudo("::after") +
          (marks.length ? " {" + marks.join(",") + "}" : "")
        );
      };
      const tree = [];
      const walk = (n, depth) => {
        if (depth > 9 || tree.length > 60) return;
        tree.push("  ".repeat(depth) + describe(n));
        for (const c of n.children) walk(c, depth + 1);
      };
      walk(root, 0);
      const up = [];
      for (let n = root.parentElement; n && n !== item?.parentElement && up.length < 8; n = n.parentElement) up.push(describe(n));
      out.push({ inWrapper: !!title.closest(".message-content__wrapper"), hinted: !!root.querySelector(CARD_HINT), skipped: !!root.querySelector(SKIP), tree, up });
    }
    return out;
  }
  function arks() {
    return [...document.querySelectorAll("canvas.ark-view-message")].slice(0, 12).map((c) => {
      const r = c.getBoundingClientRect();
      return { size: [c.width, c.height], rect: [Math.round(r.width), Math.round(r.height)], glass: c.getAttribute("data-liuli-ark-glass") || "", filter: getComputedStyle(c).filter.slice(0, 40) };
    });
  }
  window.LiuliCards = Object.freeze({ adapt, misses, notices, arks });
})();
