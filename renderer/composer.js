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
  function findScroller(target) {
    const seed =
      target.querySelector(".ml-item,.message-container,.message") ||
      target.querySelector(".ml-list,.ml-root,.ml-area,.chat-msg-area__vlist");
    for (
      let node = seed?.parentElement;
      node && target.contains(node);
      node = node.parentElement
    )
      if (scrollable(node)) return node;
    for (const node of target.querySelectorAll(
      ".chat-msg-area__vlist,.ml-area,.q-scroll-view,.ml-list",
    ))
      if (scrollable(node)) return node;
    return scrollable(target) ? target : null;
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
    // Stickers get their own button: the emoji button opens QQ's emoji tab.
    const sticker = document.createElement("button");
    sticker.id = "liuli-sticker-btn";
    sticker.type = "button";
    sticker.title = "表情包";
    sticker.setAttribute("aria-label", "表情包");
    sticker.innerHTML = window.LiuliIcons.svg("表情包");
    sticker.addEventListener("click", () =>
      window.LiuliChatExtras?.openStickers(window.LiuliLayout.nativeBarItem("表情")),
    );
    const pins = document.createElement("div");
    pins.id = "liuli-bar-pins";
    result.append(more, sticker, pins);
    return result;
  }
  function syncPins() {
    if (!active || !overlay) return;
    const labels = window.LiuliLayout.applyBar(),
      pins = overlay.querySelector("#liuli-bar-pins");
    const key = labels.join("|");
    if (pins.dataset.key !== key) {
      pins.dataset.key = key;
      pins.replaceChildren();
      labels.forEach((label) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "liuli-bar-btn";
        button.title = label;
        button.setAttribute("aria-label", label);
        if (label === "表情") button.id = "liuli-emoji-btn";
        button.innerHTML = window.LiuliIcons.svg(label);
        button.addEventListener("click", () =>
          window.LiuliLayout.nativeBarItem(label)?.click(),
        );
        pins.append(button);
      });
    }
    const pad = 12 + (labels.length + 2) * 32 + "px";
    if (active.style.getPropertyValue("--liuli-bar-pad") !== pad)
      active.style.setProperty("--liuli-bar-pad", pad);
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
    if (!scroll?.isConnected || !region.contains(scroll) || !scrollable(scroll))
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
