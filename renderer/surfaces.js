/* Assign a single painted owner to native surfaces. No composer or dock state
 * lives here; inline ownership defeats native important backgrounds in one place. */
(() => {
  "use strict";
  const D = window.LiuliDOM;
  const profiles =
    ".group-profile,.group-profile-card,.group-info,.group-info-panel,.group-detail-panel,.group-profile-info,.mini-group,.buddy-profile,.profile-card,.group-profile-panel,.group-card";
  const popups =
    ".q-menu,.q-popup__main,.q-dialog-main,.form-modal,.q-float-card,.q-popover__content,.pulldown-menu,.q-pulldown-menu-wrapper,.bar-more-menu-inner,.editor-at-panel,.editor-qqface-short-panel,.sticker-panel,.bot-panel-wrapper,.q-tooltips__content,.sidebar-tooltips__content";
  const fields = [
    "background",
    "backdrop-filter",
    "-webkit-backdrop-filter",
    "box-shadow",
    "border",
  ];
  function write(node, name, value) {
    if (
      node.style.getPropertyValue(name) !== value ||
      node.style.getPropertyPriority(name) !== "important"
    )
      node.style.setProperty(name, value, "important");
  }
  function clear(node) {
    if (!node.hasAttribute("data-liuli-surface-inner"))
      node.dataset.liuliSurfaceInner = "";
    for (const key of fields)
      write(node, key, key === "background" ? "transparent" : "none");
  }
  function mark(node, kind) {
    if (!D.safe(node)) return;
    if (node.dataset.liuliSurface !== kind) node.dataset.liuliSurface = kind;
    write(
      node,
      "background",
      kind === "context"
        ? "transparent"
        : kind === "search"
          ? "var(--ll-search-paint)"
          : "var(--ll-glass-paint)",
    );
    write(
      node,
      "backdrop-filter",
      kind === "context" ? "none" : "var(--ll-material-blur)",
    );
    write(
      node,
      "-webkit-backdrop-filter",
      kind === "context" ? "none" : "var(--ll-material-blur)",
    );
    write(node, "border", "none");
  }
  function owner(node) {
    let result = node;
    for (
      let p = node.parentElement;
      p && p !== document.body;
      p = p.parentElement
    )
      if (
        p.matches(".q-popup__main,.q-float-card,.q-popover__content") &&
        D.visible(p)
      )
        result = p;
    return result;
  }
  function profile(node) {
    const outer = owner(node);
    if (!D.safe(outer)) return;
    mark(outer, "profile");
    if (outer !== node) clear(node);
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
      clear(inner);
    }
    for (const button of outer.querySelectorAll(
      'button,[role="button"],.q-button',
    )) {
      if (/^(发消息|发送消息)$/.test(button.textContent.trim())) {
        write(button, "background", "var(--ll-brand)");
        write(button, "color", "var(--ll-on-brand)");
      }
    }
  }
  function semanticProfiles(root) {
    // Match UI actions only, never messages or arbitrary chat text.
    for (const button of D.within(root, 'button,[role="button"],.q-button')) {
      if (button.closest(".message,.chat-input-area")) continue;
      if (!/^(发消息|发送消息)$/.test(button.textContent.trim())) continue;
      for (
        let card = button.parentElement;
        card && card !== document.body;
        card = card.parentElement
      ) {
        if (card.matches(".aio,.recent-contact,#app")) break;
        const rect = card.getBoundingClientRect(),
          css = getComputedStyle(card);
        if (
          rect.width >= 240 &&
          rect.width <= 700 &&
          rect.height >= 180 &&
          (/absolute|fixed/.test(css.position) ||
            document.body.dataset.liuliScope === "aux")
        ) {
          profile(card);
          break;
        }
      }
    }
  }
  function apply(root = document.body) {
    if (document.body.hasAttribute("data-liuli-av")) return;
    for (const node of D.within(
      root,
      ".container-sidebar,.group-box,.right-sidebar:not(:has(.group-box)),.aio .side-panel,.contact-profile .profile__body",
    ))
      mark(node, "panel");
    for (const node of D.within(root, popups)) {
      if (node.matches(".bar-more-menu")) continue;
      if (D.visible(node)) mark(node, "popup");
    }
    for (const node of D.within(
      root,
      ".q-context-menu,.q-context-sub-menu__container",
    ))
      mark(node, "context");
    for (const node of D.within(root, profiles))
      if (!node.closest(".message") && D.visible(node)) profile(node);
    const inlineSearch = document.body.dataset.liuliScope === "main";
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
    if (!root.closest?.(".chat-msg-area,.chat-input-area,.recent-contact"))
      semanticProfiles(root);
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
