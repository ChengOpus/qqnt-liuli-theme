/* Measures the active composer and the message viewport behind it.
 *
 * The floating layout itself is static CSS (composer.css / shell.css) keyed on
 * native structure, so it cannot "drop out" when this controller misses a frame,
 * when the editor is momentarily zero-sized, or when an ancestor is hidden.
 * This file only: finds the real scroll container, publishes the clearances,
 * bridges non-standard nesting, and owns the local proxy buttons. Native editor
 * nodes stay in place, including composition and selection. */
(() => {
  "use strict";
  const D = window.LiuliDOM;
  const MARKS = {
    host: "data-liuli-composer-host",
    region: "data-liuli-message-region",
    scroll: "data-liuli-composer-scroll",
    bridge: "data-liuli-composer-bridge",
    column: "data-liuli-chat-column",
    shell: "data-liuli-chat-shell",
  };
  let active = null,
    pane = null,
    host = null,
    region = null,
    scroll = null,
    overlay = null,
    installed = false,
    tools = null,
    exit = null,
    hideTimer = 0;
  const seenAttachments = new WeakSet();
  const headerFails = new WeakMap();
  // ── Input feedback ───────────────────────────────────────────────────────
  // Everything visual happens on one small theme-owned box behind the editor
  // and on the send button's colour (see composer.css for why it is a repaint
  // and not a compositor animation). Nothing is drawn at the caret, no native
  // text/selection/IME node is animated, and a keystroke costs two attribute
  // comparisons and a timer reset — no layout read.
  // Kinds: type | delete | attach | drop.
  let fx = null,
    fxTimer = 0,
    readyFrame = 0;
  function glow(kind, hold = 460) {
    if (!area() || window.LiuliMotion.reduced || document.hidden) return;
    if (!fx) {
      fx = document.createElement("div");
      fx.className = "liuli-composer-fx liuli-owned-ui";
      fx.setAttribute("aria-hidden", "true");
    }
    if (fx.parentElement !== active) active.append(fx);
    // `kind` picks the colour and outlives the light, so the fade-out keeps
    // its colour; `fx` is the on/off switch the transition follows.
    if (fx.dataset.kind !== kind) fx.dataset.kind = kind;
    if (fx.dataset.fx !== "1") fx.dataset.fx = "1";
    const dropping = kind === "drop";
    if (active.hasAttribute("data-liuli-drop") !== dropping)
      active.toggleAttribute("data-liuli-drop", dropping);
    clearTimeout(fxTimer);
    const owner = active;
    fxTimer = setTimeout(() => {
      if (fx) delete fx.dataset.fx;
      owner.removeAttribute("data-liuli-drop");
    }, hold);
  }
  // The send button lights up when there is something to send.
  function syncReady() {
    readyFrame = 0;
    const input = area();
    if (!input) return;
    const editor = input.querySelector(".ProseMirror, [contenteditable]");
    const ready =
      !!editor &&
      (editor.textContent.trim() !== "" ||
        !!editor.querySelector(
          "img,.image-element,.file-element,.file-card,[class*='face']",
        ));
    if (input.hasAttribute("data-liuli-ready") !== ready)
      input.toggleAttribute("data-liuli-ready", ready);
  }
  function scheduleReady() {
    if (!readyFrame) readyFrame = requestAnimationFrame(syncReady);
  }
  // Rendered = takes part in layout. A focused or re-rendering editor can be
  // zero-sized for a frame; that is not "gone". A cached conversation hidden
  // through display:none has no boxes at all.
  function rendered(node) {
    return (
      !!node?.isConnected &&
      node.getClientRects().length > 0 &&
      getComputedStyle(node).visibility !== "hidden"
    );
  }
  function area() {
    return active?.isConnected ? active : null;
  }
  function bar() {
    return area()?.querySelector(".chat-func-bar") || null;
  }
  function setMark(node, name) {
    if (node && !node.hasAttribute(name)) node.setAttribute(name, "");
  }
  function closeTools() {
    clearTimeout(hideTimer);
    exit?.cancel();
    exit = null;
    if (tools) {
      tools.classList.remove("liuli-expanded");
      delete tools.dataset.liuliTools;
      tools.style.removeProperty("pointer-events");
      tools = null;
    }
  }
  function unmark(root) {
    for (const name of Object.values(MARKS))
      for (const node of D.within(root, "[" + name + "]"))
        node.removeAttribute(name);
  }
  // Leaving chat-capable windows entirely. Ordinary conversation switches never
  // come here: marks on a cached pane stay valid for that pane.
  function clean() {
    closeTools();
    overlay?.remove();
    overlay = null;
    clearTimeout(fxTimer);
    fx?.remove();
    fx = null;
    for (const node of document.querySelectorAll("[data-liuli-composer]")) {
      node.removeAttribute("data-liuli-composer");
      node.removeAttribute("data-liuli-ready");
      node.removeAttribute("data-liuli-drop");
    }
    unmark(document.body);
    for (const node of document.querySelectorAll("[data-liuli-noscroll]"))
      node.removeAttribute("data-liuli-noscroll");
    for (const node of document.querySelectorAll("[data-liuli-chat-pane]")) {
      node.removeAttribute("data-liuli-chat-pane");
      node.removeAttribute("data-liuli-header");
      node.style.removeProperty("--ll-header-clearance");
      node.style.removeProperty("--ll-composer-clearance");
    }
    active = pane = host = region = scroll = null;
  }
  // Structural marks for every chat pane, shown or cached, written from the
  // mutation callback before the frame renders. A cached private chat (whose
  // body card has no stable class) therefore floats its composer on the very
  // first frame it is shown. Pure DOM reads; no layout.
  function prime(root) {
    if (!(root instanceof Element) || !D.mainLike()) return;
    const areas = root.classList.contains("chat-input-area")
      ? [root]
      : root.getElementsByClassName("chat-input-area");
    for (const input of areas) {
      if (!input.querySelector(":scope > .msg-input")) continue;
      const parent = input.parentElement;
      if (!parent || parent.classList.contains("group-chat")) continue;
      let region = null;
      for (const child of parent.children)
        if (child.classList.contains("chat-msg-area")) region = child;
      if (!region) continue;
      setMark(parent, MARKS.host);
      setMark(region, MARKS.region);
      const pane = parent.closest(".aio");
      if (pane && pane !== parent && pane.querySelector(":scope > .chat-header"))
        setMark(parent, MARKS.column);
    }
  }
  function select() {
    const candidates = [
      ...document.querySelectorAll(".chat-input-area"),
    ].filter((n) => n.querySelector(".msg-input") && rendered(n));
    if (!candidates.length) return null;
    const focused = document.activeElement?.closest?.(".chat-input-area");
    if (focused && candidates.includes(focused)) return focused;
    const score = (n) =>
      (n.closest(".two-col-layout__main")
        ? 4
        : n.closest(".chat-container")
          ? 2
          : 0) +
      (D.visible(n) ? 1 : 0) +
      (n === active ? 0.5 : 0);
    return candidates.sort((a, b) => score(b) - score(a))[0];
  }
  function findRegion(input, limit) {
    for (let parent = input.parentElement; parent; parent = parent.parentElement) {
      const candidates = [...parent.querySelectorAll(".chat-msg-area")].filter(
        (node) => !node.closest(".viewport-list__measure") && rendered(node),
      );
      if (candidates.length)
        return candidates.find(D.visible) || candidates[0];
      if (parent === limit) break;
    }
    return null;
  }
  // The element that really scrolls. QQ has nested the list several ways
  // (.chat-msg-area__vlist, .ml-area, .q-scroll-view); padding anything else
  // only shrinks the viewport instead of letting messages pass behind the editor.
  function scrollable(node) {
    const value = getComputedStyle(node).overflowY;
    return value === "auto" || value === "scroll" || value === "overlay";
  }
  // QQ 9.9.36 (from a user's diagnostics): main.chat-msg-area (overflow auto,
  // never scrolls) > .ml-area.chat-msg-area__vlist (overflow auto, never
  // scrolls) > .q-scroll-view.ml-container.ml-root (the real scroller) >
  // .virtual-scroll-area (300 000px) > .ml-list (sticky) > .ml-item. Several
  // ancestors claim overflow:auto; the one that matters is the nearest one
  // above the rows. Before any row exists there is no answer yet: return null
  // and decide again when rows arrive (runtime asks via needsScroller()).
  function findScroller(target) {
    const row = target.querySelector(".ml-item,.message-container,.message");
    if (!row) return null;
    let nearest = null;
    for (let node = row.parentElement; node && target.contains(node); node = node.parentElement) {
      if (!scrollable(node)) continue;
      if (node.scrollHeight > node.clientHeight + 1) return node;
      nearest ??= node; // a short chat: nothing overflows yet
    }
    return nearest;
  }
  const ROW = ".ml-item,.message-container,.message";
  function needsScroller() {
    return !!(region?.isConnected && (!scroll?.isConnected || !scroll.querySelector(ROW)) && region.querySelector(ROW));
  }
  // ── Staying at the newest message ────────────────────────────────────────
  // The editor's clearance is end padding on the scroll container. The client
  // scrolls a conversation to its end when it opens; if that happens before
  // the padding exists (or the padding grows while typing), the view is left
  // exactly one clearance short and the newest message sits under the editor.
  // Whenever the padding appears or grows while the view is at the end, the
  // view is put back at the end. A reader who has scrolled away is never moved.
  let settleUntil = 0,
    touchedAt = 0,
    settleTimers = [];
  function reversed(node) {
    const css = getComputedStyle(node);
    return /flex/.test(css.display) && css.flexDirection === "column-reverse";
  }
  // Distance from the newest end, in px (0 = at the end).
  function fromEnd(node) {
    const max = node.scrollHeight - node.clientHeight;
    if (max <= 0) return 0;
    return node.scrollTop < 0 || reversed(node)
      ? Math.abs(node.scrollTop)
      : max - node.scrollTop;
  }
  function toEnd(node) {
    node.scrollTop = reversed(node) ? 0 : node.scrollHeight;
  }
  function makeOverlay() {
    const result = document.createElement("div");
    result.id = "liuli-input-overlay";
    result.className = "liuli-owned-ui";
    const more = document.createElement("button");
    more.id = "liuli-func-toggle";
    more.type = "button";
    more.title = "更多";
    more.setAttribute("aria-label", "更多");
    more.innerHTML = window.LiuliIcons.svg("更多");
    more.addEventListener("click", () =>
      expand(!bar()?.classList.contains("liuli-expanded")),
    );
    result.append(more);
    return result;
  }
  // The pinned items are QQ's own toolbar icons (composer.css places them
  // beside "+"); here they only get their slot index and the editor its
  // left padding.
  function syncPins() {
    if (!active || !overlay) return;
    const labels = window.LiuliLayout.applyBar();
    pinIcons = [];
    labels.forEach((label, i) => {
      const icon = window.LiuliLayout.nativeBarItem(label)?.closest(".bar-icon");
      if (icon && icon.style.getPropertyValue("--liuli-pin-i") !== String(i))
        icon.style.setProperty("--liuli-pin-i", String(i));
      if (icon) pinIcons.push(icon);
    });
    place(rows);
  }
  // A longer draft folds "+" and the pinned icons out of the text's way
  // (user, 2026-11-15): one line — a row; two lines — the last icon steps up
  // above "+" (a triangle); three lines — all of them in a column at the
  // left edge. Each step moves as few icons as possible, and they glide
  // there (composer.css). The text gets the freed width back.
  //
  // rows = how many 32px rows the icons use. Slot of button j (0 = "+"):
  // the first C buttons along the bottom row (C = columns needed), the rest
  // stacked above "+" with the last button lowest, so going from a triangle
  // to a column only the middle one moves.
  let pinIcons = [],
    rows = 1,
    moveTimer = 0;
  function slots(n, r) {
    const cols = Math.ceil(n / r);
    const out = [];
    for (let j = 0; j < n; j++) {
      if (j < cols) out.push([j, 0]);
      else {
        const idx = n - 1 - j;
        out.push([Math.floor(idx / (r - 1)), 1 + (idx % (r - 1))]);
      }
    }
    return { cols, out };
  }
  function place(r) {
    if (!active) return;
    const n = pinIcons.length + 1;
    r = Math.max(1, Math.min(r, n));
    if (r !== rows) {
      active.setAttribute("data-liuli-bar-moving", "");
      clearTimeout(moveTimer);
      const host = active;
      moveTimer = setTimeout(() => host.removeAttribute("data-liuli-bar-moving"), 260);
    }
    rows = r;
    const { cols, out } = slots(n, r);
    pinIcons.forEach((icon, i) => {
      const [col, row] = out[i + 1];
      variable(icon, "--liuli-pin-col", String(col));
      variable(icon, "--liuli-pin-row", String(row));
    });
    variable(active, "--liuli-bar-pad", textInset(cols) + "px");
    if (r > 1) {
      if (active.getAttribute("data-liuli-bar-rows") !== String(r)) active.setAttribute("data-liuli-bar-rows", String(r));
      variable(active, "--liuli-stack-h", 12 + r * 32 + "px");
    } else if (active.hasAttribute("data-liuli-bar-rows")) active.removeAttribute("data-liuli-bar-rows");
  }
  // Where the text starts. With the icons in a row or a triangle: 12px after
  // the last icon. With a column, the text sits as far from the left edge as
  // it does from the right one (user, 2026-11-15: the two sides differed),
  // and never closer than 8px to the icons. Measured, so padding QQ's editor
  // brings of its own is taken into account.
  function textInset(cols) {
    const iconsEnd = 8 + cols * 32 - 4;
    const fallback = cols === 1 ? 48 : iconsEnd + 12;
    const editor = active?.querySelector(".ProseMirror, [contenteditable]");
    const input = active?.querySelector(":scope > .msg-input");
    if (!editor || !input) return fallback;
    const box = active.getBoundingClientRect();
    const ed = editor.getBoundingClientRect();
    if (box.width < 100 || ed.width < 40) return fallback;
    const ecs = getComputedStyle(editor);
    const textLeft = ed.left + (parseFloat(ecs.paddingLeft) || 0);
    const textRight = ed.right - (parseFloat(ecs.paddingRight) || 0);
    const rightInset = box.right - textRight;
    const leftInset = textLeft - box.left;
    const pad = parseFloat(getComputedStyle(input).paddingLeft) || 0;
    const want = cols === 1 ? Math.max(iconsEnd + 8, rightInset) : iconsEnd + 12;
    // the part of the inset that is not this padding (QQ's own editor padding)
    const other = leftInset - pad;
    return Math.max(0, Math.round(want - other));
  }
  // Lines of text in the editor now, and whether every line would still fit
  // if the text were `less` px narrower (so a step back to a wider icon
  // layout never re-wraps the text and flips the layout back and forth).
  // Text lines are counted from the text's own line boxes; empty lines and
  // pictures add theirs. A long draft is simply "many lines".
  const ZW = /[\s\u200b-\u200f\u2060\ufeff]/g;
  function measure(editor, less) {
    if (editor.textContent.length > 600) return { lines: 99, fits: false };
    const ed = editor.getBoundingClientRect();
    const limit = ed.right - (parseFloat(getComputedStyle(editor).paddingRight) || 0);
    const range = document.createRange();
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const tops = [];
    let fits = true,
      node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue.replace(ZW, "")) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width <= 0) continue;
        if (!tops.some((t) => Math.abs(t - r.top) < Math.max(4, r.height / 2))) tops.push(r.top);
        if (r.right + less > limit - 2) fits = false;
      }
    }
    let lines = tops.length;
    for (const block of editor.querySelectorAll("p, div"))
      if (!block.querySelector("p, div, img:not(.ProseMirror-separator)") && !block.textContent.replace(ZW, "")) lines++;
    for (const pic of editor.querySelectorAll("img:not(.ProseMirror-separator)")) {
      const h = pic.getBoundingClientRect().height;
      if (h > 30) {
        lines += Math.round(h / 24);
        fits = fits && pic.getBoundingClientRect().right + less <= limit - 2;
      }
    }
    return { lines: Math.max(1, lines), fits };
  }
  function stackBar() {
    if (!active || !overlay) return;
    const n = pinIcons.length + 1;
    const editor = active.querySelector(".ProseMirror, [contenteditable]");
    if (n < 2 || !editor) return place(1);
    // the "+" grid is open over the same corner, or a sticker is passing
    // through the editor unseen: keep what is there
    if (active.querySelector(":scope > .chat-func-bar.liuli-expanded") || active.hasAttribute("data-liuli-sticker-sending")) return;
    const empty =
      editor.textContent.replace(/[\s\u200b-\u200f\u2060\ufeff]/g, "") === "" &&
      !editor.querySelector("img:not(.ProseMirror-separator), .image-element, .face-element, .file-element");
    if (empty) return place(1);
    let next = rows;
    const { lines } = measure(editor, 0);
    if (lines > rows) next = Math.min(n, lines);
    else if (lines < rows) {
      // step down only as far as the text keeps its lines in the wider layout
      for (let r = rows - 1; r >= Math.max(1, lines); r--) {
        const less = (slots(n, r).cols - slots(n, rows).cols) * 32;
        if (!measure(editor, less).fits) break;
        next = r;
      }
    }
    if (next !== rows) place(next);
  }
  function expand(open) {
    const next = bar();
    if (!next) return;
    clearTimeout(hideTimer);
    if (exit) {
      exit.cancel();
      exit = null;
    }
    next.style.removeProperty("pointer-events");
    overlay
      ?.querySelector("#liuli-func-toggle")
      ?.setAttribute("aria-expanded", String(open));
    if (open) {
      next.classList.add("liuli-expanded");
      next.dataset.liuliTools = "open";
      tools = next;
    } else if (next.classList.contains("liuli-expanded")) {
      next.style.setProperty("pointer-events", "none");
      const finish = () => {
        next.classList.remove("liuli-expanded");
        delete next.dataset.liuliTools;
        next.style.removeProperty("pointer-events");
        if (tools === next) tools = null;
      };
      if (window.LiuliMotion.reduced || document.hidden) finish();
      else {
        const animation = next.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 130,
          easing: "ease-out",
          pseudoElement: "::before",
        });
        exit = animation;
        animation.finished.then(
          () => {
            if (exit === animation) {
              exit = null;
              finish();
            }
          },
          () => {},
        );
      }
    }
  }
  function variable(node, name, value) {
    if (node.style.getPropertyValue(name) !== value)
      node.style.setProperty(name, value);
  }
  // The floating header pulls the chat column under itself. That relies on the
  // column being sized by its parent; if a QQ build sizes it differently the
  // column would stop short of the bottom. Detect that and fall back to the
  // in-flow header instead of shipping a broken pane.
  function verifyHeader(header, column) {
    if (!pane || pane.dataset.liuliHeader === "flow") return;
    if (!header || !column || window.LiuliDock?.moving()) return;
    const parent = column.parentElement?.getBoundingClientRect(),
      own = column.getBoundingClientRect(),
      head = header.getBoundingClientRect();
    if (!parent || own.height < 40 || parent.height < 40 || head.height < 1)
      return;
    const ok = own.top <= head.top + 12 && own.bottom >= parent.bottom - 2;
    const fails = ok ? 0 : (headerFails.get(pane) || 0) + 1;
    headerFails.set(pane, fails);
    if (fails >= 2) pane.dataset.liuliHeader = "flow";
  }
  function refresh() {
    if (!D.mainLike()) {
      if (active || overlay) clean();
      return [];
    }
    const next = select();
    if (!next) {
      // Nothing rendered right now (route transition, cached pane swap, native
      // re-render). Keep every mark; only forget nodes that are really gone.
      if (active && !active.isConnected) {
        closeTools();
        overlay?.remove();
        overlay = null;
        active = pane = host = region = scroll = null;
      }
      return [active, host, region].filter((n) => n?.isConnected);
    }
    const nextPane =
      next.closest(".aio") ||
      next.closest(".chat-container,.two-col-layout__main") ||
      document.body;
    const nextRegion = findRegion(next, nextPane);
    if (next !== active) {
      closeTools();
      if (fx) delete fx.dataset.fx;
      active = next;
      scheduleReady();
    }
    pane = nextPane;
    if (active.dataset.liuliComposer !== "float")
      active.dataset.liuliComposer = "float";
    if (!overlay) overlay = makeOverlay();
    if (overlay.parentElement !== active) active.append(overlay);
    syncPins();
    if (!nextRegion) {
      host = region = scroll = null;
      return [active, active.querySelector(".msg-input")].filter(Boolean);
    }
    let nextHost = active.parentElement;
    while (nextHost && !nextHost.contains(nextRegion))
      nextHost = nextHost.parentElement;
    if (!nextHost || nextHost === document.body) {
      host = region = scroll = null;
      return [active, active.querySelector(".msg-input")].filter(Boolean);
    }
    host = nextHost;
    region = nextRegion;
    if (
      !scroll?.isConnected ||
      !region.contains(scroll) ||
      !scrollable(scroll) ||
      !scroll.querySelector(ROW)
    )
      scroll = findScroller(region);
    // No scroll container found: composer.css reserves the editor on the region.
    if (region.hasAttribute("data-liuli-noscroll") !== !scroll)
      region.toggleAttribute("data-liuli-noscroll", !scroll);
    // Sampled before any padding is written this pass.
    const fresh = !!scroll && !scroll.hasAttribute(MARKS.scroll);
    const distance = scroll ? fromEnd(scroll) : 0;
    const previous = parseFloat(
      nextPane.style.getPropertyValue("--ll-composer-clearance"),
    );
    if (fresh) {
      // A conversation just opened: its first positioning may still be under
      // way. Two late checks, then nothing — this is not a poll.
      settleUntil = performance.now() + 1600;
      touchedAt = 0;
      settleTimers.forEach(clearTimeout);
      settleTimers = [260, 800].map((ms) => setTimeout(requestRefresh, ms));
    }
    const header = pane.matches(".aio")
      ? pane.querySelector(":scope > .chat-header")
      : null;
    // The chat column is what slides under the floating header. When the pane
    // itself hosts the editor, only the message region can move.
    const column = header ? (host === pane ? region : host) : null;
    const bridges = [],
      shells = [];
    for (
      let node = active.parentElement;
      node && node !== host;
      node = node.parentElement
    )
      bridges.push(node);
    for (
      let node = column?.parentElement;
      node && node !== pane && pane.contains(node);
      node = node.parentElement
    ) {
      const css = getComputedStyle(node);
      // Only pure clippers. A real scroll container keeps its native overflow.
      if (
        /^(hidden|clip)$/.test(css.overflowY) &&
        /^(hidden|clip|visible)$/.test(css.overflowX)
      )
        shells.push(node);
    }
    const wanted = new Map([
      [MARKS.host, [host]],
      [MARKS.region, [region]],
      [MARKS.scroll, scroll ? [scroll] : []],
      [MARKS.bridge, bridges],
      [MARKS.column, column ? [column] : []],
      [MARKS.shell, shells],
    ]);
    for (const [name, nodes] of wanted) {
      for (const stale of pane.querySelectorAll("[" + name + "]"))
        if (!nodes.includes(stale)) stale.removeAttribute(name);
      if (pane.hasAttribute(name) && !nodes.includes(pane))
        pane.removeAttribute(name);
      nodes.forEach((node) => setMark(node, name));
    }
    setMark(pane, "data-liuli-chat-pane");
    const height = active.getBoundingClientRect().height;
    const clearance = height >= 1 ? Math.ceil(height) + 28 : previous || 76;
    if (height >= 1) variable(pane, "--ll-composer-clearance", clearance + "px");
    if (height >= 1) variable(active, "--ll-composer-h", Math.ceil(height) + "px");
    if (height >= 1) stackBar();
    if (scroll) {
      const added = fresh ? clearance : Math.max(0, clearance - (previous || clearance));
      const settling =
        performance.now() < settleUntil && touchedAt === 0 && distance > 3;
      if (
        // was at the end, and the padding has just appeared or grown
        (added > 0 && distance <= 3) ||
        // or the client's opening scroll landed exactly one clearance short
        // (both safe areas: the editor's at the end, the header's at the start)
        (settling &&
          distance <=
            clearance +
              (parseFloat(pane.style.getPropertyValue("--ll-header-clearance")) || 0) +
              8)
      )
        toEnd(scroll);
    }
    if (header) {
      const head = header.getBoundingClientRect().height;
      if (head >= 1)
        variable(
          pane,
          "--ll-header-clearance",
          Math.ceil(head) +
            (parseFloat(getComputedStyle(header).marginBottom) || 0) +
            "px",
        );
      verifyHeader(header, column);
    }
    return [active, active.querySelector(".msg-input"), host, region].filter(
      Boolean,
    );
  }
  // Attachment chips animate on their own native nodes. Nothing is drawn next
  // to the caret: typing, deleting and IME composition stay purely native.
  const attachment =
    "img,.image-element,.file-element,.file-card";
  function records(records) {
    if (!area()) return;
    let removed = false,
      attached = false;
    for (const record of records) {
      if (
        record.type !== "childList" ||
        !active.contains(record.target) ||
        record.target.closest?.(".liuli-owned-ui")
      )
        continue;
      if (!removed)
        for (const node of record.removedNodes)
          if (
            node instanceof Element &&
            (node.matches(attachment) || node.querySelector(attachment))
          ) {
            removed = true;
            break;
          }
      for (const added of record.addedNodes) {
        if (!(added instanceof Element) || added.closest(".liuli-owned-ui"))
          continue;
        for (const item of D.within(
          added,
          ".msg-input img,.msg-input .file-element,.msg-input .file-card,.msg-input .image-element",
        )) {
          if (seenAttachments.has(item)) continue;
          seenAttachments.add(item);
          attached = true;
          // Web Animations write no attribute or style, so the editor's own
          // mutation observer never sees the chip being animated.
          window.LiuliMotion.play(item, [{ opacity: 0 }, { opacity: 1 }], {
            duration: 200,
            easing: "ease-out",
          });
        }
      }
    }
    if (attached) glow("attach", 620);
    else if (removed) glow("delete");
    if (attached || removed) scheduleReady();
  }
  let requestRefresh = () => {};
  function install(invalidate) {
    if (installed) return;
    installed = true;
    requestRefresh = invalidate;
    // Any deliberate scroll input ends the opening settle for this view.
    for (const type of ["wheel", "touchmove", "pointerdown", "keydown"])
      document.addEventListener(
        type,
        (e) => {
          if (
            performance.now() < settleUntil &&
            region?.contains(e.target) &&
            (type !== "keydown" || /^(Page|Arrow|Home|End)/.test(e.key))
          )
            touchedAt = performance.now();
        },
        { capture: true, passive: true },
      );
    for (const type of ["focusin", "input", "compositionend", "paste", "drop"])
      document.addEventListener(
        type,
        (e) => {
          if (!e.target.closest?.(".chat-input-area")) return;
          if (type === "input")
            glow((e.inputType || "").startsWith("delete") ? "delete" : "type");
          else if (type === "compositionend" && e.data) glow("type");
          if (type !== "focusin") scheduleReady();
          invalidate();
        },
        true,
      );
    // Files dragged over the editor: a steady ring until they leave or land.
    document.addEventListener(
      "dragover",
      (e) => {
        if (
          e.target.closest?.(".chat-input-area") &&
          [...(e.dataTransfer?.types || [])].includes("Files")
        )
          glow("drop", 220);
      },
      { capture: true, passive: true },
    );
    document.addEventListener(
      "pointerover",
      (e) => {
        if (
          e.target.closest?.("#liuli-func-toggle,.chat-func-bar.liuli-expanded")
        ) {
          clearTimeout(hideTimer);
          if (e.target.closest("#liuli-func-toggle")) expand(true);
        }
      },
      true,
    );
    document.addEventListener(
      "pointerout",
      (e) => {
        if (
          !e.target.closest?.(
            "#liuli-func-toggle,.chat-func-bar.liuli-expanded",
          )
        )
          return;
        if (
          e.relatedTarget?.closest?.(
            "#liuli-func-toggle,.chat-func-bar.liuli-expanded,.q-menu,.q-float-card",
          )
        )
          return;
        hideTimer = setTimeout(() => expand(false), 200);
      },
      true,
    );
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (
          tools &&
          !tools.contains(e.target) &&
          !overlay?.contains(e.target) &&
          !e.target.closest?.(".q-menu,.q-float-card")
        )
          expand(false);
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") expand(false);
      },
      true,
    );
  }
  window.LiuliComposer = Object.freeze({
    install,
    refresh,
    area,
    bar,
    viewport: () => (scroll?.isConnected ? scroll : region),
    scroller: () => (scroll?.isConnected ? scroll : null),
    needsScroller,
    prime,
    records,
    expand,
    state: () => ({
      active: !!active?.isConnected,
      host: !!host?.isConnected,
      region: !!region?.isConnected,
      scroller: scroll
        ? scroll === region
          ? "region"
          : String(scroll.className).slice(0, 80)
        : "",
      header: pane?.dataset?.liuliHeader || "float",
    }),
  });
})();
