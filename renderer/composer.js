/* Owns active-editor selection, floating layout, local proxy controls and input
 * feedback. Native editor nodes stay in place, including composition/selection. */
(() => {
  "use strict";
  const D = window.LiuliDOM;
  let active = null,
    host = null,
    scroll = null,
    bridges = [],
    overlay = null,
    installed = false,
    tools = null,
    exit = null,
    hideTimer = 0,
    lastFeedback = 0;
  const seenAttachments = new WeakSet();
  function area() {
    return active?.isConnected && D.visible(active) ? active : null;
  }
  function bar() {
    return area()?.querySelector(".chat-func-bar") || null;
  }
  function clean() {
    clearTimeout(hideTimer);
    exit?.cancel();
    exit = null;
    if (tools) {
      tools.classList.remove("liuli-expanded");
      delete tools.dataset.liuliTools;
      tools.style.removeProperty("pointer-events");
      tools = null;
    }
    active?.removeAttribute("data-liuli-composer");
    host?.removeAttribute("data-liuli-composer-host");
    scroll?.removeAttribute("data-liuli-composer-scroll");
    bridges.forEach((n) => n.removeAttribute("data-liuli-composer-bridge"));
    bridges = [];
    overlay?.remove();
    overlay = null;
    active = host = scroll = null;
  }
  function select() {
    if (!D.mainLike()) return null;
    const focused = document.activeElement?.closest(".chat-input-area");
    if (focused && D.visible(focused)) return focused;
    return (
      [...document.querySelectorAll(".chat-input-area")]
        .filter((n) => D.visible(n) && n.querySelector(".msg-input"))
        .sort((a, b) => {
          const score = (n) =>
            n.closest(".two-col-layout__main")
              ? 2
              : n.closest(".chat-container")
                ? 1
                : 0;
          return score(b) - score(a);
        })[0] || null
    );
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
    const pins = document.createElement("div");
    pins.id = "liuli-bar-pins";
    result.append(more, pins);
    active.append(result);
    return result;
  }
  function syncPins() {
    if (!active || !overlay) return;
    const labels = window.LiuliLayout.applyBar(),
      pins = overlay.querySelector("#liuli-bar-pins");
    const key = labels.join("|");
    if (pins.dataset.key === key) return;
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
      button.addEventListener("click", () => {
        window.LiuliLayout.nativeBarItem(label)?.click();
        feedback("insert");
      });
      pins.append(button);
    });
    active.style.setProperty(
      "--liuli-bar-pad",
      12 + (labels.length + 1) * 32 + "px",
    );
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
  function refresh() {
    const next = select();
    if (!next) {
      clean();
      return [];
    }
    const pane =
      next.closest(".aio,.chat-container,.two-col-layout__main") ||
      document.body;
    const view =
      D.visibleQuery(".chat-msg-area__vlist", pane) ||
      D.visibleQuery(".chat-msg-area", pane);
    if (!view) return [];
    let nextHost = next.parentElement;
    while (nextHost && !nextHost.contains(view))
      nextHost = nextHost.parentElement;
    if (!nextHost || nextHost === document.body) return [];
    if (next !== active || nextHost !== host) {
      clean();
      active = next;
      host = nextHost;
    }
    // Repair attributes even if QQ has reused/reparented the same editor node.
    if (active.dataset.liuliComposer !== "float")
      active.dataset.liuliComposer = "float";
    if (!host.hasAttribute("data-liuli-composer-host"))
      host.dataset.liuliComposerHost = "";
    const nextBridges = [];
    for (
      let node = active.parentElement;
      node && node !== host;
      node = node.parentElement
    ) {
      if (node === view || node.contains(view)) break;
      if (!node.hasAttribute("data-liuli-composer-bridge"))
        node.dataset.liuliComposerBridge = "";
      nextBridges.push(node);
    }
    for (const old of bridges)
      if (!nextBridges.includes(old))
        old.removeAttribute("data-liuli-composer-bridge");
    bridges = nextBridges;
    if (scroll !== view) {
      scroll?.removeAttribute("data-liuli-composer-scroll");
      scroll = view;
    }
    if (!scroll.hasAttribute("data-liuli-composer-scroll"))
      scroll.dataset.liuliComposerScroll = "";
    if (!overlay || overlay.parentElement !== active) overlay = makeOverlay();
    syncPins();
    const clearance = Math.ceil(active.getBoundingClientRect().height) + 28;
    if (
      host.style.getPropertyValue("--ll-composer-clearance") !==
      clearance + "px"
    )
      host.style.setProperty("--ll-composer-clearance", clearance + "px");
    return [active, active.querySelector(".msg-input"), host, view].filter(
      Boolean,
    );
  }
  function feedback(kind) {
    if (!area() || window.LiuliMotion.reduced || document.hidden) return;
    let marker = active.querySelector(".liuli-edit-feedback");
    if (performance.now() - lastFeedback < 60 && marker?.dataset.edit === kind)
      return;
    lastFeedback = performance.now();
    if (!marker) {
      marker = document.createElement("span");
      marker.className = "liuli-edit-feedback liuli-owned-ui";
      marker.setAttribute("aria-hidden", "true");
      active.append(marker);
    }
    const selection = getSelection(),
      range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const caret =
      range && active.contains(range.commonAncestorContainer)
        ? range.getBoundingClientRect()
        : null;
    const r = active.getBoundingClientRect();
    marker.style.left =
      Math.round(caret?.width || caret?.height ? caret.left - r.left : 46) +
      "px";
    marker.style.top =
      Math.max(6, Math.round(caret?.height ? caret.top - r.top : 14)) + "px";
    marker.dataset.edit = kind;
    window.LiuliMotion.play(marker, [{ opacity: 0.55 }, { opacity: 0 }], {
      duration: kind === "delete" ? 150 : 190,
      easing: "ease-out",
    });
  }
  function records(records) {
    if (!area()) return;
    let removed = false;
    for (const record of records) {
      if (
        record.type !== "childList" ||
        !active.contains(record.target) ||
        record.target.closest?.(".liuli-owned-ui")
      )
        continue;
      removed ||= [...record.removedNodes].some(
        (n) =>
          n instanceof Element &&
          n.matches("img,.image-element,.file-element,.file-card"),
      );
      for (const added of record.addedNodes) {
        if (!(added instanceof Element) || added.closest(".liuli-owned-ui"))
          continue;
        for (const item of D.within(
          added,
          ".msg-input img,.msg-input .file-element,.msg-input .file-card,.msg-input .image-element",
        )) {
          if (seenAttachments.has(item)) continue;
          seenAttachments.add(item);
          window.LiuliMotion.play(
            item,
            [
              { opacity: 0.5, translate: "0 4px" },
              { opacity: 1, translate: "0 0" },
            ],
            { duration: 180, easing: "ease-out" },
          );
        }
      }
    }
    if (removed) feedback("delete");
  }
  function install(invalidate) {
    if (installed) return;
    installed = true;
    document.addEventListener(
      "focusin",
      (e) => {
        if (e.target.closest?.(".chat-input-area")) invalidate();
      },
      true,
    );
    document.addEventListener(
      "input",
      (e) => {
        if (e.target.closest?.(".chat-input-area")) {
          if (!e.isComposing)
            feedback(
              (e.inputType || "").startsWith("delete") ? "delete" : "insert",
            );
          invalidate();
        }
      },
      true,
    );
    document.addEventListener(
      "compositionend",
      (e) => {
        if (e.target.closest?.(".chat-input-area")) {
          if (e.data) feedback("insert");
          invalidate();
        }
      },
      true,
    );
    document.addEventListener(
      "paste",
      (e) => {
        if (e.target.closest?.(".chat-input-area")) {
          feedback("insert");
          invalidate();
        }
      },
      true,
    );
    document.addEventListener(
      "drop",
      (e) => {
        if (e.target.closest?.(".chat-input-area")) {
          feedback("insert");
          invalidate();
        }
      },
      true,
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
    viewport: () => scroll,
    records,
    expand,
  });
})();
