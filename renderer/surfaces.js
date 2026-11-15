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
  // Diagnostics: the structure of the last few popups/cards that opened —
  // class names, sizes, fills, blur; no text. A card is usually closed by the
  // time a diagnostics bundle is exported, so it is recorded when it opens.
  const recent = [];
  const clearedAsides = new WeakSet();
  function snapshot(node) {
    const shot = (el, depth) => {
      const r = el.getBoundingClientRect();
      const c = getComputedStyle(el);
      const b = getComputedStyle(el, "::before");
      const out = {
        tag: el.tagName.toLowerCase(),
        cls: String(typeof el.className === "string" ? el.className : "").replace(/\d{5,}/g, "#").slice(0, 80),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        pos: c.position,
      };
      if (c.backgroundColor !== "rgba(0, 0, 0, 0)") out.bg = c.backgroundColor;
      if (c.backgroundImage !== "none") out.bgImage = c.backgroundImage.includes("url(") ? "url" : c.backgroundImage.slice(0, 120);
      if (c.backdropFilter !== "none") out.backdrop = c.backdropFilter;
      if (c.opacity !== "1") out.opacity = c.opacity;
      if (c.filter !== "none") out.filter = c.filter.slice(0, 60);
      if (b.content !== "none" && (b.backgroundColor !== "rgba(0, 0, 0, 0)" || b.backgroundImage !== "none"))
        out.before = { bg: b.backgroundColor, bgImage: b.backgroundImage === "none" ? "none" : b.backgroundImage.includes("url(") ? "url" : "gradient", backdrop: b.backdropFilter };
      for (const a of el.attributes) if (a.name.startsWith("data-liuli")) (out.liuli ||= []).push(a.name.slice(11));
      if (depth > 0 && r.width >= 24 && r.height >= 16) {
        const kids = [...el.children].slice(0, 14).map((k) => shot(k, depth - 1));
        if (kids.length) out.children = kids;
      }
      return out;
    };
    const chain = [];
    for (let n = node.parentElement; n && n !== document.body && chain.length < 8; n = n.parentElement) {
      const c = getComputedStyle(n);
      chain.push(String(typeof n.className === "string" ? n.className : n.tagName).slice(0, 50) + " pos=" + c.position + " z=" + c.zIndex + (c.isolation !== "auto" ? " iso" : "") + (c.filter !== "none" ? " filter" : "") + (c.backdropFilter !== "none" ? " backdrop" : "") + (c.opacity !== "1" ? " op=" + c.opacity : "") + (c.transform !== "none" ? " transform" : "") + (c.willChange !== "auto" ? " will=" + c.willChange : ""));
    }
    return { at: new Date().toISOString(), tree: shot(node, 6), chain };
  }
  function remember(node, kind) {
    if (kind === "panel" || recent.some((r) => r.node === node)) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!node.isConnected || !node.getClientRects().length) return;
        try {
          recent.push({ node, kind, ...snapshot(node) });
          while (recent.length > 5) recent.shift();
        } catch (e) {}
      }),
    );
  }
  function recentPopups() {
    return recent.map(({ node, ...rest }) => rest);
  }
  function mark(node, kind) {
    if (!D.safe(node)) return;
    remember(node, kind);
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
    // Translucent ones count too: QQ's colourful theme lays 30–60% white
    // sheets in cards and pages, which read as a white mask over the glass
    // (user, 2026-11-15). Hover/selection fills stay below 0.12.
    if (!c || c.a < 0.12) return false;
    const l = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 16 && (l >= 0.88 || l <= 0.18);
  }
  // Inside a page panel (not a popup): the sections QQ draws as white boxes
  // become faint rounded cards on the glass instead of being removed.
  function softCards(outer) {
    const box = outer.getBoundingClientRect();
    if (box.width < 200) return;
    const nodes = outer.querySelectorAll("div, section, ul");
    if (nodes.length > 1500) return;
    const marks = [];
    for (const inner of nodes) {
      if (inner.hasAttribute("data-liuli-surface") || inner.hasAttribute("data-liuli-soft")) continue;
      if (inner.closest('button, [role="button"], .q-button, input, textarea, [class*="avatar"], .q-tag')) continue;
      const css = getComputedStyle(inner);
      if (!opaqueSheet(css)) continue;
      const r = inner.getBoundingClientRect();
      if (r.width < 160 || r.height < 36) continue;
      marks.push(inner);
    }
    for (const node of marks) node.setAttribute("data-liuli-soft", "");
  }
  const MENU_SURFACES =
    '.bar-more-menu-inner, .q-context-menu[data-liuli-surface], .q-context-sub-menu__container[data-liuli-surface], .pulldown-menu[data-liuli-surface], .q-pulldown-menu-wrapper[data-liuli-surface]';
  function menuLayers(menu) {
    if (!menu.hasAttribute("data-liuli-surface")) return;
    const box = menu.getBoundingClientRect();
    if (box.width < 40 || box.height < 30) return;
    const nodes = menu.querySelectorAll("div, ul, section");
    if (nodes.length > 300) return;
    for (const inner of nodes) {
      if (inner.hasAttribute("data-liuli-surface-inner") || inner.hasAttribute("data-liuli-surface")) continue;
      const r = inner.getBoundingClientRect();
      if (r.width < box.width * 0.85 || r.height < box.height * 0.85) continue;
      const css = getComputedStyle(inner);
      const m = /rgba?\(([^)]+)\)/.exec(css.backgroundColor || "");
      const alpha = m ? (m[1].split(/[,\s/]+/).filter(Boolean).length > 3 ? Number(m[1].split(/[,\s/]+/).filter(Boolean)[3]) : 1) : 0;
      const gradient = css.backgroundImage !== "none" && !/url\(/.test(css.backgroundImage);
      if (alpha > 0.04 || gradient || (css.backdropFilter && css.backdropFilter !== "none")) clear(inner);
    }
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
    // The main window's right pane when it is not a chat (contacts, group
    // notices, new friends …): one glass panel, its white boxes soft cards.
    // Page-level passes only for changes outside the chat pane: typing and
    // new messages happen inside .aio and must not pay for them.
    if (document.body.dataset.liuliScope === "main" && !root.closest?.(".aio")) {
      // The left column already is one glass sheet (shell.css); QQ's own
      // translucent white panel inside it read as a second frame (Contacts).
      // once per column, and again only when its own children change — not
      // for every conversation row update
      const asides = new Set(D.within(root, ".two-col-layout > .two-col-layout__aside"));
      const aside = root.closest?.(".two-col-layout > .two-col-layout__aside");
      if (aside && (root === aside || root.parentElement === aside || !clearedAsides.has(aside))) asides.add(aside);
      for (const node of asides)
        if (node.getClientRects().length) {
          clearedAsides.add(node);
          clearSheets(node);
        }
      // Other pages built the same way (Channels …): any large colourless
      // sheet in the page area beside the navigation becomes a glass panel,
      // its inner white boxes soft cards. Walks only large boxes.
      const views = root === document.body || root === document.documentElement
        ? document.querySelectorAll(".container-content > .container-content-view")
        : [root.closest?.(".container-content > .container-content-view") || (root.matches?.(".container-content, .container-content-view, .global-container") ? root : null)].filter(Boolean);
      for (const view0 of views) {
        const view = view0.matches(".container-content-view") ? view0 : view0.querySelector(".container-content > .container-content-view");
        if (!view) continue;
        if (!view.getClientRects().length) continue;
        const area = innerWidth * innerHeight;
        const queue = [...view.children];
        let budget = 120;
        while (queue.length && budget-- > 0) {
          const el = queue.shift();
          if (el.matches(".aio, .two-col-layout__aside, [data-liuli-surface], .q-scroll-view, [id^='liuli-']")) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 200 || r.height < 240 || r.width * r.height < area * 0.12) continue;
          if (opaqueSheet(getComputedStyle(el))) {
            mark(el, "panel");
            el.setAttribute("data-liuli-page-pane", "");
            softCards(el);
            continue;
          }
          queue.push(...el.children);
        }
      }
      webviewPages(root === document.documentElement ? document.body : root.closest?.(".webview-wrapper, .guild-layout-wrapper") || root);
      const panes = new Set(D.within(root, ".two-col-layout__main > :not(.aio)"));
      const host = root.closest?.(".two-col-layout__main > :not(.aio)");
      if (host) panes.add(host);
      for (const pane of panes) {
        const r = pane.getBoundingClientRect();
        if (r.width < 300 || r.height < 300) continue;
        if (pane.dataset.liuliSurface !== "panel") mark(pane, "panel");
        pane.setAttribute("data-liuli-page-pane", "");
        softCards(pane);
      }
    }
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
      // one glass per expression panel: the outer .expression-panel-inner
      // (author layout.css:1761-1768)
      if (node.matches(".sticker-panel") && node.parentElement?.closest(".expression-panel-inner")) {
        if (node.hasAttribute("data-liuli-surface")) release(node);
        continue;
      }
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
    // Menus: a wrapper inside that covers the whole menu and paints its own
    // fill — in QQ's colourful theme a tinted, nearly opaque one — sits over
    // the glass and made the screenshot menu a flat pink sheet (user
    // screenshot, 2026-11-15). Any colour, since it is never content; rows
    // and separators are smaller and keep theirs.
    const menus = new Set(D.within(root, MENU_SURFACES));
    const inMenu = root.closest?.(MENU_SURFACES);
    if (inMenu) menus.add(inMenu);
    for (const menu of menus) menuLayers(menu);
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
  // Diagnostics: what each main-window page is made of (large boxes in the
  // page area, their fills and blur; no text), recorded a moment after the
  // page is entered — the bundle is usually exported from another page.
  const pages = [];
  function recordPage() {
    if (document.body.dataset.liuliScope !== "main") return;
    const hash = (location.hash || "").replace(/\d{5,}/g, "#").slice(0, 60);
    const area = innerWidth * innerHeight;
    const out = [];
    const start = document.querySelector(".container-content") || document.body;
    const queue = [[start, 0]];
    while (queue.length && out.length < 60) {
      const [el, depth] = queue.shift();
      const r = el.getBoundingClientRect();
      if (r.width * r.height < area * 0.06 || depth > 9) continue;
      const c = getComputedStyle(el), b = getComputedStyle(el, "::before"), a = getComputedStyle(el, "::after");
      const pseudo = (x) => (x.content !== "none" && (x.backgroundColor !== "rgba(0, 0, 0, 0)" || x.backgroundImage !== "none") ? { bg: x.backgroundColor, img: x.backgroundImage === "none" ? "" : x.backgroundImage.includes("url(") ? "url" : "gradient", blur: x.backdropFilter } : undefined);
      out.push({
        d: depth,
        tag: el.tagName.toLowerCase(),
        cls: String(typeof el.className === "string" ? el.className : "").replace(/\d{5,}/g, "#").slice(0, 70),
        rect: [r.left, r.top, r.width, r.height].map(Math.round),
        bg: c.backgroundColor !== "rgba(0, 0, 0, 0)" ? c.backgroundColor : undefined,
        img: c.backgroundImage !== "none" ? (c.backgroundImage.includes("url(") ? "url" : "gradient") : undefined,
        blur: c.backdropFilter !== "none" ? c.backdropFilter : undefined,
        before: pseudo(b),
        after: pseudo(a),
        liuli: [...el.attributes].filter((x) => x.name.startsWith("data-liuli")).map((x) => x.name.slice(11)),
      });
      for (const k of el.children) queue.push([k, depth + 1]);
    }
    const i = pages.findIndex((p) => p.hash === hash);
    if (i >= 0) pages.splice(i, 1);
    pages.push({ hash, at: new Date().toISOString(), layers: out });
    while (pages.length > 5) pages.shift();
  }
  // ── Pages that are a <webview> (Channels: .guild-layout-wrapper >
  // webview.guild-webview, user diagnostics 2026-11-15) ─────────────────
  // The main window's styles cannot reach into an embedded page. The wrapper
  // becomes a glass panel behind it, and inside the embedded page the same
  // sheet handling as everywhere else runs through the webview's own API:
  // page-sized white/black sheets become transparent (the glass shows
  // through), smaller white boxes faint rounded cards. Fills only.
  function guestTheme(o) {
    if (window.__liuliGuest) return window.__liuliGuest(o);
    let opts = o;
    const fill = (css) => {
      const m = /rgba?\(([^)]+)\)/.exec(css.backgroundColor || "");
      if (!m) return false;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      const a = p.length > 3 ? p[3] : 1;
      if (a < 0.12) return false;
      const l = (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
      return Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]) <= 24 && (l >= 0.8 || l <= 0.2);
    };
    const pass = () => {
      const W = innerWidth, H = innerHeight;
      const out = { host: location.hostname, clear: 0, card: 0, nodes: 0 };
      for (const n of [document.documentElement, document.body]) if (n) n.style.setProperty("background", "transparent", "important");
      const nodes = document.querySelectorAll("div, section, main, header, ul, li, article, aside");
      out.nodes = nodes.length;
      if (nodes.length > 4000) return out;
      for (const el of nodes) {
        const was = el.getAttribute("data-liuli-guest");
        if (was) {
          out[was]++;
          continue;
        }
        if (el.closest("button, [role='button'], input, textarea, img, video, [class*='avatar'], [class*='image'], [class*='video'], [class*='tag']")) continue;
        const css = getComputedStyle(el);
        if (!fill(css)) continue;
        const r = el.getBoundingClientRect();
        if (r.width >= W * 0.6 && r.height >= H * 0.5) {
          el.setAttribute("data-liuli-guest", "clear");
          el.style.setProperty("background", "transparent", "important");
          el.style.setProperty("box-shadow", "none", "important");
          out.clear++;
        } else if (r.width >= 160 && r.height >= 36) {
          el.setAttribute("data-liuli-guest", "card");
          el.style.setProperty("background", opts.card, "important");
          el.style.setProperty("border-radius", "12px", "important");
          el.style.setProperty("box-shadow", "none", "important");
          el.style.setProperty("border-color", "transparent", "important");
          out.card++;
        }
      }
      return out;
    };
    let timer = 0;
    const later = () => {
      if (!timer) timer = setTimeout(() => ((timer = 0), pass()), 250);
    };
    window.__liuliGuest = (next) => {
      opts = next;
      return pass();
    };
    new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true });
    addEventListener("resize", later);
    return pass();
  }
  const guestReports = [];
  const guests = new WeakSet();
  function webviewPages(root) {
    for (const wrap of D.within(root, ".webview-wrapper, .guild-layout-wrapper")) {
      if (!wrap.getClientRects().length) continue;
      // Not mark(): the wrapper holds a <webview>, which the theme never
      // restyles; only an attribute here, the glass is the wrapper's own
      // ::before (surfaces.css) and its fill is cleared.
      if (!wrap.hasAttribute("data-liuli-webview-pane")) wrap.setAttribute("data-liuli-webview-pane", "");
      const view = wrap.querySelector("webview");
      if (!view || guests.has(view) || typeof view.executeJavaScript !== "function") continue;
      guests.add(view);
      const rgb = getComputedStyle(document.body).getPropertyValue("--ll-on-glass-rgb").trim() || "0, 0, 0";
      const run = () =>
        Promise.resolve()
          .then(() => view.executeJavaScript("(" + guestTheme.toString() + ")(" + JSON.stringify({ card: "rgba(" + rgb + ", 0.05)" }) + ")"))
          .then((r) => {
            guestReports.unshift({ at: Date.now(), ...(r || {}) });
            guestReports.length = Math.min(guestReports.length, 6);
          })
          .catch((e) => {
            guestReports.unshift({ at: Date.now(), error: String((e && e.message) || e).slice(0, 120) });
            guestReports.length = Math.min(guestReports.length, 6);
          });
      view.addEventListener("dom-ready", run);
      try {
        if (!view.isLoading()) run();
      } catch (e) {}
    }
  }
  let pageTimer = 0;
  addEventListener("hashchange", () => {
    clearTimeout(pageTimer);
    pageTimer = setTimeout(recordPage, 1500);
  });
  window.LiuliSurfaces = Object.freeze({ apply, floating, recentPopups, pageSnapshots: () => pages.slice(), recordPage, guestTheme, guestReports: () => guestReports.slice() });
})();
