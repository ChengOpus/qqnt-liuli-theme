/* One owner for navigation/profile/window-control state. No CSS hover reveal,
 * no perpetual animation loop, and no fixed sidebar over the conversation list. */
(() => {
  "use strict";
  const D = window.LiuliDOM;
  const states = { nav: false, l: false, r: false },
    timers = {},
    intents = {};
  const keys = { nav: "liuliRNav", l: "liuliRL", r: "liuliRR" };
  let moveFrame = 0,
    pointer = null,
    settleTimer = 0,
    moving = false;
  let installed = false,
    owner = null,
    childFocused = false,
    last = { x: -1, y: -1 },
    sample = { x: -1, y: -1, time: 0 };
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
  function rectContains(el, x, y, pad = 10) {
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
  function close(key, delay = key === "nav" ? 180 : 360) {
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
  function intent(key, delay) {
    if (intents[key]) return;
    intents[key] = setTimeout(() => {
      delete intents[key];
      if (
        key === "nav" ? last.x <= 8 && last.y > 42 : zone(key, last.x, last.y)
      ) {
        owner = key;
        commit(key, true);
      }
    }, delay);
  }
  function zone(key, x, y) {
    if (key === "nav") return x >= 0 && x <= 8 && y > 42 && y < innerHeight;
    return (
      y >= 0 &&
      y <= 42 &&
      (key === "l"
        ? x >= 0 && x <= bounds.left
        : x >= bounds.right && x <= innerWidth)
    );
  }
  function move(e) {
    if (document.body.dataset.liuliScope !== "main") return;
    last = { x: e.clientX, y: e.clientY };
    const now = performance.now();
    const dx = sample.x < 0 ? 0 : last.x - sample.x,
      dy = sample.y < 0 ? 0 : last.y - sample.y;
    sample = { ...last, time: now };
    const inPopup =
      e.target instanceof Element && e.target.closest(popupSelector);
    const targets = {
      nav:
        (last.x <= 8 && last.y > 42) ||
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
        if (key === "nav") intent(key, 45);
        else if (key === "r" && last.x >= innerWidth - 76) intent(key, 20);
        else if (dy < -1 && Math.abs(dx) < Math.abs(dy) * 2 + 10)
          intent(key, 60);
        else if (last.y <= 10) intent(key, 100);
      } else {
        clearTimer(intents, key);
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
    bounds.left = Math.min(asideWidth, innerWidth * 0.48);
    bounds.right =
      innerWidth -
      Math.max(150, controls?.getBoundingClientRect().width || 140);
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
    const handle = document.createElement("button");
    handle.id = "liuli-nav-handle";
    handle.type = "button";
    handle.title = "展开导航";
    handle.setAttribute("aria-label", "展开导航");
    handle.textContent = "›";
    handle.addEventListener("click", () => {
      owner = "nav";
      commit("nav", !states.nav);
    });
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
        clearTimer(intents, k);
        close(k);
      }
    });
    window.addEventListener("blur", () => {
      childFocused = true;
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      for (const key of ["nav", "l", "r"]) {
        clearTimer(timers, key);
        clearTimer(intents, key);
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
