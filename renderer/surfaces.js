/* Surface ownership and composer geometry. Called by the existing page and
 * resize observers; this module does not create another observer or poll. */
(() => {
  "use strict";
  const PROFILE =
    ".group-profile, .group-profile-card, .group-info, .group-info-panel, .group-detail-panel, .group-profile-info, .group-profile-panel, .group-profile-view, .group-card, .mini-group, .buddy-profile, .profile-card";
  const POPUP =
    ".q-tooltips__content, .q-tooltips-v2, .sidebar-tooltips__content, .q-notification, .q-color-picker, .mini-buddy, .finger-memo-dialog, .menu-stickers-panel, .menu-stickers-wrapper .menu-stickers, .editor-at-panel, .editor-qqface-short-panel, .expression-panel .sticker-panel, .bot-panel-wrapper, .handoff-menu, .aio .panel-container:not(:has(.side-panel)), .q-menu, .q-popup__main, .q-dialog-main, .form-modal, .q-float-card, .q-popover__content, .q-context-sub-menu__container, .pulldown-menu, .q-pulldown-menu-wrapper";
  const PROTECTED =
    ".lucky-money-dialog, .send-lucky-money-dialog, .video-content, .av-call, .screen-share";
  let composer = null,
    host = null,
    scroll = null;
  function within(root, selector) {
    return [
      ...(root.matches?.(selector) ? [root] : []),
      ...root.querySelectorAll(selector),
    ];
  }
  function mark(element, kind) {
    if (element.closest(PROTECTED) || element.querySelector(PROTECTED)) return;
    if (element.dataset.liuliSurface !== kind)
      element.dataset.liuliSurface = kind;
  }
  function apply(root = document.body) {
    if (document.body.hasAttribute("data-liuli-av")) return;
    for (const element of within(
      root,
      ".container-sidebar,.recent-contact,.group-box,.right-sidebar:not(:has(.group-box))",
    ))
      mark(element, "panel");
    for (const element of within(root, POPUP)) {
      if (!element.matches(".bar-more-menu")) mark(element, "popup");
    }
    for (const element of within(root, PROFILE)) {
      if (element.closest(".message")) continue;
      let owner =
        element.closest(".q-popup__main,.q-float-card,.q-popover__content") ||
        element;
      for (
        let parent = owner.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        if (parent.matches(".q-popup__main,.q-float-card,.q-popover__content"))
          owner = parent;
      }
      mark(owner, "profile");
      if (owner !== element) element.dataset.liuliSurfaceInner = "";
      for (const inner of owner.querySelectorAll(
        ".q-float-card,.q-popup__main,.q-popover__content",
      ))
        inner.dataset.liuliSurfaceInner = "";
    }
    // A result list can be mounted before its final parent is attached.
    const searches = new Set(
      within(
        root,
        ".main-search .search-result,.search-result:has(.search-result-item),.search-result:has(.search-contact-item)",
      ),
    );
    const parentSearch = root.closest?.(".main-search .search-result");
    if (parentSearch) searches.add(parentSearch);
    for (const element of searches) mark(element, "search");
    const route = location.hash.split("?")[0];
    if (
      document.body.dataset.liuliScope === "aux" &&
      /^#\/(?:group[-_]?profile|group[-_]?info|group[-_]?detail|buddy[-_]?profile|user[-_]?profile|contact[-_]?profile)(?:\/|$)/i.test(
        route,
      )
    ) {
      const page = document.querySelector("#app > :not(.app-border)");
      if (page && !page.querySelector(".chat-msg-area")) mark(page, "profile");
    }
    const affectsSearch =
      root === document.body ||
      root.closest?.(".recent-contact,.main-search,.search-result") ||
      root.querySelector(".recent-contact,.main-search,.search-result");
    const pane =
      affectsSearch &&
      document.querySelector(".recent-contact:has(.main-search)");
    if (pane) {
      const results = pane.querySelector(".main-search .search-result");
      const list = pane.querySelector(":scope > .list-toggler");
      const open =
        !!results &&
        !!list &&
        !list.contains(results) &&
        results.getClientRects().length > 0 &&
        getComputedStyle(results).visibility !== "hidden";
      if (pane.hasAttribute("data-liuli-search-open") !== open)
        pane.toggleAttribute("data-liuli-search-open", open);
    }
  }
  function syncComposer() {
    if (
      !["main"].includes(document.body.dataset.liuliScope) &&
      !document.body.dataset.hash?.startsWith("#/chat")
    )
      return;
    const area = [...document.querySelectorAll(".chat-input-area")].find(
      (node) =>
        node.getClientRects().length && node.querySelector(".msg-input"),
    );
    if (!area) return;
    let nextHost = area.parentElement;
    while (
      nextHost &&
      !nextHost.querySelector(".chat-msg-area") &&
      !nextHost.matches(".aio")
    )
      nextHost = nextHost.parentElement;
    if (!nextHost || !nextHost.querySelector(".chat-msg-area")) return;
    const nextScroll =
      nextHost.querySelector(".chat-msg-area__vlist") ||
      nextHost.querySelector(".chat-msg-area");
    if (host !== nextHost) {
      host?.removeAttribute("data-liuli-composer-host");
      scroll?.removeAttribute("data-liuli-composer-scroll");
      host = nextHost;
      host.dataset.liuliComposerHost = "";
    }
    if (composer !== area) {
      composer?.removeAttribute("data-liuli-composer");
      composer = area;
      area.dataset.liuliComposer = "float";
      for (let p = area.parentElement; p && p !== host; p = p.parentElement)
        p.dataset.liuliComposerBridge = "";
    }
    if (scroll !== nextScroll) {
      scroll?.removeAttribute("data-liuli-composer-scroll");
      scroll = nextScroll;
      scroll.dataset.liuliComposerScroll = "";
    }
    const height = Math.ceil(area.getBoundingClientRect().height) + 30;
    const value = height + "px";
    if (host.style.getPropertyValue("--ll-composer-clearance") !== value)
      host.style.setProperty("--ll-composer-clearance", value);
  }
  window.LiuliSurfaces = Object.freeze({ apply, syncComposer });
})();
