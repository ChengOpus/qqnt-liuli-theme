/* Assign a single painted owner to native surfaces. No composer or dock state
 * lives here; inline ownership defeats native important backgrounds in one place. */
(() => {
  "use strict";
  const D = window.LiuliDOM;
  const profiles =
    ".mini-buddy,.group-member-card,.group-profile,.group-profile-card,.group-info,.group-info-panel,.group-detail-panel,.group-profile-info,.mini-group,.buddy-profile,.profile-card,.group-profile-panel,.group-card";
  const popups =
    ".q-menu,.q-popup__main,.q-dialog-main,.form-modal,.q-float-card,.q-popover__content,.pulldown-menu,.q-pulldown-menu-wrapper,.bar-more-menu-inner,.editor-at-panel,.editor-qqface-short-panel,.sticker-panel,.expression-panel-inner,.bot-panel-wrapper,.q-tooltips__content,.q-tooltips-v2,.sidebar-tooltips__content,.q-notification,.q-color-picker,.finger-memo-dialog,.menu-stickers-panel,.menu-stickers-wrapper .menu-stickers,.handoff-menu,.aio .panel-container";
  const fields = [
    "background",
    "backdrop-filter",
    "-webkit-backdrop-filter",
    "box-shadow",
    "border",
  ];
  const changes = new WeakMap();
  function write(node, name, value) {
    let entries = changes.get(node);
    if (!entries) changes.set(node, (entries = new Map()));
    if (!entries.has(name))
      entries.set(name, {
        value: node.style.getPropertyValue(name),
        priority: node.style.getPropertyPriority(name),
        written: "",
      });
    if (
      node.style.getPropertyValue(name) !== value ||
      node.style.getPropertyPriority(name) !== "important"
    )
      node.style.setProperty(name, value, "important");
    entries.get(name).written = node.style.getPropertyValue(name);
  }
  function release(node) {
    const entries = changes.get(node);
    if (entries) {
      for (const [name, saved] of entries) {
        if (
          node.style.getPropertyValue(name) !== saved.written ||
          node.style.getPropertyPriority(name) !== "important"
        )
          continue;
        if (saved.value)
          node.style.setProperty(name, saved.value, saved.priority);
        else node.style.removeProperty(name);
      }
      changes.delete(node);
    }
    for (const key of [
      "liuliSurface",
      "liuliSurfaceInner",
      "liuliSurfaceStatic",
    ])
      delete node.dataset[key];
  }
  function clear(node) {
    if (!node.hasAttribute("data-liuli-surface-inner"))
      node.dataset.liuliSurfaceInner = "";
    for (const key of fields)
      write(node, key, key === "background" ? "transparent" : "none");
    delete node.dataset.liuliSurfaceStatic;
  }
  function mark(node, kind) {
    if (!D.safe(node)) return;
    // Read native positioning before any paint writes, and do not repeatedly
    // rewrite our own marker when an existing surface receives an update.
    const needsPosition =
      !node.hasAttribute("data-liuli-surface-static") &&
      !node.querySelector(".search-result,.bar-more-menu-inner") &&
      getComputedStyle(node).position === "static";
    if (node.dataset.liuliSurface !== kind) node.dataset.liuliSurface = kind;
    delete node.dataset.liuliSurfaceInner;
    // Paint on a pseudo-element. A filter on the native root changes the
    // containing block of fixed search/profile/submenu children.
    for (const key of fields)
      write(node, key, key === "background" ? "transparent" : "none");
    if (needsPosition) node.dataset.liuliSurfaceStatic = "";
  }
  function owner(node) {
    let result = node;
    // A fixed card uses the viewport even when nested in a zero-sized portal.
    // Painting that portal produces an invisible surface and a shifted child.
    if (getComputedStyle(node).position === "fixed") return node;
    for (
      let p = node.parentElement;
      p && p !== document.body;
      p = p.parentElement
    )
      if (
        p.matches(".q-popup__main,.q-float-card,.q-popover__content") &&
        p.getBoundingClientRect().width > 1 &&
        p.getBoundingClientRect().height > 1
      )
        result = p;
    return result;
  }
  function profile(node) {
    const existing = node.parentElement.closest(
      '[data-liuli-surface="profile"]',
    );
    if (existing) {
      return profile(existing);
    }
    const outer = owner(node);
    if (!D.safe(outer)) return;
    mark(outer, "profile");
    if (outer !== node) clear(node);
    const structural = [];
    // Read image exclusions as a batch. Interleaving each computed-style read
    // with background writes used to recalculate the card for every row.
    for (const inner of outer.querySelectorAll("div,section,header,main")) {
      if (
        inner.matches(
          '[role="button"],.q-button,.icon-item,.q-icon,.q-svg-icon,.q-tag,[class*="avatar"]',
        ) ||
        inner.closest('button,[role="button"],.q-button')
      )
        continue;
      if (
        !inner.hasAttribute("data-liuli-surface-inner") &&
        /url\(/.test(getComputedStyle(inner).backgroundImage)
      )
        continue;
      if (
        inner.hasAttribute("data-liuli-surface") &&
        !inner.matches(".q-float-card,.q-popup__main")
      )
        continue;
      structural.push(inner);
    }
    structural.forEach(clear);
    for (const button of outer.querySelectorAll(
      'button,[role="button"],.q-button',
    )) {
      if (/^(发消息|发送消息)$/.test(button.textContent.trim())) {
        write(button, "background", "var(--ll-brand)");
        write(button, "color", "var(--ll-on-brand)");
      }
    }
  }
  function apply(root = document.body) {
    if (document.body.hasAttribute("data-liuli-av")) return;
    // A native popup shell can be reused for protected content. Undo only our
    // own writes, preserving subsequent native inline updates.
    const previous = root.closest?.("[data-liuli-surface]");
    for (const node of new Set([
      ...D.within(root, "[data-liuli-surface]"),
      ...(previous ? [previous] : []),
    ])) {
      if (!D.safe(node)) {
        for (const owned of [node, ...node.querySelectorAll("*")])
          if (changes.has(owned)) release(owned);
      }
    }
    for (const node of D.within(
      root,
      ".container-sidebar,.group-box,.right-sidebar:not(:has(.group-box)),.aio .side-panel,.contact-profile .profile__body",
    ))
      mark(node, "panel");
    for (const node of D.within(root, popups)) {
      if (node.matches(".bar-more-menu")) continue;
      mark(node, "popup");
    }
    for (const node of D.within(
      root,
      ".q-context-menu:not(.is-pure),.q-context-menu.is-pure:has(> .q-context-menu-item),.q-context-sub-menu__container",
    ))
      mark(node, "context");
    const profileNodes = new Set(D.within(root, profiles));
    const profileParent = root.closest?.(profiles);
    if (profileParent) profileNodes.add(profileParent);
    const paintedProfile = root.closest?.('[data-liuli-surface="profile"]');
    if (paintedProfile) profileNodes.add(paintedProfile);
    for (const node of D.roots([...profileNodes]))
      if (!node.closest(".message")) profile(node);
    const inlineSearch = document.body.dataset.liuliScope === "main";
    // Native surfaces can be created hidden/at zero size, then shown through an
    // ancestor v-show/transition. Ownership never depends on insertion geometry.
    const searchNodes = new Set(
      inlineSearch
        ? D.within(
            root,
            ".main-search .search-result,.search-result:has(.search-result-item)",
          )
        : [],
    );
    const searchParent =
      inlineSearch && root.closest?.(".main-search .search-result");
    if (searchParent) searchNodes.add(searchParent);
    for (const node of searchNodes) {
      const outer = owner(node);
      if (outer !== node) clear(outer);
      mark(node, "search");
      for (const inner of node.querySelectorAll(
        ".q-float-card,.q-popup__main,.search-result__content,.search-recent,.search-recent-contact,.search-result-list",
      ))
        clear(inner);
      for (const inner of node.querySelectorAll(
        ":scope > div,:scope > div > div",
      )) {
        if (
          inner.querySelector(
            ".search-result-item,.search-contact-item,.recent-contact-item,.q-scroll-view",
          )
        )
          clear(inner);
      }
    }
    const route = location.hash.split("?")[0];
    if (
      document.body.dataset.liuliScope === "aux" &&
      /^#\/(?:mini-group|mini-profile|group[-_]?profile|group[-_]?info|group[-_]?detail|buddy[-_]?profile|user[-_]?profile)(?:\/|$)/i.test(
        route,
      )
    ) {
      const page = document.querySelector("#app > :not(.app-border)");
      if (page && !page.querySelector(".chat-msg-area")) profile(page);
    }
  }
  window.LiuliSurfaces = Object.freeze({ apply });
})();
