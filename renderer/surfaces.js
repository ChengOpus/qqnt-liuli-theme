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
  // ── Opaque sheets inside a glass surface ────────────────────────────────
  // A native popup is often a transparent positioning shell holding a card
  // with its own white (or, in dark mode, near-black) fill: the group card
  // under the chat title, suggestion lists, pickers. Making only the shell
  // glass leaves a white card inside it. Large, opaque, colourless fills
  // inside an owner are cleared; anything with a colour or an image of its own
  // (buttons, tags, avatars, pictures) is left alone, and so are small items
  // whose hover/selection backgrounds are native state.
  function rgba(color) {
    const m = /rgba?\(([^)]+)\)/.exec(color || "");
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function opaqueSheet(css) {
    if (css.backgroundImage !== "none" && !/^linear-gradient\(/.test(css.backgroundImage)) return false;
    const c = rgba(css.backgroundColor);
    const image = css.backgroundImage;
    if (image !== "none") {
      // a pale gradient band (card header) counts; a coloured one does not
      const stops = image.match(/rgba?\([^)]+\)/g) || [];
      return stops.length > 0 && stops.every((stop) => {
        const s = rgba(stop);
        const l = (0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b) / 255;
        return Math.max(s.r, s.g, s.b) - Math.min(s.r, s.g, s.b) <= 24 && (l >= 0.86 || l <= 0.18 || s.a < 0.2);
      });
    }
    if (!c || c.a < 0.85) return false;
    const l = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 16 && (l >= 0.88 || l <= 0.18);
  }
  function clearSheets(outer) {
    const box = outer.getBoundingClientRect();
    if (box.width < 40 || box.height < 30) return;
    const nodes = outer.querySelectorAll("div, section, header, main, ul");
    if (nodes.length > 400) return;
    const sheets = [],
      rows = [],
      fills = new Set();
    const own = getComputedStyle(outer);
    if (opaqueSheet(own)) fills.add(own.backgroundColor);
    for (const inner of nodes) {
      if (inner.hasAttribute("data-liuli-surface-inner") || inner.hasAttribute("data-liuli-surface")) continue;
      if (inner.closest('button, [role="button"], .q-button, [class*="avatar"]')) continue;
      const css = getComputedStyle(inner);
      if (!opaqueSheet(css)) continue;
      const r = inner.getBoundingClientRect();
      if (r.width >= box.width * 0.6 && r.height >= Math.min(60, box.height * 0.4)) {
        sheets.push(inner);
        fills.add(css.backgroundColor);
      } else if (r.width >= box.width * 0.4 && r.height >= 14) rows.push([inner, css.backgroundColor]);
    }
    sheets.forEach(clear);
    // Rows painted in exactly the card's own fill are part of the card. A row
    // in a different grey (selection, a field) keeps its fill.
    for (const [row, fill] of rows) if (fills.has(fill)) clear(row);
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
  // Author layout.css:1535-1548. A standalone card window holds its content
  // in a fixed .fake-target-element; the sibling .mini-buddy is an empty
  // placeholder. Painting it lays a pane of glass over the real card.
  function placeholder(node) {
    return (
      node.matches(".mini-buddy") &&
      (!node.firstElementChild ||
        (node.parentElement?.id === "app" &&
          !!document.querySelector(".standalone-mini-profile-container")))
    );
  }
  function profile(node) {
    if (placeholder(node)) {
      if (changes.has(node) || node.hasAttribute("data-liuli-surface"))
        release(node);
      return;
    }
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
    flatten(outer);
  }
  // Structural rows inside a card are not cards themselves.
  function flatten(outer) {
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
    // The group drawer (.aio .side-panel) is one glass owner. Cards and inline
    // selectors inside it are rows of that drawer, not floating surfaces.
    const nested = (node) =>
      !node.matches(".side-panel") && !!node.closest(".aio .side-panel");
    const demote = (node) => {
      if (changes.has(node) || node.hasAttribute("data-liuli-surface"))
        release(node);
    };
    for (const node of D.within(root, popups)) {
      if (node.matches(".bar-more-menu")) continue;
      if (node.matches(".pulldown-menu") && nested(node)) {
        demote(node);
        continue;
      }
      mark(node, "popup");
      clearSheets(node);
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
    for (const node of [...profileNodes])
      if (nested(node)) {
        demote(node);
        profileNodes.delete(node);
      }
    for (const node of D.roots([...profileNodes].filter((n) => !placeholder(n))))
      if (!node.closest(".message")) profile(node);
    for (const node of profileNodes) if (placeholder(node)) profile(node);
    const inlineSearch = document.body.dataset.liuliScope === "main";
    // Native surfaces can be created hidden/at zero size, then shown through an
    // ancestor v-show/transition. Ownership never depends on insertion geometry.
    const searchNodes = new Set(
      inlineSearch
        ? D.within(
            root,
            ".main-search .search-result,.search-result:has(.search-result-item),.contact-top-bar .search-content",
          )
        : [],
    );
    const searchParent =
      inlineSearch &&
      root.closest?.(
        ".main-search .search-result,.contact-top-bar .search-content",
      );
    if (searchParent) searchNodes.add(searchParent);
    for (const node of searchNodes) {
      // The popup root can be a positioning shell that is wider/taller than
      // the list it shows. The glass belongs to the box holding the entries
      // (.search-content when the client has one); every shell around it is
      // cleared, and native geometry is left alone.
      const content = node.querySelector(".search-content");
      const painted = content && D.safe(content) ? content : node;
      for (
        let shell = painted === node ? node.parentElement : node;
        shell && shell !== document.body;
        shell = shell.parentElement
      ) {
        if (
          shell === node ||
          shell.matches(".q-popup__main,.q-float-card,.q-popover__content")
        ) {
          if (shell.hasAttribute("data-liuli-surface")) release(shell);
          clear(shell);
        }
        if (shell.matches(".main-search,.contact-top-bar,.recent-contact")) break;
      }
      mark(painted, "search");
      for (const inner of painted.querySelectorAll(
        ".q-float-card,.q-popup__main,.search-result__content,.search-recent,.search-recent-contact,.search-result-list",
      ))
        clear(inner);
      for (const inner of painted.querySelectorAll(
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
    // Standalone card windows (author layout.css:1001-1004). The window-level
    // material in auxiliary.css is the single owner; here only the card's
    // structural rows lose their second set of backgrounds. Identified by the
    // documented container, not by guessing route names or button text.
    if (document.body.dataset.liuliScope === "aux") {
      const card = document.querySelector(
        ".standalone-mini-profile-container .fake-target-element, .standalone-mini-profile-container",
      );
      if (card && D.safe(card) && !card.querySelector(".chat-msg-area"))
        flatten(card);
    }
  }
  // ── Floating sheets QQ adds under classes this theme does not know ───────
  // (input suggestion lists, newer card variants). Only the root of a change
  // and its direct children are inspected, and only when they float
  // (fixed/absolute), are sizable and paint an opaque colourless fill.
  const FIXED_UI =
    ".ml-list, .recent-contact, .container-sidebar, .group-box, .chat-header, .msg-input, .liuli-owned-ui, #liuli-settings-dialog, [data-liuli-surface], [data-liuli-surface-inner]";
  function floating(root) {
    if (!(root instanceof Element) || document.body.hasAttribute("data-liuli-av")) return;
    const candidates = [root, ...[...root.children].slice(0, 4)];
    for (const node of candidates) {
      if (node.closest(FIXED_UI) || !D.safe(node)) continue;
      const css = getComputedStyle(node);
      if (css.position !== "fixed" && css.position !== "absolute") continue;
      if (css.display === "none" || css.visibility === "hidden") continue;
      const r = node.getBoundingClientRect();
      if (r.width < 120 || r.height < 40 || r.width > innerWidth * 0.9 || r.height > innerHeight * 0.9) continue;
      // the fill may be on the node or on its single card child
      let sheet = opaqueSheet(css) ? node : null;
      if (!sheet && node.children.length === 1) {
        const child = node.firstElementChild;
        const cr = child.getBoundingClientRect();
        if (cr.width >= r.width * 0.8 && opaqueSheet(getComputedStyle(child))) sheet = child;
      }
      if (!sheet) continue;
      mark(node, "popup");
      if (sheet !== node) clear(sheet);
      clearSheets(node);
    }
  }
  window.LiuliSurfaces = Object.freeze({ apply, floating });
})();
