/* One owner for navigation/profile/window-control state. No CSS hover reveal,
 * no perpetual animation loop, and no fixed sidebar over the conversation list. */
(() => {
  "use strict";
  const D = window.LiuliDOM;
  // Author main @ 3d183f3, installRevealTracker: the full left edge is 8px,
  // target padding is 18px, and leave holds are 250/600ms. No new gesture policy.
  const EDGE = 8,
    PAD = 18,
    CORNER = 200;
  const HOLD = { nav: 250, l: 600, r: 600 };
  const states = { nav: false, l: false, r: false },
    timers = {};
  const keys = { nav: "liuliRNav", l: "liuliRL", r: "liuliRR" };
  let moveFrame = 0,
    pointer = null,
    settleTimer = 0,
    moving = false;
  let installed = false,
    owner = null,
    childFocused = false,
    last = { x: -1, y: -1 };
  let bounds = { left: 260, right: innerWidth - 160 },
    nav = null,
    controls = null,
    profile = null;
  const popupSelector =
    "dialog[open],.q-dialog,.q-popup__main,.q-float-card,.q-menu,.q-context-menu,.sidebar-tooltips__content";
  function variable(name, value) {
    if (document.body.style.getPropertyValue(name) !== value)
      document.body.style.setProperty(name, value);
  }
  function clearTimer(map, key) {
    if (map[key]) clearTimeout(map[key]);
    delete map[key];
  }
  function rectContains(el, x, y, pad = PAD) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      x >= r.left - pad &&
      x <= r.right + pad &&
      y >= r.top - pad &&
      y <= r.bottom + pad
    );
  }
  function nodeFor(key) {
    return key === "nav" ? nav : key === "l" ? profile : controls;
  }
  function pinned() {
    return document.body.hasAttribute("data-liuli-nav-pin");
  }
  function popupOpen() {
    return [...document.querySelectorAll(popupSelector)].some(D.visible);
  }
  function locked(key) {
    return owner === key && (childFocused || popupOpen());
  }
  function commit(key, open) {
    if (key === "nav" && pinned()) open = true;
    if (states[key] !== open) {
      clearTimer(timers, key);
      if (!window.LiuliMotion.reduced) {
        moving = true;
        if (key === "nav") document.body.dataset.liuliNavMoving = "";
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          moving = false;
          delete document.body.dataset.liuliNavMoving;
          window.dispatchEvent(new Event("liuli-dock-settled"));
        }, 220);
      }
    }
    states[key] = open;
    if (open) {
      if (document.body.dataset[keys[key]] !== "1")
        document.body.dataset[keys[key]] = "1";
    } else if (document.body.dataset[keys[key]] !== undefined)
      delete document.body.dataset[keys[key]];
    if (key === "nav") {
      variable("--ll-nav-slot", open ? "64px" : "0px");
      if (nav) {
        if (nav.inert !== !open) nav.inert = !open;
        if (nav.getAttribute("aria-hidden") !== String(!open))
          nav.setAttribute("aria-hidden", String(!open));
      }
    }
  }
  function close(key, delay = HOLD[key]) {
    if (
      !states[key] ||
      locked(key) ||
      (key === "nav" && pinned()) ||
      timers[key]
    )
      return;
    timers[key] = setTimeout(() => {
      delete timers[key];
      if (locked(key)) return;
      const el = nodeFor(key);
      if (
        el?.contains(document.activeElement) &&
        document.activeElement?.matches(":focus-visible")
      )
        return;
      commit(key, false);
    }, delay);
  }
  function zone(key, x, y) {
    if (key === "nav") return x >= 0 && x <= EDGE && y >= 0 && y < innerHeight;
    return (
      y >= 0 &&
      y <= 36 &&
      (key === "l"
        ? x > EDGE && x <= bounds.left
        : x >= bounds.right && x <= innerWidth)
    );
  }
  function move(e) {
    if (document.body.dataset.liuliScope !== "main") return;
    last = { x: e.clientX, y: e.clientY };
    const inPopup =
      e.target instanceof Element && e.target.closest(popupSelector);
    const targets = {
      nav:
        zone("nav", last.x, last.y) ||
        (states.nav && rectContains(nav, last.x, last.y)),
      l:
        zone("l", last.x, last.y) ||
        (states.l && rectContains(profile, last.x, last.y)),
      r:
        zone("r", last.x, last.y) ||
        (states.r && rectContains(controls, last.x, last.y)),
    };
    for (const key of ["nav", "l", "r"]) {
      if (key !== "nav" && document.body.dataset.liuliTb === "native") {
        commit(key, false);
        continue;
      }
      if (targets[key]) {
        clearTimer(timers, key);
        if (states[key]) continue;
        owner = key;
        commit(key, true);
      } else {
        if (!(inPopup && owner === key)) close(key);
      }
    }
  }
  function refresh() {
    if (document.body.dataset.liuliScope !== "main") return;
    nav = document.querySelector(".container-content > .container-sidebar");
    profile = document.querySelector(".topbar-profile");
    controls = document.querySelector(
      ".window-title-bar .window-control-area:not(.window-title-bar__controls-left)",
    );
    const aside = D.visibleQuery(".two-col-layout__aside"),
      right = D.visibleQuery(".group-box");
    const asideWidth = aside?.getBoundingClientRect().width || 280;
    bounds.left = Math.min(asideWidth, CORNER + 56);
    bounds.right = innerWidth - CORNER;
    variable("--ll-aside-width", Math.round(asideWidth) + "px");
    const cap = Math.max(
      160,
      innerWidth - 64 - (right?.getBoundingClientRect().width || 0) - 300 - 32,
    );
    variable("--ll-aside-cap", cap + "px");
    commit("nav", pinned() || states.nav);
    for (const key of ["nav", "l", "r"])
      if (
        states[key] &&
        !locked(key) &&
        !rectContains(nodeFor(key), last.x, last.y) &&
        !zone(key, last.x, last.y)
      )
        close(key);
    if (controls) {
      let shield = document.getElementById("liuli-ctl-shield");
      if (!shield) {
        shield = document.createElement("div");
        shield.id = "liuli-ctl-shield";
        shield.setAttribute("aria-hidden", "true");
        document.body.append(shield);
      }
      const r = controls.getBoundingClientRect();
      for (const [name, value] of Object.entries({
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      })) {
        const px = Math.round(value) + "px";
        if (shield.style[name] !== px) shield.style[name] = px;
      }
    }
  }
  function install() {
    if (installed) return;
    installed = true;
    const handle = document.createElement("div");
    handle.id = "liuli-nav-handle";
    handle.title = "展开导航";
    handle.setAttribute("aria-hidden", "true");
    document.body.append(handle);
    for (const key of ["l", "r"]) {
      const hint = document.createElement("div");
      hint.id = "liuli-top-hint-" + key;
      hint.className = "liuli-top-hint";
      hint.setAttribute("aria-hidden", "true");
      document.body.append(hint);
    }
    document.addEventListener(
      "mousemove",
      (e) => {
        last = { x: e.clientX, y: e.clientY };
        pointer = { clientX: e.clientX, clientY: e.clientY, target: e.target };
        if (!moveFrame)
          moveFrame = requestAnimationFrame(() => {
            moveFrame = 0;
            move(pointer);
          });
      },
      { capture: true, passive: true },
    );
    document.addEventListener(
      "pointerdown",
      (e) => {
        const key = ["nav", "l", "r"].find((k) =>
          nodeFor(k)?.contains(e.target),
        );
        if (key) owner = key;
        else if (!e.target.closest?.(popupSelector)) {
          owner = null;
          for (const k of ["nav", "l", "r"]) close(k, 120);
        }
      },
      true,
    );
    document.addEventListener(
      "focusin",
      (e) => {
        for (const key of ["nav", "l", "r"])
          if (nodeFor(key)?.contains(e.target)) {
            owner = key;
            commit(key, true);
          }
      },
      true,
    );
    document.documentElement.addEventListener("mouseleave", () => {
      for (const k of ["nav", "l", "r"]) {
        close(k);
      }
    });
    window.addEventListener("blur", () => {
      childFocused = true;
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      for (const key of ["nav", "l", "r"]) {
        clearTimer(timers, key);
      }
    });
    window.addEventListener("focus", () => {
      childFocused = false;
      refresh();
    });
    document.addEventListener("close", refresh, true);
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && !popupOpen()) {
          owner = null;
          for (const key of ["nav", "l", "r"]) commit(key, false);
        }
      },
      true,
    );
    refresh();
  }
  window.LiuliDock = Object.freeze({
    install,
    refresh,
    state: () => ({ ...states }),
    moving: () => moving,
    debug: () => ({
      owner,
      childFocused,
      popup: popupOpen(),
      focus: document.activeElement?.tagName,
      focusVisible: document.activeElement?.matches(":focus-visible"),
      last,
    }),
  });
})();
