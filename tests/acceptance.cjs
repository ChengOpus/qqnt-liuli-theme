// Acceptance checks for the seven handoff items (docs/HANDOFF-2026-11-13.md),
// run against qq-native-fixture.html / qq-aux-fixture.html.
//
// These replace the criteria that let earlier builds "pass": a style existing
// is never the assertion. Each check measures the thing the user sees — the
// message viewport's geometry, what is painted where, what a click reaches —
// before, during and after the interaction.
// Browser-only: not a substitute for the real Windows client.
const fs = require("node:fs"),
  path = require("node:path");
const { start, repo } = require("./harness.cjs");
const out = process.env.LIULI_QA_OUT || path.join(repo, "out", "ui-qa");
fs.mkdirSync(out, { recursive: true });

const VARIANTS = [
  { width: 1280, height: 860, scale: 1, dark: false },
  { width: 1920, height: 1080, scale: 1.25, dark: true },
  { width: 900, height: 680, scale: 1.5, dark: false },
];

// Runs in the page. Rect helpers for the visible conversation.
const pageHelpers = () => {
  window.__qa = {
    rect(node) {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom };
    },
    pane() {
      return [...document.querySelectorAll(".aio")].find(
        (n) => n.getClientRects().length,
      );
    },
    q(selector) {
      return this.pane().querySelector(selector);
    },
    snapshot() {
      const scroller = this.q("[data-liuli-composer-scroll]");
      return {
        header: this.rect(this.q(".chat-header")),
        title: this.rect(this.q(".panel-header__title")),
        action: this.rect(this.q(".panel-header__action")),
        region: this.rect(this.q(".chat-msg-area")),
        scroller: this.rect(scroller),
        scrollTop: scroller?.scrollTop ?? null,
        input: this.rect(this.q(".chat-input-area")),
        box: this.rect(this.q(".group-box")),
        controls: this.rect(document.querySelector(".window-control-area")),
        newest: this.rect(this.q(".ml-list > .ml-item:first-child .msg-content-container")),
      };
    },
    frames(n = 2) {
      return new Promise((resolve) => {
        const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve());
        step();
      });
    },
    async sample(ms) {
      const samples = [],
        end = performance.now() + ms;
      while (performance.now() < end) {
        samples.push(this.snapshot());
        await this.frames(1);
      }
      return samples;
    },
  };
};

async function run() {
  const h = await start();
  const results = [];
  let failed = 0;
  try {
    for (const variant of VARIANTS) {
      const failures = [],
        checks = {};
      const expect = (name, condition, detail) => {
        if (!condition) failures.push(name + (detail ? ": " + JSON.stringify(detail) : ""));
      };
      const { page, errors } = await h.open({
        ...variant,
        before: () => {
          // Native popup precreated hidden (v-show), before the theme boots.
          const result = document.createElement("div");
          result.className = "search-result";
          result.style.display = "none";
          result.innerHTML =
            '<div class="search-content"><button class="search-result-item">匿名搜索入口</button></div>';
          document.querySelector(".main-search").append(result);
          window.__resultClicks = 0;
          result.querySelector("button").onclick = () => window.__resultClicks++;
          const input = document.querySelector(".main-search input");
          input.addEventListener("focus", () => (result.style.display = ""));
          input.addEventListener("blur", () =>
            setTimeout(() => (result.style.display = "none"), 150),
          );
          // Native focus handling writes the editor reservation back.
          for (const editor of document.querySelectorAll(".ProseMirror"))
            editor.addEventListener("focus", () => {
              const area = editor.closest(".chat-input-area");
              area.parentElement.style.setProperty("--inputAreaHeight", "260px");
              area.style.height = "260px";
              const region = area.parentElement.querySelector(".chat-msg-area");
              region.style.setProperty("--inputAreaHeight", "260px");
              region.style.height = "calc(100% - 260px)";
            });
        },
      });
      await page.evaluate(pageHelpers);
      const W = variant.width;
      const snap = () => page.evaluate(() => __qa.snapshot());

      // ── 1. Header: two floating panels; nothing moves the message viewport ──
      const rest = await snap();
      checks.header = { rest };
      expect("header.scroller-found", !!rest.scroller);
      expect(
        "header.viewport-behind-panels",
        rest.scroller && rest.scroller.y <= rest.title.y + 1,
        { scroller: rest.scroller?.y, title: rest.title.y },
      );
      expect("header.member-panel-below", rest.box.y >= rest.header.b - 1, {
        box: rest.box.y,
        header: rest.header.b,
      });
      // Reaching for an action button must not summon the window controls.
      await page.mouse.move(rest.action.x + rest.action.w - 20, rest.action.y + 10);
      await page.waitForTimeout(350);
      expect(
        "header.action-hover-keeps-controls-hidden",
        await page.evaluate(() => !document.body.hasAttribute("data-liuli-r-r")),
      );
      const hitAction = await page.evaluate((p) => {
        const n = document.elementFromPoint(p.x, p.y);
        return !!n?.closest(".panel-header__action");
      }, { x: rest.action.x + rest.action.w - 20, y: rest.action.y + rest.action.h / 2 });
      expect("header.action-clickable", hitAction);
      // The band between the two panels belongs to the messages underneath.
      const band = await page.evaluate((p) => {
        const n = document.elementFromPoint(p.x, p.y);
        return {
          header: !!n?.closest(".chat-header"),
          messages: !!n?.closest(".chat-msg-area"),
        };
      }, { x: (rest.title.r + rest.action.x) / 2, y: rest.header.y + rest.header.h / 2 });
      expect("header.blank-band-not-intercepting", !band.header && band.messages, band);
      // the action panel and the member panel end on one line; the left
      // column carries the same glass
      const edges = await page.evaluate(() => {
        const r = (s) => document.querySelector(s)?.getBoundingClientRect();
        const aside = getComputedStyle(document.querySelector(".two-col-layout__aside"), "::before");
        return {
          action: r(".panel-header__action")?.right,
          side: r(".group-box")?.right,
          asideGlass: { content: aside.content, backdrop: aside.backdropFilter, bg: aside.backgroundImage !== "none", pe: aside.pointerEvents, z: aside.zIndex },
        };
      });
      // (with the window controls pinned, they hold that edge instead —
      // checked as controls.pinned-and-aligned)
      edges.pinned = await page.evaluate(() => document.body.hasAttribute("data-liuli-controls-pinned"));
      expect("header.action-aligned-with-side-panel", edges.pinned || edges.side == null || Math.abs(edges.action - edges.side) <= 1, edges);
      // Header tools: calls leave the header and appear in the group-apps
      // dropdown after 群精华; 群作业/群视频/群课堂 are not shown.
      const tools = await page.evaluate(async () => {
        const panel = __qa.q(".aio > .chat-header .panel-header__action");
        if (!panel.querySelector('[aria-label="语音通话"]')) return null; // the C2C pane has none
        let voice = 0;
        panel.querySelector('[aria-label="语音通话"]').addEventListener("click", () => voice++);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const shown = (l) => getComputedStyle(panel.querySelector('[aria-label="' + l + '"]').closest(".bar-icon")).display !== "none";
        const header = { voice: shown("语音通话"), video: shown("视频通话"), screen: shown("屏幕共享"), apps: shown("群应用") };
        panel.querySelector('[aria-label="群应用"]').click();
        await new Promise((r) => setTimeout(r, 120));
        const rows = [...panel.querySelectorAll(".bar-more-menu-inner .menu-list > *")]
          .filter((r) => getComputedStyle(r).display !== "none")
          .map((r) => r.textContent.trim());
        const extra = panel.querySelector('[data-liuli-menu-extra="voice"]');
        const iconSize = extra?.querySelector("svg")?.getBoundingClientRect().width;
        extra?.click();
        await new Promise((r) => setTimeout(r, 120));
        const closed = !panel.querySelector(".bar-more-menu-inner").childElementCount;
        return { header, rows, iconSize, voice, closed };
      });
      expect(
        "header.calls-in-apps-menu",
        !tools ||
          (!tools.header.voice && !tools.header.video && !tools.header.screen && tools.header.apps &&
            tools.rows.join() === "群文件,群相册,群精华,语音通话,视频通话,屏幕共享" &&
            tools.iconSize === 18 && tools.voice === 1 && tools.closed),
        tools,
      );
      // Window controls pinned: shown, beside the action panel, as wide as
      // the member panel and level with the header panels.
      const pinned = await page.evaluate(() => {
        const c = document.querySelector(".window-title-bar .window-control-area");
        if (!c) return null;
        const r = c.getBoundingClientRect(), a = __qa.q(".panel-header__action").getBoundingClientRect(), g = document.querySelector(".group-box")?.getBoundingClientRect();
        return { opacity: getComputedStyle(c).opacity, gap: Math.round(r.left - a.right), top: Math.round(r.top - a.top), bottom: Math.round(r.bottom - a.bottom), left: g ? Math.round(r.left - g.left) : null, right: g ? Math.round(r.right - g.right) : null };
      });
      expect(
        "controls.pinned-and-aligned",
        !pinned || (pinned.opacity === "1" && pinned.gap === 8 && pinned.top === 0 && pinned.bottom === 0 && (pinned.left == null || (Math.abs(pinned.left) <= 1 && Math.abs(pinned.right) <= 1))),
        pinned,
      );
      // Group drawer from the header's ⋯: under the top row, aligned with the
      // action panel and the window controls; the member panel steps out.
      const drawerCheck = await page.evaluate(async () => {
        const aio = __qa.pane();
        if (!aio.querySelector(".group-box")) return null;
        const panel = document.createElement("div");
        panel.className = "side-panel";
        panel.style.cssText = "position:absolute;right:0;top:44px;width:340px;height:500px;background:#fff";
        panel.innerHTML = '<div class="group-profile-card">群资料</div>';
        aio.append(panel);
        await new Promise((r) => setTimeout(r, 200));
        const p = panel.getBoundingClientRect();
        const a = aio.querySelector(".panel-header__action").getBoundingClientRect();
        const c = document.querySelector(".window-title-bar .window-control-area").getBoundingClientRect();
        const open = { left: Math.round(p.left - a.left), right: Math.round(p.right - c.right), top: Math.round(p.top - c.bottom), memberOpacity: getComputedStyle(aio.querySelector(".group-box")).opacity };
        panel.remove();
        await new Promise((r) => setTimeout(r, 300));
        return { open, closedOpacity: getComputedStyle(aio.querySelector(".group-box")).opacity, flag: aio.hasAttribute("data-liuli-drawer") };
      });
      expect(
        "drawer.aligned-and-member-panel-steps-out",
        !drawerCheck ||
          (Math.abs(drawerCheck.open.left) <= 1 && Math.abs(drawerCheck.open.right) <= 1 && drawerCheck.open.top === 8 &&
            drawerCheck.open.memberOpacity === "0" && drawerCheck.closedOpacity === "1" && !drawerCheck.flag),
        drawerCheck,
      );
      // Unread bubbles: muted ones grey; capped ones show the exact number
      // (read from the row's component — a stand-in for QQ's Vue tree here).
      const badges = await page.evaluate(async () => {
        const list = document.querySelector(".recent-contact");
        const rows = [...list.querySelectorAll(".recent-contact-item")].slice(0, 2);
        if (rows.length < 2) return null;
        const mk = (row, cls, text) => {
          const sub = document.createElement("sub");
          sub.className = "q-badge-sub q-badge-num " + cls;
          sub.innerHTML = "<i>" + text + "</i>";
          row.append(sub);
          return sub;
        };
        const host = list.parentElement;
        host._vnode = {
          component: {
            isUnmounted: false,
            vnode: { el: list },
            subTree: { children: rows.map((row, i) => ({ component: { isUnmounted: false, vnode: { el: row }, props: { contact: { unreadCnt: i ? 7 : 1234 } }, subTree: {} } })) },
          },
        };
        const capped = mk(rows[0], "q-badge__red", "99+");
        const muted = mk(rows[1], "q-badge__grey", "7");
        await new Promise((r) => setTimeout(r, 300));
        const res = {
          capped: capped.textContent,
          red: getComputedStyle(capped).backgroundColor,
          grey: getComputedStyle(muted).backgroundColor,
          greyText: getComputedStyle(muted).color,
          brand: getComputedStyle(document.body).getPropertyValue("--ll-brand").trim(),
        };
        capped.remove();
        muted.remove();
        delete host._vnode;
        return res;
      });
      const alphaOf = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ""); const p = m ? m[1].split(",").map(Number) : []; return p.length > 3 ? p[3] : 1; };
      // QQ's colourful-theme "miracle background" inside a card is not drawn;
      // the pinned 表情 button has no inner fill even in QQ's active state.
      const misc = await page.evaluate(async () => {
        const style = document.createElement("style");
        style.textContent =
          ".qa-active::before{content:'';position:absolute;inset:4px;border-radius:6px;background:#000}" +
          ".qa-inner{background:#000}";
        document.head.append(style);
        const card = document.createElement("div");
        card.className = "q-float-card";
        card.style.cssText = "position:fixed;left:400px;top:80px;width:300px;height:200px";
        card.innerHTML = '<div class="q-miracle-background miracle" style="position:absolute;inset:0;background:linear-gradient(#f0f,#0ff)"></div><div>群资料</div>';
        document.body.append(card);
        const emoji = __qa.q('.chat-func-bar .bar-icon.liuli-pinned:has([aria-label="表情"])');
        emoji.classList.add("qa-active");
        const inner = document.createElement("span");
        inner.className = "qa-inner";
        emoji.querySelector(".icon-item").append(inner);
        await new Promise((r) => setTimeout(r, 200));
        const res = {
          miracle: getComputedStyle(card.querySelector(".q-miracle-background")).display,
          activePseudo: getComputedStyle(emoji, "::before").content,
          innerFill: getComputedStyle(inner).backgroundColor,
        };
        card.remove();
        emoji.classList.remove("qa-active");
        inner.remove();
        style.remove();
        return res;
      });
      expect("card.no-miracle-background", misc.miracle === "none", misc);
      // cards are recorded for diagnostics when they open (no text)
      const recorded = await page.evaluate(() => {
        const list = window.LiuliSurfaces.recentPopups();
        return { n: list.length, text: /群资料/.test(JSON.stringify(list)), hasTree: !!list[0]?.tree?.cls !== undefined };
      });
      // QQ's floating card is a child window this page opens (window.open of
      // a blank page) and renders into: the theme follows it there.
      const popupCard = await page.evaluate(async () => {
        const w = window.open("", "qa-card", "width=320,height=420");
        if (!w) return { opened: false };
        await new Promise((r) => setTimeout(r, 50));
        const d = w.document;
        d.body.innerHTML =
          '<div id="app"><div class="group-card" style="position:fixed;inset:8px;border-radius:12px;background:rgba(255,255,255,.75)">' +
          '<div class="q-miracle-background" style="position:absolute;inset:0;pointer-events:none;background:linear-gradient(#f0f,#0ff)"></div>' +
          '<div class="card-body" style="position:relative;height:300px;background:rgba(255,255,255,.5)">群资料</div>' +
          '<button style="background:#06c;color:#fff">发消息</button></div></div>';
        await new Promise((r) => setTimeout(r, 400));
        const card = d.querySelector(".group-card");
        const res = {
          opened: true,
          themed: !!d.getElementById("liuli-popup-theme"),
          card: card.hasAttribute("data-liuli-popup-card"),
          cardBg: w.getComputedStyle(card).backgroundColor,
          sheetCleared: w.getComputedStyle(d.querySelector(".card-body")).backgroundColor,
          miracle: w.getComputedStyle(d.querySelector(".q-miracle-background")).display,
          button: w.getComputedStyle(d.querySelector("button")).backgroundColor,
          bodyBg: w.getComputedStyle(d.body).backgroundColor,
          recorded: window.LiuliPopupWindows.report().length,
          // the main window's wallpaper behind the card, blurred, glass on top
          wallpaper: card.hasAttribute("data-liuli-popup-wp"),
          wpImage: w.getComputedStyle(card, "::before").backgroundImage.slice(0, 30),
          wpBlur: w.getComputedStyle(card, "::before").filter,
          glass: w.getComputedStyle(card, "::after").backgroundImage.includes("gradient"),
        };
        w.close();
        return res;
      });
      expect(
        "popup-card.window-follows-theme",
        popupCard.opened && popupCard.themed && popupCard.card && popupCard.cardBg !== "rgba(255, 255, 255, 0.75)" &&
          popupCard.sheetCleared === "rgba(0, 0, 0, 0)" && popupCard.miracle === "none" &&
          popupCard.button === "rgb(0, 102, 204)" && popupCard.bodyBg === "rgba(0, 0, 0, 0)" && popupCard.recorded >= 1 &&
          popupCard.wallpaper && /url\(/.test(popupCard.wpImage) && /blur/.test(popupCard.wpBlur) && popupCard.glass,
        popupCard,
      );
      // Channels-like page: a large white sheet in the page area becomes glass
      const channel = await page.evaluate(async () => {
        const view = document.querySelector(".container-content > .container-content-view");
        const layout = view.firstElementChild;
        layout.style.display = "none";
        const page = document.createElement("div");
        page.className = "guild-layout";
        page.style.cssText = "display:flex;height:100%;gap:0";
        page.innerHTML = '<div class="guild-list" style="width:300px;background:rgba(255,255,255,.85)"></div><div class="guild-feed" style="flex:1;background:#fff"><div class="feed-card" style="height:200px;margin:20px;background:rgba(255,255,255,.6)">帖子</div></div>';
        view.append(page);
        await new Promise((r) => setTimeout(r, 400));
        const q = (s) => page.querySelector(s);
        const res = {
          list: q(".guild-list").dataset.liuliSurface,
          feed: q(".guild-feed").dataset.liuliSurface,
          feedGlass: getComputedStyle(q(".guild-feed"), "::before").backdropFilter,
          card: q(".feed-card").hasAttribute("data-liuli-soft"),
        };
        page.remove();
        layout.style.display = "";
        return res;
      });
      // Channels as QQ 9.9.36 has it (user diagnostics 2026-11-15):
      // .container-content > .guild-layout-wrapper.webview-wrapper >
      // webview.guild-webview — an embedded page the window's styles cannot
      // reach. The wrapper becomes a glass panel; inside the embedded page
      // (through the webview's executeJavaScript) page sheets turn
      // transparent and white boxes faint cards; buttons are left alone.
      const guild = await page.evaluate(async () => {
        const content = document.querySelector(".container-content");
        const view = content.querySelector(".container-content-view");
        view.style.display = "none";
        const wrap = document.createElement("div");
        wrap.className = "guild-layout-wrapper webview-wrapper";
        wrap.style.cssText = "flex:1;height:100%;min-width:0;background:#fff;position:relative";
        const wv = document.createElement("webview");
        wv.className = "guild-webview";
        wv.style.cssText = "display:flex;height:100%";
        const frame = document.createElement("iframe");
        frame.style.cssText = "border:0;flex:1;height:100%";
        frame.srcdoc =
          '<html style="background:#fff"><body style="margin:0;background:#fff;height:100vh">' +
          '<div class="guild-main" style="height:100vh;background:#f5f5f5;padding:20px;box-sizing:border-box">' +
          '<div class="feed" style="width:300px;height:80px;background:#fff">帖子</div>' +
          '<button style="background:#06c;color:#fff;width:200px;height:40px">加入</button></div></body></html>';
        wv.append(frame);
        let calls = 0;
        wv.executeJavaScript = (code) => {
          calls++;
          return Promise.resolve(frame.contentWindow.eval(code));
        };
        wv.isLoading = () => !frame.contentDocument || frame.contentDocument.readyState !== "complete";
        await new Promise((r) => {
          frame.onload = r;
          wrap.append(wv);
          content.append(wrap);
        });
        wv.dispatchEvent(new Event("dom-ready"));
        await new Promise((r) => setTimeout(r, 500));
        window.LiuliBackdrop?.scan();
        const d = frame.contentDocument, fw = frame.contentWindow;
        const res = {
          panel: wrap.dataset.liuliSurface,
          pane: wrap.hasAttribute("data-liuli-webview-pane"),
          cover: wrap.getAttribute("data-liuli-cover"),
          wrapBg: getComputedStyle(wrap).backgroundColor,
          glass: getComputedStyle(wrap, "::before").backdropFilter,
          gap: Math.round(wv.getBoundingClientRect().left - wrap.getBoundingClientRect().left),
          calls,
          guestBody: fw.getComputedStyle(d.body).backgroundColor,
          guestHtml: fw.getComputedStyle(d.documentElement).backgroundColor,
          sheet: d.querySelector(".guild-main").getAttribute("data-liuli-guest"),
          sheetBg: fw.getComputedStyle(d.querySelector(".guild-main")).backgroundColor,
          card: d.querySelector(".feed").getAttribute("data-liuli-guest"),
          button: fw.getComputedStyle(d.querySelector("button")).backgroundColor,
          text: d.querySelector(".feed").textContent,
          report: window.LiuliSurfaces.guestReports()[0] || null,
        };
        wrap.remove();
        view.style.display = "";
        return res;
      });
      expect(
        "channels.webview-page-is-glass",
        guild.pane && !guild.cover && guild.wrapBg === "rgba(0, 0, 0, 0)" && guild.glass !== "none" &&
          guild.gap === 8 && guild.calls >= 1 && guild.guestBody === "rgba(0, 0, 0, 0)" && guild.guestHtml === "rgba(0, 0, 0, 0)" &&
          guild.sheet === "clear" && guild.sheetBg === "rgba(0, 0, 0, 0)" && guild.card === "card" &&
          guild.button === "rgb(0, 102, 204)" && guild.text === "帖子" && guild.report && guild.report.clear >= 1 && !("text" in guild.report),
        guild,
      );
      const pageRec = await page.evaluate(() => {
        window.LiuliSurfaces.recordPage();
        const list = window.LiuliSurfaces.pageSnapshots();
        return { n: list.length, layers: list[0]?.layers?.length || 0, text: /帖子|匿名|示例/.test(JSON.stringify(list)) };
      });
      expect("diag.page-snapshot", pageRec.n >= 1 && pageRec.layers >= 3 && !pageRec.text, pageRec);
      expect("page-sheets.channels-get-glass", channel.list === "panel" && channel.feed === "panel" && channel.feedGlass !== "none" && channel.card, channel);
      expect("diag.recent-popups-recorded", recorded.n >= 1 && !recorded.text, recorded);
      // Contacts: QQ's translucent white panel inside the left column is
      // cleared (the column already is one glass sheet)
      const asideSheet = await page.evaluate(async () => {
        const aside = document.querySelector(".two-col-layout > .two-col-layout__aside");
        const inner = document.createElement("div");
        inner.className = "contact-list";
        inner.style.cssText = "background:rgba(255,255,255,.5);height:400px";
        aside.append(inner);
        await new Promise((r) => setTimeout(r, 300));
        const bg = getComputedStyle(inner).backgroundColor;
        inner.remove();
        return bg;
      });
      expect("aside.no-second-frame", asideSheet === "rgba(0, 0, 0, 0)", asideSheet);
      // A non-chat right pane (Contacts → 群通知 …): one glass panel; QQ's
      // translucent white section boxes become soft cards.
      const pane = await page.evaluate(async () => {
        const main = document.querySelector(".two-col-layout__main");
        const aio = main.querySelector(":scope > .aio");
        aio.style.display = "none";
        const right = document.createElement("div");
        right.className = "contact-layout__right-area";
        right.style.cssText = "height:100%";
        right.innerHTML = '<div class="sys-notify"><div class="q-scroll-view" style="background:rgba(255,255,255,.6);height:600px"><div class="recommend-list" style="background:rgba(255,247,249,.4);height:120px;margin:20px">更多群聊</div></div></div>';
        main.append(right);
        await new Promise((r) => setTimeout(r, 400));
        const res = {
          surface: right.dataset.liuliSurface,
          glass: getComputedStyle(right, "::before").backdropFilter,
          left: Math.round(right.getBoundingClientRect().left - document.querySelector(".two-col-layout__aside").getBoundingClientRect().right),
          sheet: getComputedStyle(right.querySelector(".q-scroll-view")).backgroundColor,
          card: { soft: right.querySelector(".recommend-list").hasAttribute("data-liuli-soft"), radius: getComputedStyle(right.querySelector(".recommend-list")).borderRadius },
        };
        right.remove();
        aio.style.display = "";
        return res;
      });
      expect(
        "page-pane.glass-and-soft-cards",
        pane.surface === "panel" && pane.glass !== "none" && pane.card.soft && pane.card.radius === "12px",
        pane,
      );
      expect("toolbar.pinned-round-hover-only", misc.activePseudo === "none" && misc.innerFill === "rgba(0, 0, 0, 0)", misc);
      expect("badge.exact-count-instead-of-99plus", !badges || badges.capped === "1234", badges);
      expect("badge.muted-is-faint-grey", !badges || (alphaOf(badges.grey) <= 0.2 && badges.grey !== badges.red), badges);
      expect("aside.glass", edges.asideGlass.content !== "none" && edges.asideGlass.backdrop !== "none" && edges.asideGlass.bg && edges.asideGlass.pe === "none", edges);
      // Top-row glass is lit evenly: no corner wash that darkens the lower
      // edge, and no drop shadow — only the inset edge light (user: 顶部阴影).
      const topPaint = await page.evaluate(() =>
        [".panel-header__title", ".panel-header__action"].map((s) => {
          const cs = getComputedStyle(__qa.q(s), "::before");
          // QQ's own shading of the icons/title inside the panel
          const inner = [...__qa.q(s).querySelectorAll("*")]
            .map((n) => getComputedStyle(n))
            .filter((c) => c.filter !== "none" || c.textShadow !== "none" || c.boxShadow !== "none")
            .map((c) => [c.filter, c.textShadow, c.boxShadow].join(" | "));
          return { image: cs.backgroundImage, shadow: cs.boxShadow, inner };
        }),
      );
      expect(
        "header.no-bottom-shadow",
        topPaint.every(
          (p) =>
            !/radial-gradient/.test(p.image) &&
            p.inner.length === 0 &&
            p.shadow !== "none" &&
            p.shadow.split(/,(?![^(]*\))/).every((x) => /inset/.test(x)),
        ),
        topPaint,
      );
      // Reveal window controls from the top edge and watch every frame.
      await page.mouse.move(W - 6, 2);
      const during = await page.evaluate(() => __qa.sample(520));
      const open = await snap();
      checks.header.open = open;
      expect(
        "header.controls-revealed",
        await page.evaluate(() => document.body.hasAttribute("data-liuli-r-r")),
      );
      const moved = (a, b) =>
        Math.abs(a.y - b.y) > 0.5 || Math.abs(a.h - b.h) > 0.5 || Math.abs(a.x - b.x) > 0.5;
      for (const key of ["header", "title", "region", "scroller", "input", "box"]) {
        expect(
          `header.${key}-stable-during-reveal`,
          during.every((s) => !moved(s[key], rest[key])),
          { rest: rest[key], worst: during.find((s) => moved(s[key], rest[key]))?.[key] },
        );
      }
      expect(
        "header.scroll-position-stable",
        during.every((s) => s.scrollTop === rest.scrollTop),
      );
      expect(
        "header.action-vertical-stable",
        during.every((s) => Math.abs(s.action.y - rest.action.y) < 0.5 && Math.abs(s.action.h - rest.action.h) < 0.5),
      );
      expect(
        "header.action-clear-of-controls",
        open.action.r <= open.controls.x + 0.5 || open.action.y >= open.controls.b,
        { action: open.action, controls: open.controls },
      );
      expect("header.title-clear-of-action", open.title.r <= open.action.x + 0.5, {
        title: open.title.r,
        action: open.action.x,
      });
      // Top-row glass pieces: one height, one line, contents centred.
      const row = await page.evaluate(() => {
        const box = (n) => {
          const r = n.getBoundingClientRect();
          return { y: Math.round(r.top), h: Math.round(r.height) };
        };
        const centred = (outer, inner) => {
          const a = outer.getBoundingClientRect(),
            b = inner.getBoundingClientRect();
          return Math.abs(a.top + a.height / 2 - (b.top + b.height / 2));
        };
        const title = __qa.q(".panel-header__title"),
          action = __qa.q(".panel-header__action"),
          controls = document.querySelector(".window-control-area"),
          profile = document.querySelector(".topbar-profile");
        return {
          boxes: [title, action, controls, profile].map(box),
          offCentre: [
            centred(title, title.firstElementChild),
            centred(action, action.firstElementChild),
            centred(controls, controls.firstElementChild),
            centred(profile, profile.querySelector(".user-avatar")),
          ],
          radius: [title, action, controls, profile].map((n) => getComputedStyle(n).borderRadius),
        };
      });
      checks.topRow = row;
      expect(
        "toprow.same-size-same-line",
        row.boxes.every((b) => b.h === row.boxes[0].h && b.y === row.boxes[0].y),
        row.boxes,
      );
      expect("toprow.contents-centred", row.offCentre.every((d) => d <= 1.5), row.offCentre);
      expect("toprow.same-radius", new Set(row.radius).size === 1, row.radius);
      await page.screenshot({ path: path.join(out, `accept-top-open-${variant.scale}.png`) });
      await page.mouse.move(W / 2, variant.height / 2);
      await page.waitForTimeout(1000);
      const closed = await snap();
      expect("header.action-returns", Math.abs(closed.action.x - rest.action.x) < 0.5);
      // First (oldest) message and the native top banner stay reachable.
      const top = await page.evaluate(async () => {
        const scroller = __qa.q("[data-liuli-composer-scroll]");
        scroller.scrollTop = -1e6;
        await __qa.frames(2);
        const oldest = __qa.q(".ml-list > .ml-item:last-child .msg-content-container");
        const result = {
          oldest: __qa.rect(oldest),
          header: __qa.rect(__qa.q(".chat-header")),
          tip: __qa.rect(__qa.q(".chat-msg-area__tip--top-btn")),
        };
        scroller.scrollTop = 0;
        await __qa.frames(2);
        return result;
      });
      expect("header.first-message-reachable", top.oldest.y >= top.header.b - 1, top);
      expect("header.top-banner-below-panels", top.tip.y >= top.header.b - 1, top);
      // ── A short conversation in QQ 9.9.36's layout (list area as tall as
      // the view, messages from its top): the safe-area padding must not let
      // the view scroll the messages up under the header ──
      const shortTest = await page.evaluate(async () => {
        const make = (listH, areaH) => {
          const node = document.createElement("div");
          node.style.cssText = "position:fixed;left:300px;top:8px;width:500px;height:628px;overflow:auto;padding:44px 0 72px;box-sizing:border-box;display:flex;flex-direction:column";
          node.innerHTML = '<div class="virtual-scroll-area" style="flex:none;height:' + areaH + 'px"><div class="ml-list" style="height:' + listH + 'px;background:#ccc"></div></div>';
          document.body.append(node);
          return node;
        };
        const out = {};
        for (const [name, listH, areaH] of [["fits", 152, 628], ["slightly", 560, 628], ["long", 900, 300000]]) {
          const node = make(listH, areaH);
          LiuliComposer.shortChat(node);
          node.scrollTop = node.scrollHeight; // QQ scrolling to the end
          await new Promise((r) => setTimeout(r, 80));
          const list = node.querySelector(".ml-list").getBoundingClientRect();
          const box = node.getBoundingClientRect();
          out[name] = { short: node.hasAttribute("data-liuli-short"), scrollTop: Math.round(node.scrollTop), listTop: Math.round(list.top - box.top), listBottom: Math.round(list.bottom - box.top) };
          node.remove();
        }
        return out;
      });
      expect(
        "composer.short-chat-not-scrolled-under-header",
        shortTest.fits.short && shortTest.fits.scrollTop === 0 && shortTest.fits.listTop === 44 &&
          shortTest.slightly.short && shortTest.slightly.listBottom === 628 - 72 && shortTest.slightly.listTop < 44 &&
          !shortTest.long.short && shortTest.long.scrollTop > 1000,
        shortTest,
      );
      // ── Back to the newest message: a glass button above the composer's
      // top-right corner while reading far up; one click returns to the end ──
      const jumpTest = await page.evaluate(async () => {
        const scroller = __qa.q("[data-liuli-composer-scroll]");
        const list = __qa.q(".ml-list");
        const filler = document.createElement("div");
        filler.className = "ml-item";
        filler.style.height = "4000px";
        list.append(filler); // the oldest end of the reversed list
        scroller.scrollTop = 0;
        await new Promise((r) => setTimeout(r, 120));
        const btn = () => document.getElementById("liuli-jump-bottom");
        const vis = () => !!btn() && getComputedStyle(btn()).opacity === "1" && getComputedStyle(btn()).pointerEvents === "auto";
        const atEnd = vis();
        scroller.scrollTop = -300; // a little up: still no button
        await new Promise((r) => setTimeout(r, 260));
        const nearby = vis();
        scroller.scrollTop = -3000;
        await new Promise((r) => setTimeout(r, 260));
        const far = vis();
        const composer = __qa.q(".chat-input-area").getBoundingClientRect();
        const b = btn().getBoundingClientRect();
        const place = {
          rightGap: Math.round(composer.right - b.right),
          above: Math.round(composer.top - b.bottom),
          size: Math.round(b.width),
          round: getComputedStyle(btn()).borderRadius,
          glass: getComputedStyle(btn(), "::before").backdropFilter,
          inComposer: btn().parentElement === __qa.q(".chat-input-area"),
        };
        const editor = __qa.q(".ProseMirror");
        editor.focus();
        const r = btn().getBoundingClientRect();
        const at = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
        btn().dispatchEvent(new PointerEvent("pointerdown", at));
        btn().dispatchEvent(new MouseEvent("click", at));
        await new Promise((r) => setTimeout(r, 1300));
        const after = { fromEnd: Math.abs(scroller.scrollTop), shown: vis(), focusKept: document.activeElement === editor || editor.contains(document.activeElement) };
        // switched off in settings: no button
        LiuliJumpBottom.configure({ enabled: false });
        scroller.scrollTop = -3000;
        await new Promise((r) => setTimeout(r, 260));
        const off = !!btn() && btn().isConnected;
        LiuliJumpBottom.configure({ enabled: true });
        filler.remove();
        scroller.scrollTop = 0;
        await new Promise((r) => setTimeout(r, 200));
        return { atEnd, nearby, far, place, after, off, hiddenAgain: !vis() };
      });
      expect("jump-bottom.only-when-far-up", !jumpTest.atEnd && !jumpTest.nearby && jumpTest.far, jumpTest);
      expect(
        "jump-bottom.glass-above-composer-right",
        jumpTest.place.inComposer && jumpTest.place.rightGap >= 0 && jumpTest.place.rightGap <= 8 && jumpTest.place.above >= 6 && jumpTest.place.above <= 14 &&
          jumpTest.place.size === 36 && jumpTest.place.round === "50%" && jumpTest.place.glass !== "none",
        jumpTest,
      );
      expect("jump-bottom.returns-to-newest", jumpTest.after.fromEnd <= 2 && !jumpTest.after.shown && jumpTest.after.focusKept, jumpTest);
      expect("jump-bottom.setting-off", !jumpTest.off && jumpTest.hiddenAgain, jumpTest);
      // ── Links in messages open straight away (not through QQ's safety page);
      // QQ's own handler does not run, plain text and the composer are left alone ──
      const linkTest = await page.evaluate(async () => {
        const list = __qa.q(".ml-list");
        const item = document.createElement("div");
        item.className = "ml-item";
        item.innerHTML =
          '<div class="message"><div class="message-container message-container--others"><div class="avatar-span"></div><div class="message-content__wrapper"><div class="msg-content-container container--others"><div class="message-content">' +
          '<span class="text-element"><span class="text-normal">see </span><span class="text-link" id="qa-l1">docs.qq.com/sheet/EXAMPLE?tab=AB12</span> ' +
          '<a class="text-link" id="qa-l2" href="javascript:void(0)">https://example.org/path#x</a> <span class="text-link" id="qa-l3">点这里</span></span></div></div></div></div></div>';
        list.prepend(item);
        let qq = 0;
        for (const id of ["qa-l1", "qa-l2", "qa-l3"]) document.getElementById(id).addEventListener("click", () => qq++);
        await __qa.frames(2);
        const before = LiuliLinks.debug().opened;
        const press = (el) => {
          const r = el.getBoundingClientRect();
          const at = { bubbles: true, cancelable: true, button: 0, clientX: r.left + 4, clientY: r.top + 4 };
          for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(new (type[0] === "p" ? PointerEvent : MouseEvent)(type, at));
          el.dispatchEvent(new MouseEvent("click", at));
        };
        press(document.getElementById("qa-l1"));
        const first = { opened: LiuliLinks.debug().opened - before, last: LiuliLinks.debug().last, qq };
        press(document.getElementById("qa-l2"));
        const second = { opened: LiuliLinks.debug().opened - before, last: LiuliLinks.debug().last, qq };
        press(document.getElementById("qa-l3"));
        const third = { opened: LiuliLinks.debug().opened - before, qq };
        LiuliLinks.configure({ enabled: false });
        press(document.getElementById("qa-l1"));
        const off = { opened: LiuliLinks.debug().opened - before, qq };
        LiuliLinks.configure({ enabled: true });
        item.remove();
        const addr = ["docs.qq.com/x", "https://a.example/b", "javascript:alert(1)", "点这里", "file:///c:/x", "a b.com"].map((t) => LiuliLinks.webAddress(t));
        return { first, second, third, off, addr };
      });
      // ── QQ's update reminder is dismissed with its own 下次启动更新 ──
      const updatePrompt = await page.evaluate(async () => {
        const make = (closes) => {
          const dialog = document.createElement("div");
          dialog.className = "q-dialog";
          dialog.style.cssText = "position:fixed;left:300px;top:200px;width:360px;height:300px;background:#fff;z-index:9999";
          dialog.innerHTML = '<div class="q-dialog-header"><span>更新提醒</span></div><div class="q-dialog-content"><p>本次更新：</p></div><div class="q-dialog-footer"><button class="q-button primary">立即重启更新</button><button class="q-button secondary">下次启动更新</button></div>';
          let restart = 0, later = 0;
          dialog.querySelector(".primary").addEventListener("click", () => restart++);
          dialog.querySelector(".secondary").addEventListener("click", () => {
            later++;
            if (closes) dialog.remove();
          });
          document.body.append(dialog);
          return { dialog, counts: () => ({ restart, later }) };
        };
        const a = make(true);
        LiuliUpdatePrompt.schedule();
        await new Promise((r) => setTimeout(r, 700));
        const first = { gone: !a.dialog.isConnected, ...a.counts() };
        const b = make(false);
        LiuliUpdatePrompt.schedule();
        await new Promise((r) => setTimeout(r, 1500));
        const second = { hidden: getComputedStyle(b.dialog).display === "none", ...b.counts() };
        b.dialog.remove();
        // other dialogs are not touched
        const other = document.createElement("div");
        other.className = "q-dialog";
        other.innerHTML = '<span>提示</span><button class="q-button">下次启动更新</button>';
        let otherClicks = 0;
        other.querySelector("button").addEventListener("click", () => otherClicks++);
        document.body.append(other);
        LiuliUpdatePrompt.schedule();
        await new Promise((r) => setTimeout(r, 700));
        other.remove();
        return { first, second, otherClicks, debug: LiuliUpdatePrompt.debug() };
      });
      // ── 综合搜索: the history list under the search input gets glass ──
      const searchDrop = await page.evaluate(async () => {
        const host = document.createElement("div");
        host.style.cssText = "position:fixed;left:40px;top:40px;width:600px;height:500px;z-index:9000";
        host.innerHTML =
          '<div class="qa-search-bar" style="position:relative;height:40px"><input placeholder="输入搜索关键词" style="width:520px;height:36px"></div>' +
          '<div class="qa-tabs" style="height:40px">tabs</div>' +
          '<div class="qa-results" style="position:absolute;left:0;top:120px;width:600px;height:360px;background:#fff">results</div>' +
          '<div class="qa-history" style="position:absolute;left:0;top:50px;width:520px;height:260px;z-index:5"><div class="qa-history-inner" style="height:260px;background:rgba(255,255,255,.9)"><div style="height:36px">399045429</div><div style="height:36px">960034797</div></div></div>';
        document.body.append(host);
        await __qa.frames(2);
        // (what apply() runs in the search window's scope)
        LiuliSurfaces.searchDropdown();
        await __qa.frames(2);
        const hist = host.querySelector(".qa-history");
        const res = {
          history: hist.dataset.liuliSurface || "",
          glass: getComputedStyle(hist, "::before").backdropFilter,
          innerCleared: getComputedStyle(host.querySelector(".qa-history-inner")).backgroundColor,
          resultsTaken: host.querySelector(".qa-results").hasAttribute("data-liuli-search-drop"),
          seen: LiuliSurfaces.searchSeen().length,
        };
        host.remove();
        // QQ's tinted card inside a larger shell (room for its shadow): the
        // glass goes on the card, the shell paints nothing — no second edge
        const host2 = document.createElement("div");
        host2.style.cssText = "position:fixed;left:40px;top:40px;width:640px;height:500px;z-index:9000";
        host2.innerHTML =
          '<div style="position:relative;height:40px"><input placeholder="输入搜索关键词" style="width:520px;height:36px"></div>' +
          '<div class="qa-shell" style="position:absolute;left:0;top:48px;width:600px;height:320px;padding:0 60px 40px 0;box-sizing:border-box;background:rgba(240,200,220,.5);backdrop-filter:blur(10px)">' +
          '<div class="qa-card" style="width:540px;height:280px;border-radius:12px;background:rgba(240,190,210,.85);backdrop-filter:blur(8px)"><div style="height:36px">1609403959</div></div></div>';
        document.body.append(host2);
        await __qa.frames(2);
        LiuliSurfaces.searchDropdown();
        await __qa.frames(2);
        const shell = host2.querySelector(".qa-shell"), card = host2.querySelector(".qa-card");
        res.shellCase = {
          card: card.dataset.liuliSurface || "",
          cardBg: getComputedStyle(card).backgroundColor,
          shell: shell.dataset.liuliSurface || "",
          shellBg: getComputedStyle(shell).backgroundColor,
          shellBlur: getComputedStyle(shell).backdropFilter,
        };
        host2.remove();
        return res;
      });
      expect(
        "search.dropdown-one-glass-no-second-edge",
        searchDrop.shellCase.card === "popup" && searchDrop.shellCase.cardBg === "rgba(0, 0, 0, 0)" && searchDrop.shellCase.shell === "" &&
          searchDrop.shellCase.shellBg === "rgba(0, 0, 0, 0)" && searchDrop.shellCase.shellBlur === "none",
        searchDrop.shellCase,
      );
      expect(
        "search.dropdown-is-glass",
        searchDrop.history === "popup" && searchDrop.glass !== "none" && searchDrop.innerCleared === "rgba(0, 0, 0, 0)" && !searchDrop.resultsTaken && searchDrop.seen > 0,
        searchDrop,
      );
      expect(
        "update-prompt.dismissed",
        updatePrompt.first.gone && updatePrompt.first.later === 1 && updatePrompt.first.restart === 0 &&
          updatePrompt.second.hidden && updatePrompt.second.restart === 0 && updatePrompt.otherClicks === 0,
        updatePrompt,
      );
      expect(
        "links.open-directly",
        linkTest.first.opened === 1 && linkTest.first.last === "docs.qq.com" && linkTest.first.qq === 0 &&
          linkTest.second.opened === 2 && linkTest.second.last === "example.org" && linkTest.second.qq === 0 &&
          linkTest.third.opened === 2 && linkTest.third.qq === 1 && linkTest.off.opened === 2 && linkTest.off.qq === 2 &&
          linkTest.addr[0] === "http://docs.qq.com/x" && linkTest.addr[1] === "https://a.example/b" && linkTest.addr.slice(2).every((x) => x === ""),
        linkTest,
      );

      // ── 2. Composer: floats, and stays floating ──
      const floatState = () =>
        page.evaluate(() => {
          const input = __qa.q(".chat-input-area"),
            host = input.parentElement,
            scroller = __qa.q("[data-liuli-composer-scroll]"),
            region = __qa.q(".chat-msg-area");
          const i = input.getBoundingClientRect(),
            hr = host.getBoundingClientRect(),
            s = scroller?.getBoundingClientRect(),
            g = region.getBoundingClientRect();
          const newest = __qa.q(".ml-list > .ml-item:first-child .msg-content-container").getBoundingClientRect();
          return {
            position: getComputedStyle(input).position,
            bottomGap: hr.bottom - i.bottom,
            regionGap: hr.bottom - g.bottom,
            behind: s ? s.bottom - i.top : -1,
            newestClear: i.top - newest.bottom,
            overlays: document.querySelectorAll("#liuli-input-overlay").length,
            overlayInside: !!input.querySelector("#liuli-input-overlay"),
            paint: getComputedStyle(input, "::before").backdropFilter,
            inputHeight: i.height,
          };
        });
      const floats = (name, s) => {
        expect(name + ".absolute", s.position === "absolute", s);
        expect(name + ".bottom-gap", s.bottomGap > 4 && s.bottomGap < 24, s);
        expect(name + ".no-reserved-hole", Math.abs(s.regionGap) < 1, s);
        expect(name + ".viewport-behind-editor", s.behind > 20, s);
        expect(name + ".newest-message-not-covered", s.newestClear >= 4, s);
        expect(name + ".single-toolbar", s.overlays === 1 && s.overlayInside, s);
        expect(name + ".material", /blur/.test(s.paint), s);
      };
      await page.evaluate(() => (__qa.q("[data-liuli-composer-scroll]").scrollTop = 0));
      floats("composer.rest", await floatState());
      // Click to type: native reservation is written back on focus.
      await page.locator(".aio:not([style*='none']) .ProseMirror").click();
      await page.waitForTimeout(120);
      floats("composer.focused", await floatState());
      const editorNode = await page.evaluateHandle(() => __qa.q(".ProseMirror"));
      await page.keyboard.type("第一行");
      await page.keyboard.press("Shift+Enter");
      await page.keyboard.type("第二行");
      await page.keyboard.press("Shift+Enter");
      await page.keyboard.type("第三行");
      await page.waitForTimeout(150);
      const multi = await floatState();
      floats("composer.multiline", multi);
      for (let i = 0; i < 12; i++) await page.keyboard.press("Backspace");
      await page.waitForTimeout(150);
      floats("composer.after-delete", await floatState());
      // IME composition: native events pass, the editor node is never replaced.
      await page.evaluate(() => {
        const editor = __qa.q(".ProseMirror");
        for (const [type, data] of [
          ["compositionstart", ""],
          ["compositionupdate", "zhong"],
          ["compositionend", "中"],
        ])
          editor.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }));
        editor.dispatchEvent(
          new InputEvent("input", { inputType: "deleteContentBackward", bubbles: true }),
        );
      });
      await page.waitForTimeout(250);
      checks.marker = await page.evaluate((editor) => ({
        // 3. Nothing is drawn next to the caret.
        feedback: document.querySelectorAll(".liuli-edit-feedback").length,
        ownedInEditor: __qa.q(".msg-input").querySelectorAll(".liuli-owned-ui").length,
        sameEditor: __qa.q(".ProseMirror") === editor,
        focused: document.activeElement === editor,
      }), editorNode);
      expect("marker.none-drawn", checks.marker.feedback === 0 && checks.marker.ownedInEditor === 0, checks.marker);
      expect("composer.editor-node-kept", checks.marker.sameEditor && checks.marker.focused, checks.marker);
      await page.mouse.move(W / 2, variant.height / 2);
      await page.mouse.wheel(0, -500);
      await page.waitForTimeout(150);
      floats("composer.scrolled", { ...(await floatState()), newestClear: 99 });
      await page.evaluate(() => (__qa.q("[data-liuli-composer-scroll]").scrollTop = 0));
      // Input feedback: on the owned layer and the send button only, and
      // without costing frames while the user types.
      await page.locator(".aio:not([style*='none']) .ProseMirror").click();
      const fxAfter = async (action, wait = 60) => {
        await action();
        await page.waitForTimeout(wait);
        return page.evaluate(() => {
          const fx = __qa.q(".liuli-composer-fx");
          return {
            kind: fx?.dataset.fx ? fx.dataset.kind : "",
            ready: __qa.q(".chat-input-area").hasAttribute("data-liuli-ready"),
            inEditor: !!__qa.q(".msg-input .liuli-composer-fx"),
            composited: fx ? fx.getAnimations().some((a) => a.effect?.getKeyframes().some((k) => "opacity" in k || "transform" in k)) : false,
          };
        });
      };
      const typed = await fxAfter(() => page.keyboard.type("动画"));
      expect("fx.typing", typed.kind === "type" && typed.ready && !typed.inEditor && !typed.composited, typed);
      const deleted = await fxAfter(() => page.keyboard.press("Backspace"));
      expect("fx.deleting", deleted.kind === "delete", deleted);
      const attached = await fxAfter(async () => {
        await page.evaluate(() => {
          const img = document.createElement("img");
          img.className = "image-element";
          img.width = img.height = 24;
          (__qa.q(".ProseMirror p") || __qa.q(".ProseMirror")).append(img);
        });
      }, 120);
      expect("fx.attachment", attached.kind === "attach" && attached.ready, attached);
      const cleared = await fxAfter(async () => {
        await page.evaluate(() => (__qa.q(".ProseMirror").innerHTML = "<p><br></p>"));
        await page.evaluate(() =>
          __qa.q(".ProseMirror").dispatchEvent(new InputEvent("input", { inputType: "deleteContentBackward", bubbles: true })),
        );
      }, 120);
      expect("fx.send-rests-when-empty", !cleared.ready, cleared);
      await page.waitForTimeout(700);
      expect(
        "fx.settles",
        await page.evaluate(() => !__qa.q(".liuli-composer-fx").dataset.fx),
      );
      // Frame pacing while typing and deleting 80 characters. Headless
      // Chromium renders in software, so absolute frame time says little
      // about a GPU-composited client; what can be asserted here is that the
      // effects add nothing measurable over the same typing with them off,
      // and that no long task appears.
      const pace = async () => {
        await page.evaluate(() => {
          window.__frames = [];
          window.__long = 0;
          window.__sampling = true;
          window.__observer?.disconnect();
          window.__observer = new PerformanceObserver(
            (list) => (window.__long += list.getEntries().length),
          );
          window.__observer.observe({ entryTypes: ["longtask"] });
          let last = performance.now();
          const tick = (now) => {
            window.__frames.push(now - last);
            last = now;
            if (window.__sampling) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        await page.keyboard.type("不掉帧".repeat(27).slice(0, 80), { delay: 12 });
        for (let i = 0; i < 80; i++) await page.keyboard.press("Backspace", { delay: 6 });
        return page.evaluate(() => {
          window.__sampling = false;
          const f = window.__frames.slice(2).sort((x, y) => x - y);
          return {
            frames: f.length,
            slow: f.filter((x) => x > 20).length,
            median: f[Math.floor(f.length / 2)],
            max: f[f.length - 1],
            long: window.__long,
          };
        });
      };
      // Three interleaved runs per condition; the best run of each is
      // compared (min-of-N, so a stray GC or scheduler hiccup in this shared
      // container does not decide the result).
      const best = (a, b) => (a.slow + a.median / 100 <= b.slow + b.median / 100 ? a : b);
      const runs = { off: [], on: [] };
      for (let round = 0; round < 3; round++) {
        await page.emulateMedia({ reducedMotion: "reduce" });
        runs.off.push(await pace());
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.waitForTimeout(200);
        runs.on.push(await pace());
      }
      const paceOff = runs.off.reduce(best),
        paceOn = runs.on.reduce(best);
      checks.pacing = { effectsOff: paceOff, effectsOn: paceOn, runs };
      expect("fx.no-long-tasks-while-typing", runs.on.every((r) => r.long === 0), checks.pacing);
      // "slow" = a frame that took two vsync intervals. Two of ~110 is the
      // run-to-run noise of this environment with the effects off.
      expect(
        "fx.no-added-frame-cost",
        paceOn.slow <= paceOff.slow + 3 && paceOn.median <= paceOff.median + 1 && paceOn.max <= Math.max(50, paceOff.max) + 1,
        checks.pacing,
      );
      await page.waitForTimeout(600);
      // Transient states that used to tear the layout down.
      const transient = await page.evaluate(async () => {
        const input = __qa.q(".chat-input-area"),
          app = document.getElementById("app"),
          result = {};
        const read = () => getComputedStyle(input).position;
        app.setAttribute("aria-hidden", "true"); // a modal dialog is open
        await __qa.frames(3);
        result.ariaHidden = read();
        app.removeAttribute("aria-hidden");
        input.style.visibility = "hidden"; // native re-render
        await __qa.frames(3);
        result.hidden = read();
        input.style.visibility = "";
        const pane = __qa.pane();
        pane.style.height = "0px"; // collapsed for a frame
        await __qa.frames(3);
        result.collapsed = read();
        pane.style.height = "";
        await __qa.frames(3);
        result.marks = {
          host: !!__qa.q("[data-liuli-composer-host]"),
          region: !!__qa.q("[data-liuli-message-region]"),
          scroll: !!__qa.q("[data-liuli-composer-scroll]"),
        };
        // The client recreates the editor container (new conversation type).
        const clone = input.cloneNode(true);
        clone.querySelector("#liuli-input-overlay")?.remove();
        for (const name of clone.getAttributeNames())
          if (name.startsWith("data-liuli")) clone.removeAttribute(name);
        input.replaceWith(clone);
        result.recreatedSameFrame = getComputedStyle(clone).position;
        await __qa.frames(3);
        return result;
      });
      checks.transient = transient;
      for (const key of ["ariaHidden", "hidden", "collapsed", "recreatedSameFrame"])
        expect("composer.transient." + key, transient[key] === "absolute", transient);
      expect(
        "composer.transient.marks-kept",
        transient.marks.host && transient.marks.region && transient.marks.scroll,
        transient,
      );
      floats("composer.after-recreate", await floatState());
      // Cached conversation switches (v-show), both directions, repeatedly.
      for (let i = 0; i < 8; i++) {
        const sync = await page.evaluate(() => {
          const panes = [...document.querySelectorAll(".aio")];
          const shown = panes.find((n) => n.style.display !== "none");
          const next = panes.find((n) => n !== shown);
          shown.style.display = "none";
          next.style.display = "";
          return getComputedStyle(next.querySelector(".chat-input-area")).position;
        });
        expect(`composer.switch-${i}.same-frame`, sync === "absolute", sync);
        await page.waitForTimeout(60);
        floats(`composer.switch-${i}`, await floatState());
      }
      const c2cHeader = await snap(); // 8 switches: group pane is visible again
      expect("header.restored-after-switches", Math.abs(c2cHeader.region.y - rest.region.y) < 0.5);
      // Multi-select toolbar replaces the editor inside the same floating box.
      const multiSelect = await page.evaluate(async () => {
        const ops = __qa.q(".forward-ops");
        ops.style.display = "";
        await __qa.frames(3);
        const shown = {
          editor: getComputedStyle(__qa.q(".msg-input")).display,
          position: getComputedStyle(__qa.q(".chat-input-area")).position,
        };
        ops.style.display = "none";
        await __qa.frames(3);
        shown.restored = getComputedStyle(__qa.q(".msg-input")).display;
        return shown;
      });
      expect(
        "composer.multi-select",
        multiSelect.editor === "none" && multiSelect.position === "absolute" && multiSelect.restored !== "none",
        multiSelect,
      );
      await page.screenshot({ path: path.join(out, `accept-chat-${variant.scale}.png`) });

      // ── 4. No full-height rule between navigation and conversations ──
      await page.mouse.move(2, variant.height / 2);
      await page.waitForTimeout(600);
      const nav = await page.evaluate(() => {
        const side = document.querySelector(".container-sidebar"),
          aside = document.querySelector(".two-col-layout__aside");
        const css = (n, p) => getComputedStyle(n, p);
        const glass = css(side, "::before");
        const sideRect = side.getBoundingClientRect();
        const pinned = document.querySelector(".recent-contact-item[data-liuli-pinned]");
        return {
          open: document.body.hasAttribute("data-liuli-r-nav"),
          glassRight: sideRect.right - parseFloat(glass.right),
          asideLeft: aside.getBoundingClientRect().left,
          paints: [
            css(side).borderRightWidth,
            css(side, "::after").backgroundColor,
            css(side.firstElementChild).boxShadow,
            css(document.querySelector(".container-content-view")).boxShadow,
            css(document.querySelector(".message-panel"), "::before").backgroundColor,
            css(aside).borderLeftWidth,
          ],
          handleMark: css(document.getElementById("liuli-nav-handle"), "::after").content,
          handleWidth: document.getElementById("liuli-nav-handle").getBoundingClientRect().width,
          pin: pinned
            ? [css(pinned, "::before").width, css(pinned, "::before").height]
            : null,
        };
      });
      checks.nav = nav;
      expect("nav.opened", nav.open);
      expect("nav.glass-not-flush", nav.asideLeft - nav.glassRight >= 7, nav);
      expect(
        "nav.no-native-separator",
        nav.paints.every((v) => /^(0px|none|rgba\(0, 0, 0, 0\))$/.test(v)),
        nav.paints,
      );
      expect("nav.edge-sensor-kept", nav.handleWidth === 8 && nav.handleMark === "none", nav);
      // The short per-row marker stays a short per-row marker (3px pill, 20px,
      // 28px on the selected/hovered row) — never a full-height rule.
      expect(
        "nav.pin-marker-kept",
        nav.pin && nav.pin[0] === "3px" && /^(20|28)px$/.test(nav.pin[1]),
        nav,
      );
      // Pixels: the strip between the card and the list equals the same strip
      // with every candidate painter removed outright.
      const strip = {
        x: Math.round(nav.glassRight) + 1,
        y: 24,
        width: Math.max(1, Math.round(nav.asideLeft - nav.glassRight) - 2),
        height: variant.height - 48,
      };
      const withTheme = await page.screenshot({ clip: strip });
      await page.addStyleTag({
        content:
          ".container-sidebar::after,.sidebar-nav::before,.sidebar-nav::after,.container-content-view::before,.message-panel::before,.two-col-layout__aside::before{content:none!important}" +
          ".container-sidebar,.sidebar-nav,.container-content-view,.message-panel,.two-col-layout__aside{border:0!important;box-shadow:none!important;outline:0!important}",
      });
      const stripped = await page.screenshot({ clip: strip });
      expect("nav.gap-pixels-clean", withTheme.equals(stripped));
      await page.screenshot({ path: path.join(out, `accept-nav-${variant.scale}.png`) });
      await page.mouse.move(W / 2, variant.height / 2);
      await page.waitForTimeout(500);

      // ── 5. Search suggestions: one panel, exactly the size of its entries ──
      const searchState = () =>
        page.evaluate(() => {
          const shell = document.querySelector(".search-result"),
            content = shell.querySelector(".search-content") || shell;
          const css = (n, p) => getComputedStyle(n, p);
          const painted = [...document.querySelectorAll(".main-search *, .main-search")].filter((n) => {
            const own = css(n),
              before = css(n, "::before");
            return (
              own.backdropFilter !== "none" ||
              (before.content !== "none" && before.backdropFilter !== "none") ||
              (n !== content && n.closest(".search-result") && !n.closest("button") &&
                own.backgroundColor !== "rgba(0, 0, 0, 0)")
            );
          });
          return {
            painted: painted.map((n) => n.className),
            shellShadow: css(shell).boxShadow,
            shellBefore: css(shell, "::before").content,
            contentRect: __qa.rect(content),
            shellRect: __qa.rect(shell),
            entry: __qa.rect(content.querySelector(".search-result-item")),
          };
        });
      const searchInput = page.locator(".main-search input");
      const immediate = await page.evaluate(() => {
        // Same frame as the native reveal: no shell flash before classification.
        const shell = document.querySelector(".search-result");
        shell.style.display = "";
        const css = (n) => getComputedStyle(n);
        const r = {
          shell: css(shell).backgroundColor + "|" + css(shell).boxShadow,
          content: css(shell.querySelector(".search-content")).backdropFilter,
        };
        shell.style.display = "none";
        return r;
      });
      expect("search.shell-unpainted-same-frame", immediate.shell === "rgba(0, 0, 0, 0)|none", immediate);
      await searchInput.click();
      await page.waitForTimeout(200);
      const single = await searchState();
      checks.search = { single };
      const onePanel = (name, s) => {
        expect(name + ".single-owner", s.painted.length === 1 && s.painted[0].includes("search-content"), s.painted);
        expect(name + ".shell-unpainted", s.shellShadow === "none" && s.shellBefore === "none", s);
        expect(
          name + ".panel-hugs-entries",
          s.entry.x >= s.contentRect.x && s.entry.r <= s.contentRect.r && s.contentRect.w - s.entry.w < 40,
          s,
        );
      };
      onePanel("search.single-row", single);
      await page.screenshot({ path: path.join(out, `accept-search-${variant.scale}.png`) });
      await page.evaluate(async () => {
        const content = document.querySelector(".search-content");
        for (let i = 0; i < 7; i++) {
          const b = document.createElement("button");
          b.className = "search-result-item";
          b.textContent = "最近搜索 " + i;
          content.append(b);
        }
        await __qa.frames(3);
      });
      const list = await searchState();
      checks.search.list = list;
      onePanel("search.recent-list", list);
      await page.mouse.click(list.entry.x + 20, list.entry.y + list.entry.h / 2);
      expect("search.entry-clickable", (await page.evaluate(() => window.__resultClicks)) === 1);
      await page.evaluate(() => document.activeElement.blur());
      await page.waitForTimeout(250);
      // Client without .search-content: the popup root is the panel, at its
      // native width (not a width imposed by the theme).
      const legacy = await page.evaluate(async () => {
        const shell = document.querySelector(".search-result");
        const flat = document.createElement("div");
        flat.className = "search-result";
        flat.style.cssText = "width:250px;left:0;padding:6px";
        flat.innerHTML = '<button class="search-result-item">匿名结果</button>';
        shell.replaceWith(flat);
        await __qa.frames(3);
        return {
          surface: flat.dataset.liuliSurface,
          width: flat.getBoundingClientRect().width,
          paint: getComputedStyle(flat, "::before").backdropFilter,
        };
      });
      expect(
        "search.legacy-root-is-panel",
        legacy.surface === "search" && Math.abs(legacy.width - 250) < 1 && /blur/.test(legacy.paint),
        legacy,
      );

      // ── 6. Group drawer and in-page cards: one glass owner ──
      const drawer = await page.evaluate(async () => {
        const pane = __qa.pane();
        const more = document.createElement("div");
        more.className = "more-panel";
        more.innerHTML =
          '<div class="side-panel" style="position:absolute;right:0;top:0;bottom:0;width:300px;z-index:300"><div class="group-profile-card" style="background:#fff;margin:12px;padding:12px"><div class="field-title">群名称</div><div class="field-body" style="background:#eee;border:1px solid #ccc;padding:6px">匿名群</div><div class="pulldown-menu" style="background:#fff"><div class="q-pulldown-menu-button" style="background:#eee;border:1px solid #ccc">选项</div></div></div><div class="group-member-card" style="background:#fff;margin:12px;padding:12px">成员</div></div>';
        pane.append(more);
        await __qa.frames(4);
        const css = (n, p) => getComputedStyle(n, p);
        const panel = more.querySelector(".side-panel");
        const glass = [...panel.querySelectorAll("*")].filter(
          (n) => css(n).backdropFilter !== "none" || (css(n, "::before").content !== "none" && css(n, "::before").backdropFilter !== "none"),
        );
        const r = {
          owner: panel.dataset.liuliSurface,
          ownerPaint: css(panel, "::before").backdropFilter,
          nestedGlass: glass.map((n) => n.className),
          nestedSurfaces: [...panel.querySelectorAll("[data-liuli-surface]")].map((n) => n.className),
          card: css(panel.querySelector(".group-profile-card")).backgroundColor,
          field: css(panel.querySelector(".field-body")).backgroundColor,
        };
        more.remove();
        await __qa.frames(2);
        return r;
      });
      checks.drawer = drawer;
      expect("drawer.single-owner", drawer.owner === "panel" && /blur/.test(drawer.ownerPaint), drawer);
      expect("drawer.no-nested-glass", !drawer.nestedGlass.length && !drawer.nestedSurfaces.length, drawer);
      expect("drawer.cards-are-rows", drawer.card === "rgba(0, 0, 0, 0)", drawer);
      expect("drawer.fields-light", /rgba\(.*0\.06\)/.test(drawer.field), drawer);
      const card = await page.evaluate(async () => {
        // Title-triggered card rendered in-page: zero-sized portal, fixed card.
        const portal = document.createElement("div");
        portal.className = "q-popover";
        portal.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:4000";
        portal.innerHTML =
          '<div class="mini-group" style="position:fixed;left:340px;top:90px;width:320px;padding:20px;background:#fff"><div class="mini-group__info" style="background:#fff;padding:8px">群资料</div><button class="q-button q-button--primary" style="background:#09f;color:#fff">发消息</button></div>';
        document.body.append(portal);
        await __qa.frames(4);
        const css = (n, p) => getComputedStyle(n, p);
        const node = portal.firstElementChild;
        const r = {
          surface: node.dataset.liuliSurface,
          paint: css(node, "::before").backdropFilter,
          own: css(node).backgroundColor,
          inner: css(node.firstElementChild).backgroundColor,
          button: css(node.querySelector("button")).backgroundColor,
          rect: __qa.rect(node),
          portal: portal.dataset.liuliSurface || "",
        };
        portal.remove();
        await __qa.frames(2);
        return r;
      });
      checks.card = card;
      // The group card under the chat title as QQ 9.9.36 draws it: a known
      // popover shell around a card whose own fill is white, with a pale
      // gradient band; and a suggestion list of a class this theme has never
      // seen, floating above the composer.
      const sheets = await page.evaluate(async () => {
        const shell = document.createElement("div");
        shell.className = "q-popover__content";
        shell.style.cssText = "position:fixed;left:360px;top:60px;z-index:4000";
        shell.innerHTML =
          '<div class="group-mini-card-x" style="width:300px;padding:16px;background:#fff;border-radius:8px">' +
          '<div class="head-x" style="height:60px;background:linear-gradient(#f2f4f8,#ffffff)">群名</div>' +
          '<div class="row-x" style="background:#fff;padding:8px">群号</div>' +
          '<span class="q-tag" style="background:#e5e5e5">游戏</span>' +
          '<button class="q-button q-button--primary" style="background:#09f;color:#fff">发消息</button></div>';
        document.body.append(shell);
        const input = __qa.q(".chat-input-area");
        const suggest = document.createElement("div");
        suggest.className = "unknown-suggest-list";
        suggest.style.cssText = "position:absolute;left:40px;bottom:calc(100% + 6px);width:260px;height:120px;background:#ffffff;border-radius:8px";
        suggest.innerHTML = '<div class="unknown-suggest-item" style="height:30px">候选一</div><div class="unknown-suggest-item" style="height:30px">候选二</div>';
        input.append(suggest);
        await __qa.frames(4);
        const css = (n, p) => getComputedStyle(n, p);
        const card = shell.firstElementChild;
        const r = {
          owner: shell.dataset.liuliSurface || "",
          ownerPaint: css(shell, "::before").backdropFilter,
          card: css(card).backgroundColor,
          head: css(card.querySelector(".head-x")).backgroundImage,
          row: css(card.querySelector(".row-x")).backgroundColor,
          tag: css(card.querySelector(".q-tag")).backgroundColor,
          button: css(card.querySelector("button")).backgroundColor,
          suggest: suggest.dataset.liuliSurface || "",
          suggestPaint: css(suggest, "::before").backdropFilter,
          suggestFill: css(suggest).backgroundColor,
          composerStill: css(input).position,
        };
        shell.remove();
        suggest.remove();
        await __qa.frames(2);
        return r;
      });
      checks.sheets = sheets;
      expect(
        "card.inner-white-sheet-is-glass",
        sheets.owner === "popup" && /blur/.test(sheets.ownerPaint) && sheets.card === "rgba(0, 0, 0, 0)" &&
          sheets.head === "none" && sheets.row === "rgba(0, 0, 0, 0)",
        sheets,
      );
      expect("card.tags-and-buttons-kept", sheets.tag === "rgb(229, 229, 229)" && sheets.button !== "rgb(0, 153, 255)", sheets);
      expect(
        "suggest.unknown-floating-list-is-glass",
        sheets.suggest === "popup" && /blur/.test(sheets.suggestPaint) && sheets.suggestFill === "rgba(0, 0, 0, 0)" &&
          sheets.composerStill === "absolute",
        sheets,
      );
      expect(
        "card.in-page",
        card.surface === "profile" && /blur/.test(card.paint) && card.own === "rgba(0, 0, 0, 0)" &&
          card.inner === "rgba(0, 0, 0, 0)" && card.button !== "rgb(0, 153, 255)" &&
          card.rect.x === 340 && card.rect.w === 320 && !card.portal,
        card,
      );

      // ── 7. File rows: the folder action stays beside its card ──
      const files = await page.evaluate(async () => {
        const measure = () =>
          [...__qa.pane().querySelectorAll('[data-kind^="file"]')].map((row) => {
            const bubble = row.querySelector(".msg-content-container").getBoundingClientRect(),
              action = row.querySelector(".file-side-action,.msg-side-action").getBoundingClientRect();
            return {
              kind: row.dataset.kind,
              gap: Math.round(action.left - bubble.right),
              vertical: action.top >= bubble.top - 2 && action.bottom <= bubble.bottom + 2,
            };
          });
        const before = measure();
        // History that loads already downloaded, and a long file name.
        for (const name of __qa.pane().querySelectorAll(".file-name"))
          name.textContent = "一个非常非常长的匿名文件名称用于检验省略与换行-final-v2.tar.gz";
        await __qa.frames(3);
        return { before, long: measure() };
      });
      checks.files = files;
      for (const set of ["before", "long"])
        for (const row of files[set])
          expect(`file.${set}.${row.kind}`, row.gap >= 0 && row.gap <= 24 && row.vertical, row);
      const textRows = await page.evaluate(() => {
        const pane = __qa.pane().getBoundingClientRect();
        const self = __qa.q(".message-container--self .msg-content-container").getBoundingClientRect(),
          other = __qa.q('[data-kind="text"] .msg-content-container').getBoundingClientRect();
        return { selfRight: pane.right - self.right, otherLeft: other.left - pane.left };
      });
      expect("rows.sides-kept", textRows.otherLeft < 90 && textRows.selfRight < 320, textRows);

      // ── Card-type messages: the bubble is the card ──
      const cards = await page.evaluate(async () => {
        const list = __qa.q(".ml-list");
        const row = (side, inner, bubble) => {
          const item = document.createElement("div");
          item.className = "ml-item";
          item.innerHTML =
            '<div class="message"><div class="message-container message-container--' + side +
            '"><div class="avatar-span"></div><div class="message-content__wrapper">' +
            (bubble ? '<div class="msg-content-container container--' + side + " " + bubble + '">' + inner + "</div>" : inner) +
            "</div></div></div>";
          list.prepend(item);
          return item;
        };
        // Mail reminder: a template-rendered sheet with fixed colours.
        const mail = row(
          "others",
          '<div class="ark-view-message"><div class="ark-item-container"><div class="rich-ui-app-wrapper">' +
            '<div data-view-id="app" style="background:#fff;border-radius:8px;padding:14px;width:320px">' +
            '<div data-role="sender" style="color:#000;font-weight:700">Sender</div>' +
            '<div data-role="subject" style="color:rgb(0,0,0)">Subject line</div>' +
            '<div data-role="summary" style="color:#999">Summary text that is long enough to wrap</div>' +
            '<div data-role="rule" style="height:1px;background:#e5e5e5;margin:10px 0"></div>' +
            '<div data-role="footer" style="color:#000;border-top:1px solid #eee">Details <span data-role="tag" style="background:#0099ff;color:#fff;padding:0 6px">NEW</span></div>' +
            "</div></div></div></div>",
          "ark-msg-content-container",
        );
        // Own file card without a bubble container, with a wrapping name.
        const file = row(
          "self",
          '<div class="file-message--content"><div class="file-element"><div class="normal-file" style="background:#f2f2f2"><div class="file-info" style="width:150px"><div class="file-name" style="color:#000">A-very-long-file-name-that-wraps-release.zip</div><div class="file-size" style="color:#999">2.46 MB</div></div><div class="file-icon"></div></div></div></div>',
          "",
        );
        const text = row("self", '<div class="message-content"><span class="text-element">ok</span></div>', "x");
        // Group announcement (群公告): a translucent white gradient sheet with
        // a small canvas icon in its title row.
        const notice = row(
          "others",
          '<div class="ark-view-message"><div class="ark-item-container"><div class="mannounce-card" style="background:linear-gradient(rgba(255,255,255,.92),rgba(255,255,255,.92));border-radius:12px;padding:14px;width:320px">' +
            '<div class="title" style="color:#999"><canvas width="16" height="16" style="width:16px;height:16px"></canvas><span data-role="ntitle">群公告</span></div>' +
            '<div data-role="nbody" style="color:#000">Printer whitelist sheet https://example.invalid/x</div>' +
            "</div></div></div>",
          "ark-msg-content-container",
        );
        await __qa.frames(6);
        const css = (n) => getComputedStyle(n);
        const role = (r) => mail.querySelector('[data-role="' + r + '"]');
        const gap = (item) => {
          const c = item.querySelector(".message-content__wrapper").getBoundingClientRect(),
            a = item.querySelector(".avatar-span").getBoundingClientRect();
          return Math.round(a.left - c.right);
        };
        const result = {
          sheet: css(mail.querySelector("[data-view-id]")).backgroundColor,
          sender: role("sender").dataset.liuliInk,
          subject: role("subject").dataset.liuliInk,
          summary: role("summary").dataset.liuliInk,
          senderColor: css(role("sender")).color,
          rule: css(role("rule")).backgroundColor,
          tag: css(role("tag")).backgroundColor + "|" + css(role("tag")).color,
          tagInk: role("tag").dataset.liuliInk || "",
          fileSheet: css(file.querySelector(".normal-file")).backgroundColor,
          fileAlign: css(file.querySelector(".file-name")).textAlign,
          fileName: file.querySelector(".file-name").dataset.liuliInk,
          fileGap: gap(file),
          textGap: gap(text),
          plainTouched: text.querySelectorAll("[data-liuli-card-sheet],[data-liuli-ink]").length,
          noticeSheet: notice.querySelector(".mannounce-card").getAttribute("data-liuli-card-sheet"),
          noticeBg: css(notice.querySelector(".mannounce-card")).backgroundImage,
          noticeBody: notice.querySelector('[data-role="nbody"]').dataset.liuliInk,
          noticeBodyColor: css(notice.querySelector('[data-role="nbody"]')).color,
          probe: LiuliCards.notices(),
        };
        // 群公告 as QQ 9.9.36 has it: a card drawn on a canvas
        const drawn = (paint) => {
          const item = row("others", '<div><div><div class="ark-item-container"><canvas class="ark-view-message" width="500" height="252" style="width:250px;height:126px;display:block"></canvas></div></div></div>', "ark-msg-content-container");
          const canvas = item.querySelector("canvas");
          paint(canvas.getContext("2d"));
          return item;
        };
        const arkWhite = drawn((c) => {
          c.fillStyle = "#fff"; c.beginPath(); c.roundRect(4, 4, 492, 244, 20); c.fill();
          c.fillStyle = "rgb(0,190,255)"; c.fillRect(40, 40, 30, 24);
          c.fillStyle = "#000"; c.font = "28px sans-serif"; c.fillText("Printer sheet", 40, 140);
        });
        const arkPicture = drawn((c) => {
          const g = c.createLinearGradient(0, 0, 500, 0); g.addColorStop(0, "#e33"); g.addColorStop(1, "#33e");
          c.fillStyle = g; c.fillRect(0, 0, 500, 252);
        });
        const arkLater = drawn(() => {});
        // at its default size first; QQ sizes and draws it seconds later
        const arkSized = row("others", '<div><div><div class="ark-item-container"><canvas class="ark-view-message" style="width:250px;height:126px;display:block"></canvas></div></div></div>', "ark-msg-content-container");
        LiuliCards.adapt(list);
        arkSized.scrollIntoView({ block: "center" });
        setTimeout(() => {
          const cv = arkSized.querySelector("canvas");
          cv.width = 500; cv.height = 252;
          const c = cv.getContext("2d");
          c.fillStyle = "#fff"; c.fillRect(0, 0, 500, 252); c.fillStyle = "#000"; c.fillRect(40, 100, 200, 30);
        }, 1500);
        setTimeout(() => {
          const c = arkLater.querySelector("canvas").getContext("2d");
          c.fillStyle = "#fff"; c.fillRect(0, 0, 500, 252); c.fillStyle = "#000"; c.fillRect(40, 100, 200, 30);
        }, 100);
        await new Promise((res) => setTimeout(res, 2600));
        result.ark = {
          sized: arkSized.querySelector("canvas").getAttribute("data-liuli-ark-glass"),
          blur: getComputedStyle(arkWhite.querySelector(".msg-content-container")).backdropFilter,
          white: arkWhite.querySelector("canvas").getAttribute("data-liuli-ark-glass"),
          whiteFilter: getComputedStyle(arkWhite.querySelector("canvas")).filter,
          filterDefined: !!document.getElementById("liuli-ark-light"),
          picture: arkPicture.querySelector("canvas").getAttribute("data-liuli-ark-glass"),
          pictureFilter: getComputedStyle(arkPicture.querySelector("canvas")).filter,
          later: arkLater.querySelector("canvas").getAttribute("data-liuli-ark-glass"),
          bubble: arkWhite.querySelector(".msg-content-container").hasAttribute("data-liuli-ark-bubble"),
          bubbleBg: getComputedStyle(arkWhite.querySelector(".msg-content-container")).backgroundColor,
          textBubbleBg: (() => {
            const t = [...document.querySelectorAll(".msg-content-container.container--others:not(.ark-msg-content-container)")].find((n) => n.querySelector(".text-element"));
            return t ? getComputedStyle(t).backgroundColor : "";
          })(),
          pictureBubble: arkPicture.querySelector(".msg-content-container").hasAttribute("data-liuli-ark-bubble"),
          probe: LiuliCards.arks().length,
        };
        for (const n of [arkWhite, arkPicture, arkLater, arkSized]) n.remove();
        // a card first seen before it has a size (the virtual list measures
        // rows hidden) is classified once it has one
        const late = row(
          "self",
          '<div class="ark-view-message"><div class="ark-item-container"><div class="late-card" style="background:#fff;border-radius:12px;padding:14px;width:300px"><div style="color:#000">Late card body text</div></div></div></div>',
          "ark-msg-content-container",
        );
        late.style.display = "none";
        LiuliCards.adapt(late);
        const lateHidden = late.querySelector(".late-card").hasAttribute("data-liuli-card-sheet");
        late.style.display = "";
        LiuliCards.adapt(late);
        result.late = { hidden: lateHidden, shown: late.querySelector(".late-card").getAttribute("data-liuli-card-sheet") };
        late.remove();
        await __qa.frames(1);
        window.__cardRows = [mail, file, text, notice];
        return result;
      });
      await page.evaluate(() => (__qa.q("[data-liuli-composer-scroll]").scrollTop = 0));
      await page.screenshot({ path: path.join(out, `accept-cards-${variant.scale}.png`) });
      await page.evaluate(async () => {
        for (const item of window.__cardRows) item.remove();
        await __qa.frames(2);
      });
      checks.cards = cards;
      expect("card.sheet-is-glass", cards.sheet === "rgba(0, 0, 0, 0)", cards);
      expect("card.ink-hierarchy", cards.sender === "1" && cards.subject === "1" && /[23]/.test(cards.summary || ""), cards);
      expect("card.ink-follows-theme", cards.senderColor !== "rgb(0, 0, 0)", cards);
      expect("card.rule-themed", cards.rule !== "rgb(229, 229, 229)", cards);
      expect("card.coloured-parts-untouched", cards.tag === "rgb(0, 153, 255)|rgb(255, 255, 255)" && !cards.tagInk, cards);
      expect("file.name-starts-left", /^(start|left)$/.test(cards.fileAlign), cards);
      expect("file.sheet-is-glass", cards.fileSheet === "rgba(0, 0, 0, 0)" && cards.fileName === "1", cards);
      expect("file.own-row-aligned-with-text-rows", cards.fileGap === cards.textGap, cards);
      expect("card.plain-text-untouched", cards.plainTouched === 0, cards);
      expect("card.group-announcement-is-glass", cards.noticeSheet === "light" && cards.noticeBg === "none" && cards.noticeBody === "1", cards);
      expect(
        "card.canvas-drawn-card-is-glass",
        cards.ark.white === "light" && /liuli-ark-light/.test(cards.ark.whiteFilter) && cards.ark.filterDefined &&
          cards.ark.picture === "keep" && cards.ark.pictureFilter === "none" && cards.ark.later === "light" && cards.ark.sized === "light" && /blur/.test(cards.ark.blur) && cards.ark.probe >= 3 &&
          cards.ark.bubble && cards.ark.textBubbleBg !== "" && cards.ark.bubbleBg === cards.ark.textBubbleBg && !cards.ark.pictureBubble,
        cards.ark,
      );
      expect("card.classified-once-laid-out", cards.late.hidden === false && cards.late.shown === "light", cards.late);
      expect(
        "diag.notice-probe-structure-only",
        Array.isArray(cards.probe) && cards.probe.length >= 1 && cards.probe[0].tree.length >= 3 && !/Printer|example\.invalid|群公告/.test(JSON.stringify(cards.probe)),
        cards.probe,
      );

      // ── New messages: Telegram-style arrival, nothing else animates ──
      const arrival = await page.evaluate(async () => {
        const scroller = __qa.q("[data-liuli-composer-scroll]"),
          list = __qa.q(".ml-list");
        scroller.scrollTop = 0; // newest end (reversed list)
        await __qa.frames(2);
        let seq = 9000000;
        const add = (side) => {
          const item = document.createElement("div");
          item.className = "ml-item";
          item.id = String(++seq);
          item.innerHTML =
            '<div class="message"><div class="message-container message-container--' + side +
            '"><div class="avatar-span"></div><div class="message-content__wrapper"><div class="msg-content-container container--' + side +
            '"><div class="message-content"><span class="text-element">新消息</span></div></div></div></div></div>';
          list.prepend(item);
          return item;
        };
        const sample = async (item) => {
          await __qa.frames(2);
          const moving = list.getAnimations().find((a) => a.effect?.getKeyframes()[0]?.translate);
          const bubble = item.querySelector(".message-content__wrapper");
          return {
            listShift: moving ? moving.effect.getKeyframes()[0].translate : "",
            bubble: bubble.getAnimations().length,
            // nothing between the glass and the list fades (opacity < 1 cuts the blur)
            fadesAboveGlass: (() => {
              const glass = item.querySelector(".msg-content-container");
              for (let n = glass; n && n !== list; n = n.parentElement)
                if (n.getAnimations().some((a) => a.effect?.getKeyframes().some((k) => k.opacity != null))) return true;
              return false;
            })(),
            pane: __qa.pane().hasAttribute("data-liuli-moving"),
            blur: getComputedStyle(item.querySelector(".msg-content-container")).backdropFilter,
          };
        };
        const received = await sample(add("others"));
        await new Promise((r) => setTimeout(r, 450));
        const sent = await sample(add("self"));
        await new Promise((r) => setTimeout(r, 450));
        const rest = getComputedStyle(__qa.q(".ml-list .msg-content-container")).backdropFilter;
        // Reading history: a new message must not move the view.
        scroller.scrollTop = -600;
        await __qa.frames(2);
        const anchor = [...list.children].find((n) => {
          const r = n.getBoundingClientRect();
          return r.top > 200 && r.bottom < innerHeight - 200;
        });
        const top = anchor.getBoundingClientRect().top;
        const history = await sample(add("others"));
        history.scrollKept = Math.abs(anchor.getBoundingClientRect().top - top) < 1;
        scroller.scrollTop = 0;
        await new Promise((r) => setTimeout(r, 450));
        return { received, sent, history, rest };
      });
      checks.arrival = arrival;
      expect("arrival.received-glides", /px/.test(arrival.received.listShift) && arrival.received.bubble > 0, arrival);
      expect("arrival.sent-glides", /px/.test(arrival.sent.listShift) && arrival.sent.bubble > 0, arrival);
      expect("arrival.glass-never-faded", !arrival.received.fadesAboveGlass && !arrival.sent.fadesAboveGlass, arrival);
      // glass stays on while the list moves (it used to blink off)
      expect("arrival.glass-kept-while-moving", arrival.received.blur === arrival.rest, arrival);
      expect("arrival.history-untouched", !arrival.history.listShift && arrival.history.scrollKept, arrival);

      // ── File-transfer strip under the title: hidden; the message keeps its own ──
      const fileStrip = await page.evaluate(async () => {
        const area = __qa.q(".chat-msg-area");
        const tip = document.createElement("div");
        tip.className = "chat-msg-area__tip--top";
        tip.innerHTML =
          '<div class="file-tip-x"><div class="file-tip-info"><span>11月13日.gif</span><span>39.06 MB · 待下载</span></div>' +
          '<div class="file-tip-ops"><button>下载</button><button>另存为</button><button>取消</button></div></div>';
        area.prepend(tip);
        const row = __qa.q(".ml-list .ml-item");
        const own = document.createElement("div");
        own.innerHTML = "<span>2.4 MB</span><button>下载</button><button>取消</button>";
        row.querySelector(".message-content__wrapper").append(own);
        await __qa.frames(4);
        const r = {
          strip: getComputedStyle(tip.firstElementChild).display,
          inMessage: getComputedStyle(own).display,
        };
        tip.remove();
        own.remove();
        return r;
      });
      checks.fileStrip = fileStrip;
      expect("filestrip.hidden", fileStrip.strip === "none", fileStrip);
      expect("filestrip.message-controls-kept", fileStrip.inMessage !== "none", fileStrip);

      // ── Emoji / screenshot: QQ's own icons beside "+"; emoji opens stickers ──
      const stickers = await page.evaluate(async () => {
        const native = __qa.q('.chat-func-bar .icon-item[aria-label="表情"]');
        const emojiIcon = native.closest(".bar-icon");
        let sent = 0, nativeClicks = 0;
        // QQ empties the editor once a message is sent
        __qa.q(".operation .send-msg").addEventListener("click", () => {
          sent++;
          const ed = __qa.q(".ProseMirror");
          if (ed && /image-element/.test(ed.innerHTML)) ed.innerHTML = "<p><br></p>";
        });
        let passing = null;
        const opened = [];
        let panelEl = null;
        // QQ's behaviour: the icon toggles the panel.
        native.addEventListener("click", () => {
          if (window.__qaPanelMode === "vshow") return;
          nativeClicks++;
          if (panelEl) { panelEl.remove(); panelEl = null; return; }
          const panel = document.createElement("div");
          panel.className = "expression-panel";
          panel.style.cssText = "position:fixed;left:320px;bottom:120px;width:420px;height:300px";
          let grid = "";
          for (let i = 0; i < 6; i++) grid += '<div class="stickers-item"><img style="width:80px;height:80px;display:block"></div>';
          let emoji = "";
          for (let i = 0; i < 6; i++) emoji += '<span class="emoji-tile" style="width:28px;height:28px;display:inline-block">😀</span>';
          panel.innerHTML =
            '<div class="sticker-panel-ref expression-panel-inner" style="background:#fff;height:300px"><div class="sticker-panel" style="background:#fff">' +
            '<div class="q-scroll-view stickers" style="height:220px;overflow:hidden">' + grid + emoji + "</div>" +
            '<div><div class="tabs sticker-panel__bar"><div class="tabs-container" style="display:flex">' +
            [0, 1, 2, 3, 4].map((i) => '<div class="tabs-container-item' + (i === 1 ? " tabs-container-item-active" : "") + '" style="width:40px;height:36px" data-i="' + i + '"></div>').join("") +
            "</div></div></div></div></div>";
          panel.querySelectorAll(".tabs-container-item").forEach((t) =>
            t.addEventListener("click", () => {
              opened.push(+t.dataset.i);
              panel.querySelectorAll(".tabs-container-item").forEach((x) => x.classList.toggle("tabs-container-item-active", x === t));
            }),
          );
          document.body.append(panel);
          panelEl = panel;
        });
        await __qa.frames(2);
        const plus = document.getElementById("liuli-func-toggle").getBoundingClientRect();
        const shotIcon = __qa.q('.chat-func-bar .icon-item[aria-label="截图"]').closest(".bar-icon");
        const er = emojiIcon.getBoundingClientRect(), sr = shotIcon.getBoundingClientRect();
        const others = [...__qa.q(".chat-func-bar").querySelectorAll(".bar-icon:not(.liuli-pinned)")].map((n) => getComputedStyle(n).display);
        const placement = {
          emojiGap: Math.round(er.left - plus.right),
          shotGap: Math.round(sr.left - er.right),
          sameRow: Math.abs(er.top - plus.top) < 2 && Math.abs(sr.top - plus.top) < 2,
          othersHidden: others.every((d) => d === "none"),
          proxies: document.querySelectorAll("#liuli-input-overlay button").length,
        };
        // hover opens the panel on the sticker tab
        emojiIcon.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: document.body }));
        await new Promise((r) => setTimeout(r, 400));
        const afterHover = { open: !!panelEl, tab: opened.slice() };
        // a click while open keeps it open
        native.click();
        await __qa.frames(2);
        const afterClick = { open: !!panelEl, nativeClicks };
        const editor = __qa.q(".ProseMirror");
        editor.innerHTML = "<p><br></p>";
        panelEl.querySelector(".stickers-item img").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        const img = document.createElement("img");
        img.className = "image-element";
        editor.firstElementChild.append(img);
        await new Promise((r) => setTimeout(r, 120));
        const afterSticker = sent;
        // QQ inserting on the press and closing the panel: no click arrives
        editor.innerHTML = "<p><br></p>";
        const tile = panelEl.querySelector(".stickers-item img");
        tile.addEventListener("pointerdown", () => {
          tile.closest(".stickers-item").style.display = "none";
          setTimeout(() => {
            const pic = document.createElement("span");
            pic.className = "image-element";
            pic.innerHTML = '<img style="width:80px;height:80px;display:block">';
            const before = Math.round(editor.getBoundingClientRect().height);
            editor.firstElementChild.append(pic);
            // what the reader sees while it passes through the editor
            passing = {
              held: __qa.q(".chat-input-area").hasAttribute("data-liuli-sticker-sending"),
              opacity: getComputedStyle(pic).opacity,
              grew: Math.round(editor.getBoundingClientRect().height) - before,
            };
          }, 40);
        }, { once: true });
        tile.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
        await new Promise((r) => setTimeout(r, 200));
        const afterPress = sent;
        const releasedAfterSend = !__qa.q(".chat-input-area").hasAttribute("data-liuli-sticker-sending");
        tile.closest(".stickers-item").style.display = "";
        // an "empty" ProseMirror editor as QQ has it: separator <img>,
        // trailing <br> and a zero-width character
        editor.innerHTML = '<p>\u200b<img class="ProseMirror-separator" alt=""><br class="ProseMirror-trailingBreak"></p>';
        panelEl.querySelector(".stickers-item img").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
        await __qa.frames(2);
        const pic2 = document.createElement("span");
        pic2.className = "image-element";
        pic2.innerHTML = "<img>";
        editor.firstElementChild.prepend(pic2);
        await new Promise((r) => setTimeout(r, 200));
        const afterHelpers = sent;
        editor.innerHTML = "<p><br></p>";
        panelEl.querySelector(".emoji-tile").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        const face = document.createElement("img");
        face.className = "face-element";
        editor.firstElementChild.append(face);
        await new Promise((r) => setTimeout(r, 120));
        const afterEmoji = sent - afterHelpers + afterSticker;
        editor.innerHTML = "<p>写了一半</p>";
        panelEl.querySelector(".stickers-item img").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        editor.firstElementChild.append(img.cloneNode());
        await new Promise((r) => setTimeout(r, 120));
        const afterDraft = sent - afterHelpers + afterSticker;
        // a send that does not take: the sticker is shown again, never left
        // invisible in the editor
        const sendBtn = __qa.q(".operation .send-msg");
        const swallow = (e) => e.stopImmediatePropagation();
        sendBtn.addEventListener("click", swallow, true);
        editor.innerHTML = "<p><br></p>";
        panelEl.querySelector(".stickers-item img").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
        const stuck = document.createElement("span");
        stuck.className = "image-element";
        stuck.innerHTML = "<img>";
        editor.firstElementChild.append(stuck);
        await new Promise((r) => setTimeout(r, 200));
        const stuckHidden = getComputedStyle(stuck).opacity;
        await new Promise((r) => setTimeout(r, 1700));
        const stuckShown = getComputedStyle(stuck).opacity;
        sendBtn.removeEventListener("click", swallow, true);
        editor.innerHTML = "<p><br></p>";
        // expanding "+" keeps both icons where they were
        document.getElementById("liuli-func-toggle").click();
        await __qa.frames(3);
        const er2 = emojiIcon.getBoundingClientRect();
        const expandedKept = Math.abs(er2.left - er.left) < 1.5 && Math.abs(er2.top - er.top) < 1.5;
        const gridHasEmoji = [...__qa.q(".chat-func-bar").querySelectorAll(".bar-icon")].filter((n) => !n.classList.contains("liuli-pinned") && getComputedStyle(n).display !== "none").some((n) => n.querySelector('[aria-label="表情"]'));
        LiuliComposer.expand(false);
        panelEl?.remove();
        editor.innerHTML = "<p><br></p>";
        return { passing, releasedAfterSend, stuckHidden, stuckShown, placement, afterHover, afterClick, afterSticker, afterPress, afterHelpers, afterEmoji, afterDraft, expandedKept, gridHasEmoji, debug: LiuliChatExtras.debug() };
      });
      checks.stickers = stickers;
      // After a sticker is sent the panel stays while the pointer is over it
      // and closes when the pointer leaves. QQ hides .sticker-panel with an
      // inline display:none on the press (v-show; the panel stays mounted).
      const stickerHold = await page.evaluate(async () => {
        const panel = document.createElement("div");
        panel.className = "expression-panel";
        panel.style.cssText = "position:fixed;left:320px;bottom:120px;width:420px";
        let grid = "";
        for (let i = 0; i < 6; i++) grid += '<div class="stickers-item"><img style="width:80px;height:80px;display:block"></div>';
        panel.innerHTML =
          '<div class="sticker-panel-ref expression-panel-inner"><div class="sticker-panel" style="display:flex;flex-direction:column;height:300px">' +
          '<div class="q-scroll-view stickers" style="height:220px;overflow:hidden;display:flex;flex-wrap:wrap">' + grid + "</div>" +
          '<div><div class="tabs sticker-panel__bar"><div class="tabs-container" style="display:flex">' +
          [0, 1, 2, 3, 4].map((i) => '<div class="tabs-container-item' + (i === 2 ? " tabs-container-item-active" : "") + '" style="width:40px;height:36px"></div>').join("") +
          "</div></div></div></div></div>";
        document.body.append(panel);
        const sheet = panel.querySelector(".sticker-panel");
        const tile = panel.querySelector(".stickers-item img");
        // QQ's 表情 button toggles this panel (v-show)
        window.__qaPanelMode = "vshow";
        const native = __qa.q('.chat-func-bar .icon-item[aria-label="表情"]');
        let toggles = 0, hiddenFrames = 0, watching = true;
        const toggle = () => {
          if (window.__qaPanelMode !== "vshow") return;
          toggles++;
          // Vue applies the change in a microtask
          queueMicrotask(() => (sheet.style.display = sheet.style.display === "none" ? "flex" : "none"));
        };
        native.addEventListener("click", toggle);
        // QQ closes the panel again when the message is sent
        const sendBtn = __qa.q(".operation .send-msg");
        const closeOnSend = () => {
          if (window.__qaPanelMode === "vshow") sheet.style.display = "none";
        };
        sendBtn.addEventListener("click", closeOnSend);
        // a painted frame without the panel would be a visible flicker
        const frames = () => {
          if (!watching) return;
          if (getComputedStyle(sheet).display === "none") hiddenFrames++;
          requestAnimationFrame(frames);
        };
        requestAnimationFrame(frames);
        const editor = __qa.q(".ProseMirror");
        // QQ: hide the panel on the press and put the sticker in the editor
        tile.addEventListener("pointerdown", () => {
          sheet.style.display = "none";
          setTimeout(() => {
            const pic = document.createElement("span");
            pic.className = "image-element";
            pic.innerHTML = "<img>";
            editor.firstElementChild.append(pic);
          }, 30);
        });
        await __qa.frames(2);
        const r = tile.getBoundingClientRect();
        const box = panel.querySelector(".expression-panel-inner").getBoundingClientRect();
        editor.innerHTML = "<p><br></p>";
        const sentBefore = LiuliChatExtras.debug().sent;
        document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: r.left + 10, clientY: r.top + 10 }));
        tile.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: r.left + 10, clientY: r.top + 10 }));
        // the sticker is sent (the theme presses QQ's send button) …
        await new Promise((res) => setTimeout(res, 400));
        const sent = LiuliChatExtras.debug().sent - sentBefore;
        // … and the panel is still there
        const shownAfterPress = getComputedStyle(sheet).display !== "none" && panel.querySelector(".expression-panel-inner").getBoundingClientRect().height > 100;
        document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: box.left + 50, clientY: box.top + 50 }));
        await __qa.frames(1);
        const shownInside = getComputedStyle(sheet).display !== "none";
        const flickerFrames = hiddenFrames;
        watching = false;
        document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: box.left - 40, clientY: box.top - 40 }));
        await __qa.frames(2);
        const closedOutside = getComputedStyle(sheet).display === "none";
        // a second sticker after the first: the panel is still there with its
        // stickers (the grid is QQ's, re-rendered by QQ on the reopen)
        native.click();
        await __qa.frames(2);
        const r2 = tile.getBoundingClientRect();
        document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: r2.left + 10, clientY: r2.top + 10 }));
        tile.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: r2.left + 10, clientY: r2.top + 10 }));
        await new Promise((res) => setTimeout(res, 400));
        const secondShown = getComputedStyle(sheet).display !== "none" && tile.getBoundingClientRect().height > 40;
        // Fast clicks: three stickers pressed in quick succession go out one
        // by one, none is left in the editor
        const sentFast = LiuliChatExtras.debug().sent;
        let pictures = 0;
        const countSent = () => (pictures += editor.querySelectorAll(".image-element").length);
        sendBtn.addEventListener("click", countSent, true);
        // scrolled down in the grid: stays there across sends
        const gridView = panel.querySelector(".q-scroll-view.stickers");
        gridView.style.overflow = "auto";
        gridView.insertAdjacentHTML("afterbegin", '<div style="height:120px;width:100%"></div>');
        gridView.insertAdjacentHTML("beforeend", '<div style="height:400px;width:100%"></div>');
        gridView.scrollTop = 120;
        const tiles = [...panel.querySelectorAll(".stickers-item img")].slice(1, 4);
        for (const t of tiles) {
          t.addEventListener("pointerdown", () => {
            sheet.style.display = "none";
            setTimeout(() => {
              const pic = document.createElement("span");
              pic.className = "image-element";
              pic.innerHTML = "<img>";
              editor.firstElementChild.append(pic);
            }, 30);
          });
          const tr = t.getBoundingClientRect();
          document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: tr.left + 10, clientY: tr.top + 10 }));
          t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: tr.left + 10, clientY: tr.top + 10 }));
          t.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
          await new Promise((res) => setTimeout(res, 40));
        }
        await new Promise((res) => setTimeout(res, 2500));
        sendBtn.removeEventListener("click", countSent, true);
        const fast = {
          sends: LiuliChatExtras.debug().sent - sentFast,
          pictures,
          left: editor.querySelectorAll(".image-element").length,
          shown: getComputedStyle(sheet).display !== "none",
          scrollTop: gridView.scrollTop,
        };
        document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: box.left - 40, clientY: box.top - 40 }));
        await __qa.frames(2);
        native.removeEventListener("click", toggle);
        sendBtn.removeEventListener("click", closeOnSend);
        window.__qaPanelMode = "";
        panel.remove();
        editor.innerHTML = "<p><br></p>";
        return { sent, shownAfterPress, shownInside, closedOutside, flickerFrames, toggles, secondShown, fast, debug: LiuliChatExtras.debug() };
      });
      expect(
        "sticker.panel-stays-while-pointer-over-it",
        stickerHold.sent === 1 && stickerHold.shownAfterPress && stickerHold.shownInside && stickerHold.flickerFrames === 0 &&
          stickerHold.closedOutside && stickerHold.secondShown && !stickerHold.debug.holding && stickerHold.debug.reopened >= 2 &&
          stickerHold.fast.pictures === 3 && stickerHold.fast.sends >= 1 && stickerHold.fast.left === 0 && stickerHold.fast.shown && stickerHold.fast.scrollTop === 120,
        stickerHold,
      );

      // ── A click in the text places the caret ──
      // QQ's send row is natively a full-width bar; emulate that, then click
      // into the middle of a typed line.
      await page.addStyleTag({ content: ".chat-input-area > .operation{width:100%;left:0;display:flex;justify-content:flex-end}" });
      const editorBox = page.locator(".chat-input-area .ProseMirror").first();
      await editorBox.click();
      await page.keyboard.press("End");
      const line = "abcdefghij klmnopqrst uvwxyz";
      await page.keyboard.type(line);
      await page.waitForTimeout(300);
      const caret = await page.evaluate(() => {
        const ed = __qa.q(".chat-input-area .ProseMirror");
        const range = document.createRange();
        const text = [...ed.querySelectorAll("*")].flatMap((n) => [...n.childNodes]).find((t) => t.nodeType === 3 && t.textContent.includes("klmno"));
        range.setStart(text, text.textContent.indexOf("k"));
        range.setEnd(text, text.textContent.indexOf("k") + 1);
        const r = range.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, inEditor: !!hit?.closest(".ProseMirror"), hit: hit?.className };
      });
      await page.mouse.click(caret.x, caret.y);
      await page.waitForTimeout(80);
      caret.offset = await page.evaluate(() => {
        const s = getSelection();
        return s.anchorNode?.textContent?.slice(0, s.anchorOffset).length ?? -1;
      });
      caret.expected = line.indexOf("k");
      await page.evaluate(() => { __qa.q(".chat-input-area .ProseMirror").innerHTML = "<p><br></p>"; });
      expect("composer.click-places-caret", caret.inEditor && Math.abs(caret.offset - caret.expected) <= 1, caret);

      // ── Many line breaks: the editor scrolls, the page does not move ──
      await editorBox.click();
      for (let i = 0; i < 40; i++) await page.keyboard.press("Enter");
      await page.keyboard.type("last line");
      await page.waitForTimeout(400);
      const tall = await page.evaluate(() => {
        const input = __qa.q(".chat-input-area");
        const ed = __qa.q(".chat-input-area .ProseMirror");
        const box = input.getBoundingClientRect();
        const sel = getSelection().getRangeAt(0).getBoundingClientRect();
        const scrolled = [];
        for (let n = input.parentElement; n && n !== document.body; n = n.parentElement)
          if (n.scrollTop > 0 && !n.matches("[data-liuli-composer-scroll]")) scrolled.push(n.className);
        const header = __qa.q(".aio > .chat-header").getBoundingClientRect();
        return {
          height: Math.round(box.height),
          cap: Math.round(Math.min(innerHeight * 0.36, 300) + 20),
          editorScrolls: ed.scrollHeight > ed.clientHeight + 4,
          caretInside: sel.bottom <= box.bottom + 1 && sel.top >= box.top - 1,
          scrolled,
          headerTop: Math.round(header.top),
          // the scrollbar runs along the glass edge, styled (not the system one)
          edgeGap: Math.round(box.right - ed.getBoundingClientRect().right),
          scrollbarWidth: getComputedStyle(ed).scrollbarWidth,
          // the left buttons in a column, the text given the row's width back
          stack: (() => {
            const plus = document.getElementById("liuli-func-toggle").getBoundingClientRect();
            const pins = [...input.querySelectorAll(".bar-icon.liuli-pinned")].map((n) => n.getBoundingClientRect());
            return {
              on: input.getAttribute("data-liuli-bar-rows") === "3",
              column: pins.length >= 1 && pins.every((r) => Math.abs(r.left - plus.left) <= 1),
              ordered: [plus, ...pins].map((r) => Math.round(r.top)).sort((x, y) => x - y).every((t, i, a) => !i || t - a[i - 1] >= 30),
              inside: pins.every((r) => r.top >= box.top),
              insets: [Math.round(ed.getBoundingClientRect().left + parseFloat(getComputedStyle(ed).paddingLeft) - box.left), Math.round(box.right - ed.getBoundingClientRect().right + parseFloat(getComputedStyle(ed).paddingRight))],
            };
          })(),
        };
      });
      await page.evaluate(() => { __qa.q(".chat-input-area .ProseMirror").innerHTML = "<p><br></p>"; });
      await page.waitForTimeout(400);
      const unstacked = await page.evaluate(() => !__qa.q(".chat-input-area").hasAttribute("data-liuli-bar-rows"));
      // Step by step: one line — a row; two — the last icon above "+" (a
      // triangle); three — a column. Deleting steps back.
      const fold = async () =>
        page.evaluate(() => {
          const input = __qa.q(".chat-input-area");
          const plus = document.getElementById("liuli-func-toggle").getBoundingClientRect();
          const pins = [...input.querySelectorAll(".bar-icon.liuli-pinned")].map((n) => {
            const r = n.getBoundingClientRect();
            return [Math.round((r.left - plus.left) / 32), Math.round((plus.top - r.top) / 32)];
          });
          const box = input.getBoundingClientRect();
          const ed = input.querySelector(".ProseMirror");
          const er = ed.getBoundingClientRect(), ecs = getComputedStyle(ed);
          const icons = [document.getElementById("liuli-func-toggle"), ...input.querySelectorAll(".bar-icon.liuli-pinned")].map((n) => n.getBoundingClientRect().right);
          return {
            rows: input.getAttribute("data-liuli-bar-rows") || "1",
            pins: JSON.stringify(pins),
            left: Math.round(er.left + parseFloat(ecs.paddingLeft) - box.left),
            right: Math.round(box.right - (er.right - parseFloat(ecs.paddingRight))),
            gap: Math.round(er.left + parseFloat(ecs.paddingLeft) - Math.max(...icons)),
            inside: [...input.querySelectorAll(".bar-icon.liuli-pinned")].every((n) => n.getBoundingClientRect().top >= input.getBoundingClientRect().top - 0.5),
          };
        });
      // QQ's editor brings a left padding of its own
      await page.evaluate(() => (__qa.q(".chat-input-area .ProseMirror").style.paddingLeft = "20px"));
      await editorBox.click();
      await page.keyboard.type("one");
      await page.waitForTimeout(400);
      const f1 = await fold();
      await page.keyboard.press("Enter");
      await page.keyboard.type("two");
      await page.waitForTimeout(400);
      const f2 = await fold();
      await page.keyboard.press("Enter");
      await page.keyboard.type("three");
      await page.waitForTimeout(400);
      const f3 = await fold();
      for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
      await page.waitForTimeout(400);
      const f2b = await fold();
      await page.evaluate(() => { __qa.q(".chat-input-area .ProseMirror").innerHTML = "<p><br></p>"; });
      await page.waitForTimeout(400);
      const f0 = await fold();
      await page.evaluate(() => (__qa.q(".chat-input-area .ProseMirror").style.paddingLeft = ""));
      const folds = { f1, f2, f3, f2b, f0 };
      // ── The screenshot icon's menu is real glass: QQ's pressed/open state
      // dims the icon and the menu shell; the menu still blurs what is
      // behind it (a red block shows through, tinted) ──
      const shotMenu = await page.evaluate(async () => {
        const icon = __qa.q('.chat-input-area .bar-icon.liuli-pinned .icon-item[aria-label="截图"]').closest(".bar-icon");
        const style = document.createElement("style");
        // and QQ's colourful theme paints the menu with its own ::before
        // (user diagnostics: rgba(227,200,201,.9), blur(8px)), important
        style.textContent =
          ".qa-shot-open{opacity:.92;filter:brightness(.98)} .qa-shot-open .bar-more-menu{opacity:.99}" +
          ".chat-func-bar .bar-icon .bar-more-menu .bar-more-menu-inner.q-context-menu::before{content:'';position:absolute;inset:0;background:linear-gradient(rgba(227,200,201,.9),rgba(227,200,201,.9)) !important;background-color:rgba(227,200,201,.9) !important;backdrop-filter:blur(8px) !important}" +
          ".chat-func-bar .bar-icon .bar-more-menu .bar-more-menu-inner.q-context-menu::after{content:'';position:absolute;inset:0;background:rgba(227,200,201,.5) !important}";
        document.head.append(style);
        icon.classList.add("qa-shot-open", "active");
        const shell = document.createElement("div");
        shell.className = "bar-more-menu";
        shell.innerHTML = '<div class="bar-more-menu-inner q-context-menu" style="position:fixed;left:0;bottom:36px;width:220px;height:180px"><div class="menu-tint" style="width:100%;height:100%;background:rgba(240,200,210,.95)"><div class="q-context-menu-item"><span class="q-context-menu-item__label">截图</span></div></div></div>';
        icon.append(shell);
        await __qa.frames(4);
        const inner = shell.firstElementChild;
        const r = inner.getBoundingClientRect();
        const red = document.createElement("div");
        red.style.cssText = "position:fixed;z-index:1;background:#00f;left:" + (r.left + 60) + "px;top:" + (r.top + 50) + "px;width:80px;height:80px";
        __qa.q(".chat-msg-area").append(red);
        await __qa.frames(3);
        const chain = [];
        for (let n = inner.parentElement; n && !n.matches(".chat-input-area"); n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.opacity !== "1" || cs.filter !== "none" || cs.mixBlendMode !== "normal") chain.push(n.className + ":" + cs.opacity + "/" + cs.filter);
        }
        return {
          surface: inner.dataset.liuliSurface || "",
          glass: getComputedStyle(inner, "::before").backdropFilter,
          tint: getComputedStyle(inner.querySelector(".menu-tint")).backgroundColor,
          beforeBg: getComputedStyle(inner, "::before").backgroundColor,
          afterBg: getComputedStyle(inner, "::after").backgroundColor,
          chain,
          sample: { x: Math.round(r.left + 100), y: Math.round(r.top + 90) },
        };
      });
      const shotPng = await page.screenshot({ clip: { x: shotMenu.sample.x, y: shotMenu.sample.y, width: 1, height: 1 } });
      shotMenu.pixel = await page.evaluate(async (b64) => {
        const img = new Image();
        img.src = "data:image/png;base64," + b64;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        const x = c.getContext("2d");
        x.drawImage(img, 0, 0);
        return [...x.getImageData(0, 0, 1, 1).data];
      }, shotPng.toString("base64"));
      await page.evaluate(() => {
        document.querySelector(".qa-shot-open .bar-more-menu")?.remove();
        [...document.head.querySelectorAll("style")].filter((n) => n.textContent.includes("qa-shot-open")).forEach((n) => n.remove());
        document.querySelector(".qa-shot-open")?.classList.remove("qa-shot-open", "active");
        [...document.querySelectorAll(".chat-msg-area > div")].filter((n) => n.style.background === "rgb(0, 0, 255)").forEach((n) => n.remove());
      });
      expect(
        "screenshot-menu.is-glass",
        shotMenu.surface === "context" && /saturate/.test(shotMenu.glass) && shotMenu.beforeBg !== "rgba(227, 200, 201, 0.9)" && shotMenu.afterBg === "rgba(0, 0, 0, 0)" && shotMenu.tint === "rgba(0, 0, 0, 0)" && !shotMenu.chain.length && shotMenu.pixel[2] - shotMenu.pixel[0] > 30,
        shotMenu,
      );
      expect("composer.long-draft-buttons-stack", tall.stack.on && tall.stack.column && Math.abs(tall.stack.insets[0] - tall.stack.insets[1]) <= 1 && tall.stack.ordered && tall.stack.inside && unstacked, { stack: tall.stack, unstacked });
      expect(
        "composer.buttons-fold-row-triangle-column",
        f1.rows === "1" && f1.pins === "[[1,0],[2,0]]" && Math.abs(f1.gap - 12) <= 1 &&
          f2.rows === "2" && f2.pins === "[[1,0],[0,1]]" && Math.abs(f2.gap - 12) <= 1 && f2.inside &&
          f3.rows === "3" && f3.pins === "[[0,2],[0,1]]" && Math.abs(f3.left - f3.right) <= 1 && f3.gap >= 8 && f3.inside &&
          f2b.rows === "2" && f0.rows === "1" && f0.pins === "[[1,0],[2,0]]",
        folds,
      );
      expect("composer.long-draft-scrolls-inside", tall.height <= tall.cap && tall.editorScrolls && tall.caretInside && !tall.scrolled.length && tall.headerTop >= 0 && tall.edgeGap <= 1 && tall.scrollbarWidth === "auto", tall);
      const P = stickers.placement;
      expect("toolbar.native-emoji-and-screenshot-beside-plus", P.sameRow && P.emojiGap >= 2 && P.emojiGap <= 6 && P.shotGap >= 2 && P.shotGap <= 6 && P.proxies === 1, stickers);
      expect("toolbar.rest-stay-in-plus-menu", P.othersHidden, stickers);
      expect("toolbar.icons-stay-while-plus-open", stickers.expandedKept && !stickers.gridHasEmoji, stickers);
      expect("sticker.hover-opens-sticker-tab", stickers.afterHover.open && stickers.afterHover.tab[0] === 2, stickers);
      expect("sticker.click-keeps-panel-open", stickers.afterClick.open && stickers.afterClick.nativeClicks === 1, stickers);
      expect("sticker.sends-at-once", stickers.afterSticker === 1, stickers);
      expect("sticker.sends-when-qq-inserts-on-press", stickers.afterPress === 2, stickers);
      expect("sticker.not-drawn-in-editor-on-its-way", !!stickers.passing && stickers.passing.held && stickers.passing.opacity === "0" && stickers.passing.grew <= 1 && stickers.releasedAfterSend, stickers);
      expect("sticker.shown-again-if-send-does-not-take", stickers.stuckHidden === "0" && stickers.stuckShown === "1", stickers);
      expect("sticker.sends-from-editor-with-prosemirror-helpers", stickers.afterHelpers === 3, stickers);
      expect("sticker.emoji-not-sent", stickers.afterEmoji === 1, stickers);
      expect("sticker.draft-not-sent", stickers.afterDraft === 1, stickers);
      // Send button: light at rest, a light tint when ready, arrow visible.
      const send = await page.evaluate(async () => {
        const area = __qa.q(".chat-input-area"), wrap = area.querySelector(".send-btn-wrap");
        const read = () => ({
          bg: getComputedStyle(wrap).backgroundColor,
          arrow: getComputedStyle(wrap, "::after").backgroundColor,
          mask: getComputedStyle(wrap, "::after").maskImage || getComputedStyle(wrap, "::after").webkitMaskImage,
        });
        const rest = read();
        area.setAttribute("data-liuli-ready", "");
        const ready = read();
        area.removeAttribute("data-liuli-ready");
        return { rest, ready };
      });
      checks.send = send;
      const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); const p = m ? m[1].split(",").map(Number) : [0,0,0,1]; return p.length > 3 ? p[3] : 1; };
      expect("send.light-fill", alpha(send.rest.bg) <= 0.2 && alpha(send.ready.bg) <= 0.2, send);
      expect("send.arrow-drawn", /url\(/.test(send.ready.mask) && send.ready.arrow !== send.ready.bg && alpha(send.ready.arrow) > 0.5, send);

      // ── Diagnostics: structure only, never content ──
      const probe = await page.evaluate(() => {
        const snap = window.__liuliDiagSnapshot();
        return snap.structureProbe;
      });
      const probeText = JSON.stringify(probe || {});
      expect("diag.probe-present", !!probe?.inputChain && !!probe?.navEdge && !!probe?.fileRows?.length, Object.keys(probe || {}));
      expect("diag.probe-has-no-text", !/示例|匿名|会话|公告|\.zip/.test(probeText));
      expect("diag.probe-header-effects", Array.isArray(probe?.headerEffects), probe?.headerEffects);
      expect(
        "diag.probe-layers",
        !!probe?.layers?.app && !!probe.layers.container && probe.layers.points?.length === 3 && typeof probe.layers.containerInApp === "boolean",
        Object.keys(probe?.layers || {}),
      );
      // Taskbar flash decision: did the unread message count just go up?
      const notice = await page.evaluate(async () => {
        // QQ's navigation: the Messages tab first, its badge 2
        const nav = document.createElement("div");
        nav.className = "sidebar__nav";
        nav.innerHTML = '<div class="nav-item"><span class="q-badge-num">2</span></div><div class="nav-item"></div>';
        nav.style.cssText = "position:fixed;left:-99px;top:0";
        document.body.append(nav);
        let row = document.querySelector(".recent-contact-item");
        if (!row) {
          row = document.createElement("div");
          row.className = "recent-contact-item";
          document.querySelector(".recent-contact").append(row);
        }
        await new Promise((r) => setTimeout(r, 2300));
        const quiet = LiuliNotice.grew(); // a join request: nothing grew
        nav.querySelector(".q-badge-num").textContent = "3";
        const navGrew = LiuliNotice.grew();
        nav.querySelector(".q-badge-num").textContent = "2";
        const badge = document.createElement("span");
        badge.className = "q-badge-num";
        badge.textContent = "1";
        row.append(badge);
        const listGrew = LiuliNotice.grew();
        badge.remove();
        await new Promise((r) => setTimeout(r, 2300));
        // a member joined: the group's new item is a system notice
        const summary = row.querySelector('[class*="summary"]');
        const old = summary ? summary.textContent : "";
        if (summary) summary.textContent = "某某加入了本群";
        nav.querySelector(".q-badge-num").textContent = "3";
        row.append(badge);
        const joinTip = LiuliNotice.grew();
        badge.remove();
        if (summary) summary.textContent = old;
        nav.remove();
        return { quiet, navGrew, listGrew, joinTip, hasSummary: !!summary };
      });
      expect("notice.flash-only-for-new-messages", notice.quiet === false && notice.navGrew === true && notice.listGrew === true && notice.joinTip === false && notice.hasSummary, notice);
      // QQ's own telemetry warnings stay out of 「最近错误」; the theme's do not.
      const noise = await page.evaluate(() => {
        const before = window.LiuliDiag.getErrorCount();
        console.warn('[UniversalReport warn] Beacon report fail: [{"eventCode":"x"}]');
        console.warn("[theme] qa warning");
        const list = window.LiuliDiag.getErrors();
        return { added: window.LiuliDiag.getErrorCount() - before, last: list[list.length - 1]?.msg };
      });
      expect("diag.qq-telemetry-not-an-error", noise.added === 1 && /qa warning/.test(noise.last), noise);
      checks.probeBytes = probeText.length;

      // ── Idle and errors ──
      await page.waitForTimeout(700);
      checks.idle = await page.evaluate(() => ({
        runtime: window.__liuliRuntime.stats(),
        composer: LiuliComposer.state(),
      }));
      expect("idle.no-frame-queued", !checks.idle.runtime.frameQueued, checks.idle);
      expect("idle.header-floating", checks.idle.composer.header === "float", checks.idle);
      expect("page.no-errors", !errors.length, errors);
      results.push({ variant, checks, failures });
      failed += failures.length;
      await page.context().close();
    }

    // ── Header fallback: a build that does not size the column from its parent ──
    {
      const failures = [];
      const { page, errors } = await h.open({
        before: () => {
          const style = document.createElement("style");
          style.textContent = "#app .group-chat{margin-top:0!important;height:100%!important}";
          document.head.append(style);
        },
      });
      await page.evaluate(pageHelpers);
      await page.locator(".ProseMirror").first().click();
      await page.waitForTimeout(300);
      const s = await page.evaluate(() => ({
        mode: __qa.pane().dataset.liuliHeader,
        ...__qa.snapshot(),
      }));
      if (s.mode !== "flow") failures.push("fallback.mode: " + s.mode);
      if (s.region.y < s.header.b - 1) failures.push("fallback.viewport-under-header");
      if (Math.abs(s.region.b - (s.input.b + 14)) > 2) failures.push("fallback.bottom: " + JSON.stringify([s.region.b, s.input.b]));
      if (errors.length) failures.push("fallback.errors: " + errors.join("|"));
      results.push({ variant: "header-fallback", failures });
      failed += failures.length;
      await page.context().close();
    }

    // ── Opening a conversation: newest message above the editor ──
    // Ordinary top-to-bottom scroll container (the reversed list in the main
    // fixture hides this), with the client scrolling to the end BEFORE the
    // theme has seen the new list, and once more with a stale target after.
    {
      const failures = [];
      const { page, errors } = await h.open({
        before: () => {
          const style = document.createElement("style");
          style.textContent =
            ".ml-container{display:block!important}.ml-list{flex-direction:column!important}";
          document.head.append(style);
        },
      });
      await page.evaluate(pageHelpers);
      const state = () =>
        page.evaluate(() => {
          const scroller = __qa.q(".ml-container"),
            input = __qa.q(".chat-input-area").getBoundingClientRect(),
            newest = __qa.q(".ml-list > .ml-item:last-child .msg-content-container").getBoundingClientRect();
          return {
            clear: Math.round(input.top - newest.bottom),
            fromEnd: Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
            marked: scroller.hasAttribute("data-liuli-composer-scroll"),
          };
        });
      const openConversation = (stale) =>
        page.evaluate(async (stale) => {
          const old = __qa.q(".ml-container"),
            fresh = old.cloneNode(true);
          fresh.removeAttribute("data-liuli-composer-scroll");
          old.replaceWith(fresh);
          // the client's own "go to newest", before any theme pass
          fresh.scrollTop = fresh.scrollHeight;
          if (stale) {
            const target = fresh.scrollTop;
            setTimeout(() => (fresh.scrollTop = target), 120);
          }
          await new Promise((r) => setTimeout(r, 1100));
        }, stale);
      await openConversation(false);
      let s1 = await state();
      if (!(s1.marked && s1.clear >= 4 && s1.fromEnd <= 1)) failures.push("open.newest-above-editor: " + JSON.stringify(s1));
      await openConversation(true);
      let s2 = await state();
      if (!(s2.clear >= 4 && s2.fromEnd <= 1)) failures.push("open.stale-client-scroll-corrected: " + JSON.stringify(s2));
      // Growing the editor while at the end keeps the newest message visible.
      await page.locator(".ProseMirror").first().click();
      for (let i = 0; i < 4; i++) {
        await page.keyboard.type("行" + i);
        await page.keyboard.press("Shift+Enter");
      }
      await page.waitForTimeout(200);
      const s3 = await state();
      if (!(s3.clear >= 4)) failures.push("open.follows-growing-editor: " + JSON.stringify(s3));
      // A reader who scrolled away is left exactly where they are.
      await page.evaluate(() => (__qa.q(".ProseMirror").innerHTML = "<p><br></p>"));
      await page.waitForTimeout(150);
      const box = await page.evaluate(() => __qa.rect(__qa.q(".chat-msg-area")));
      await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(200);
      const before = await page.evaluate(() => __qa.q(".ml-container").scrollTop);
      await page.locator(".ProseMirror").first().click();
      for (let i = 0; i < 3; i++) {
        await page.keyboard.type("x");
        await page.keyboard.press("Shift+Enter");
      }
      await page.waitForTimeout(1000);
      const after = await page.evaluate(() => __qa.q(".ml-container").scrollTop);
      if (Math.abs(after - before) > 1) failures.push("open.reader-not-moved: " + JSON.stringify({ before, after }));
      if (errors.length) failures.push("open.errors: " + errors.join("|"));
      results.push({ variant: "opening-scroll", failures });
      failed += failures.length;
      await page.context().close();
    }

    // ── First start: the theme boots before QQ has rendered any message ──
    {
      const failures = [];
      const { page, context, errors } = await h.open({
        before: () => {
          const list = document.querySelector('.aio[data-fixture="group"] .ml-list');
          window.__rows = [...list.children];
          list.replaceChildren();
        },
      });
      await page.evaluate(pageHelpers);
      const r = await page.evaluate(async () => {
        const list = __qa.q(".ml-list");
        list.append(...window.__rows);
        const scroller = __qa.q(".ml-container");
        scroller.scrollTop = 0; // QQ shows the newest end (reversed list)
        await new Promise((res) => setTimeout(res, 600));
        const input = __qa.q(".chat-input-area").getBoundingClientRect();
        const newest = __qa.q(".ml-list > .ml-item:first-child .msg-content-container").getBoundingClientRect();
        return {
          marked: scroller.hasAttribute("data-liuli-composer-scroll"),
          regionMarked: __qa.q(".chat-msg-area").hasAttribute("data-liuli-composer-scroll"),
          clear: Math.round(input.top - newest.bottom),
          state: LiuliComposer.state(),
        };
      });
      if (!r.marked || r.regionMarked) failures.push("firststart.real-scroller: " + JSON.stringify(r));
      if (!(r.clear >= 4)) failures.push("firststart.newest-above-editor: " + JSON.stringify(r));
      if (errors.length) failures.push("firststart.errors: " + errors.join("|"));
      results.push({ variant: "first-start", failures });
      failed += failures.length;
      await context.close();
    }

    // ── Video wallpaper: main window (also with reduced motion), the settings
    // page, and a pooled standalone chat window (first frame only) ──
    const clip = fs.readFileSync(path.join(__dirname, "clip.webm")).toString("base64");
    const variants = [
      "main", "main-reduced-motion", "setting", "chat-window", "main-contain", "main-no-frame-callbacks",
      // QQ's main window does not draw what lies under .global-container
      // (user screenshots: desktop backdrop there). Two ways that can happen:
      "main-app-hidden", "main-container-outside-app",
      // QQ's colourful theme painting a picture over it from inside the
      // container: as a pseudo-element, and as an element without pointer events
      "main-colorful-pseudo", "main-colorful-element",
    ];
    for (const variant of variants) {
      const failures = [];
      const hash = variant === "setting" ? "#/setting/settings/common" : variant === "chat-window" ? "#/chat" : "#/main/message";
      // A compositor that never reports frames: drawing must fall back to
      // animation frames on its own.
      const before =
        variant === "main-no-frame-callbacks"
          ? () => {
              HTMLVideoElement.prototype.requestVideoFrameCallback = () => 1;
              HTMLVideoElement.prototype.cancelVideoFrameCallback = () => {};
            }
          : variant === "main-app-hidden"
            ? () => {
                const style = document.createElement("style");
                style.textContent = "#app{visibility:hidden}.global-container{visibility:visible}";
                document.head.append(style);
              }
            : variant === "main-colorful-pseudo"
              ? () => {
                  document.body.classList.add("is-colorful-theme");
                  const style = document.createElement("style");
                  style.textContent =
                    ".is-colorful-theme .global-container::before{content:'';position:absolute;inset:0;pointer-events:none;" +
                    "background:linear-gradient(135deg,#dfe8ff,#f2e9ff 60%,#ffe4ef)}";
                  document.head.append(style);
                }
            : variant === "main-colorful-element"
              ? () => {
                  const bg = document.createElement("div");
                  bg.className = "colorful-theme-bg";
                  bg.style.cssText =
                    "position:absolute;inset:0;pointer-events:none;background:linear-gradient(135deg,#dfe8ff,#f2e9ff)";
                  document.querySelector(".global-container").prepend(bg);
                }
            : variant === "main-container-outside-app"
              ? () => {
                  const app = document.getElementById("app");
                  app.after(document.querySelector(".global-container"));
                  const style = document.createElement("style");
                  style.textContent = "#app{opacity:0}";
                  document.head.append(style);
                }
              : null;
      const { page, context, errors } = await h.open({ hash, before });
      if (variant === "main-reduced-motion") await page.emulateMedia({ reducedMotion: "reduce" });
      const v = await page.evaluate(async ({ b64, fit, wait }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const res = await window.LiuliVideoWallpaper.importFile(new File([bytes], "clip.webm", { type: "video/webm" }));
        localStorage.setItem("liuli-dsh-wallpaper", JSON.stringify({ kind: "video", videoId: res.id, src: res.poster, fit }));
        window.dispatchEvent(new StorageEvent("storage", { key: "liuli-dsh-wallpaper" }));
        await new Promise((r) => setTimeout(r, wait));
        const video = document.getElementById("liuli-video-wallpaper");
        const layer = document.getElementById("liuli-video-layer");
        const canvas = document.getElementById("liuli-video-canvas");
        const r = layer?.getBoundingClientRect();
        const cr = canvas?.getBoundingClientRect();
        // what is on the canvas, twice, half a second apart
        const sample = () => {
          if (!canvas) return null;
          const c = canvas.getContext("2d");
          const d = c.getImageData(0, 0, canvas.width, canvas.height).data;
          let sum = 0, lit = 0;
          for (let i = 0; i < d.length; i += 4 * 97) {
            sum += d[i] + d[i + 1] + d[i + 2];
            if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
          }
          return { sum, lit };
        };
        const first = sample();
        await new Promise((r) => setTimeout(r, 500));
        const second = sample();
        const dpr = devicePixelRatio;
        return {
          playing: !!video && !video.paused && video.currentTime > 0,
          shown: document.body.hasAttribute("data-liuli-video-wallpaper"),
          covers: !!r && r.width >= innerWidth - 1 && r.height >= innerHeight - 1,
          canvas: !!canvas,
          canvasCovers: !!cr && cr.width >= innerWidth - 1 && cr.height >= innerHeight - 1,
          canvasSharp: !!canvas && Math.abs(canvas.width - Math.round(innerWidth * dpr)) <= 1,
          canvasAbove: !!canvas && !!video && video.compareDocumentPosition(canvas) === Node.DOCUMENT_POSITION_FOLLOWING && canvas.parentElement === video.parentElement,
          opaque: canvas ? canvas.getContext("2d").getContextAttributes().alpha === false : null,
          drawn: !!first && first.lit > 10,
          moving: !!first && !!second && first.sum !== second.sum,
          state: window.LiuliVideoWallpaper.state(),
          layerZ: layer ? getComputedStyle(layer).zIndex : null,
          appIsolated: getComputedStyle(document.getElementById("app")).isolation,
          container: document.querySelector(".global-container") ? getComputedStyle(document.querySelector(".global-container")).position : null,
          posterHidden: getComputedStyle(document.getElementById("app"), "::before").backgroundImage === "none",
          scope: document.body.dataset.liuliScope,
          beforeContainer: !!layer && layer.nextElementSibling === document.querySelector(".global-container"),
          covers: window.LiuliBackdrop.report(),
        };
      }, { b64: clip, fit: variant === "main-contain" ? "contain" : "cover", wait: variant === "main-no-frame-callbacks" ? 2600 : 1500 });
      // On screen: with the content hidden, the pixel in the middle of the
      // window is the canvas picture (under the light veil), not the base.
      if (variant !== "chat-window") {
        // content hidden, but not the container itself or a QQ background in it
        await page.addStyleTag({
          content:
            ".global-container > :not([data-liuli-cover]){visibility:hidden!important}" +
            "body:not([data-liuli-scope=main]) .global-container{visibility:hidden!important}" +
            "#liuli-video-layer::after{content:none!important}",
        });
        await page.waitForTimeout(120);
        const shot = (await page.screenshot({ clip: { x: 640, y: 430, width: 1, height: 1 } })).toString("base64");
        v.screen = await page.evaluate(async (b64) => {
          const img = new Image();
          img.src = "data:image/png;base64," + b64;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = c.height = 1;
          const x = c.getContext("2d");
          x.drawImage(img, 0, 0);
          const s = [...x.getImageData(0, 0, 1, 1).data].slice(0, 3);
          const cv = document.getElementById("liuli-video-canvas");
          const k = cv ? cv.width / innerWidth : 1;
          const p = cv ? [...cv.getContext("2d").getImageData(Math.round(640 * k), Math.round(430 * k), 1, 1).data].slice(0, 3) : null;
          return { screen: s, canvas: p };
        }, shot);
      }
      const want = (name, ok) => ok || failures.push(name + ": " + JSON.stringify(v));
      const close = (a, b) => !!a && !!b && a.every((x, i) => Math.abs(x - b[i]) <= 40);
      if (variant !== "chat-window")
        want("video.on-screen", close(v.screen?.screen, v.screen?.canvas) && v.screen.screen.reduce((a, b) => a + b, 0) < 700);
      if (variant === "chat-window") {
        want("video.pooled-window-keeps-first-frame", !v.playing && !v.canvas && !v.shown && !v.posterHidden);
      } else {
        want("video.playing", v.playing);
        want("video.layer-covers-window", v.shown && v.covers);
        // the picture is a canvas copy, not the <video> layer itself
        want("video.canvas-covers-window", v.canvas && v.canvasCovers && v.canvasSharp && v.canvasAbove);
        want("video.canvas-opaque", v.opaque === true);
        want("video.frames-drawn", v.drawn && v.state.painted);
        want("video.frames-keep-coming", v.moving);
        want("video.poster-dropped-only-when-shown", v.posterHidden === v.shown);
        if (variant === "main-no-frame-callbacks") want("video.falls-back-to-animation-frames", v.state.painting === "raf");
        if (variant === "setting") want("video.setting-behind-content", v.layerZ === "-2" && v.appIsolated === "isolate");
        else {
          want("video.native-container-position-kept", v.container === "fixed");
          want("video.main-layer-next-to-content", v.beforeContainer);
          // only the emulated QQ backgrounds are cleared, nothing else
          const expected = variant === "main-colorful-pseudo" ? "before" : variant === "main-colorful-element" ? "self" : null;
          want(
            "video.only-qq-backgrounds-cleared",
            expected
              ? v.covers.length === 1 && v.covers[0].marks.join() === expected
              : v.covers.length === 0,
          );
        }
      }
      if (errors.length) failures.push("video.errors: " + errors.join("|"));
      results.push({ variant: "video-wallpaper-" + variant, failures, v });
      failed += failures.length;
      await context.close();
    }

    // ── Auto-hiding action panel (the default) ──
    {
      const failures = [];
      const { page, context, errors } = await h.open({ settings: { autoHideActions: true } });
      await page.waitForTimeout(500);
      const state = () =>
        page.evaluate(() => {
          const a = document.querySelector(".aio > .chat-header .panel-header__action");
          const r = a.getBoundingClientRect();
          return { bottom: Math.round(r.bottom), opacity: getComputedStyle(a).opacity, pe: getComputedStyle(a).pointerEvents };
        });
      await page.mouse.move(640, 500);
      await page.waitForTimeout(700);
      const hidden = await state();
      // the parked panel is reached through the no-drag sensor where it rests
      // (the header band is a window-drag region on Windows)
      const band = await page.evaluate(() => {
        const s = document.getElementById("liuli-actions-sensor");
        const r = s?.getBoundingClientRect();
        return r && r.width ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), drag: getComputedStyle(s).webkitAppRegion || "" } : { x: -1, y: -1 };
      });
      await page.mouse.move(band.x, band.y);
      await page.waitForTimeout(400);
      const shown = await state();
      await page.mouse.move(640, 500);
      await page.waitForTimeout(800);
      const again = await state();
      // and once more: it must hide every time, not just the first
      await page.mouse.move(band.x, band.y);
      await page.waitForTimeout(400);
      const twice = await state();
      await page.mouse.move(640, 500);
      await page.waitForTimeout(800);
      const again2 = await state();
      if (!(band.x > 0 && hidden.bottom <= 0 && hidden.pe === "none" && shown.bottom > 30 && shown.opacity === "1" && shown.pe !== "none" && again.bottom <= 0 && twice.bottom > 30 && again2.bottom <= 0))
        failures.push("actions.autohide: " + JSON.stringify({ band, hidden, shown, again, twice, again2 }));
      if (errors.length) failures.push("actions.errors: " + errors.join("|"));
      results.push({ variant: "actions-autohide", failures });
      failed += failures.length;
      await context.close();
    }

    // ── Popup windows with QQ's acrylic: glass over what is behind ──
    for (const acrylic of [true, false]) {
      const failures = [];
      const { page, context, errors } = await h.open({
        width: 360,
        height: 420,
        hash: "#/mini-card/1",
        fixture: "qq-aux-fixture.html",
        before: acrylic ? () => document.body.classList.add("acrylic") : null,
      });
      await page.waitForTimeout(300);
      const p = await page.evaluate(() => {
        const app = document.getElementById("app");
        return {
          popup: document.body.hasAttribute("data-liuli-popup-window"),
          appBg: getComputedStyle(app).backgroundColor,
          wallpaper: getComputedStyle(app, "::before").content,
          sheet: getComputedStyle(app, "::after").content,
          bodyBg: getComputedStyle(document.body).backgroundColor,
        };
      });
      if (acrylic) {
        if (!(p.popup && p.appBg === "rgba(0, 0, 0, 0)" && p.wallpaper === "none" && p.sheet === "none" && p.bodyBg === "rgba(0, 0, 0, 0)"))
          failures.push("popup.acrylic-window-is-see-through: " + JSON.stringify(p));
      } else if (p.popup) failures.push("popup.only-with-acrylic: " + JSON.stringify(p));
      if (errors.length) failures.push("popup.errors: " + errors.join("|"));
      results.push({ variant: "popup-window" + (acrylic ? "-acrylic" : "-plain"), failures });
      failed += failures.length;
      await context.close();
    }

    // ── 6 (cont.) Standalone card window ──
    for (const dark of [false, true]) {
      const failures = [];
      const { page, errors } = await h.open({
        width: 360,
        height: 420,
        dark,
        hash: "#/mini-card/1",
        fixture: "qq-aux-fixture.html",
      });
      const s = await page.evaluate(() => {
        const css = (n, p) => getComputedStyle(n, p);
        const app = document.getElementById("app"),
          button = document.querySelector(".q-button--primary"),
          b = button.getBoundingClientRect();
        return {
          scope: document.body.dataset.liuliScope,
          sheet: css(app, "::after").content + "|" + css(app, "::after").backdropFilter,
          root: css(document.querySelector(".card-root")).backgroundColor,
          section: css(document.querySelector(".card-root__section")).backgroundColor,
          button: css(button).backgroundColor,
          placeholderPaint: css(document.querySelector(".mini-buddy"), "::before").content,
          placeholderSurface: document.querySelector(".mini-buddy").dataset.liuliSurface || "",
          hit: document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === button,
          fixed: css(document.querySelector(".fake-target-element")).position,
          owned: document.querySelectorAll("#liuli-nav-handle:not([style*='none']),.liuli-top-hint").length &&
            css(document.getElementById("liuli-nav-handle") || app).display,
        };
      });
      const want = (name, ok) => ok || failures.push(name + ": " + JSON.stringify(s));
      want("aux.scope", s.scope === "aux");
      want("aux.window-material", /^""\|.*blur/.test(s.sheet));
      want("aux.card-rows-flat", s.root === "rgba(0, 0, 0, 0)" && s.section === "rgba(0, 0, 0, 0)");
      want("aux.button-themed", s.button !== "rgb(0, 153, 255)");
      want("aux.placeholder-unpainted", s.placeholderPaint === "none" && !s.placeholderSurface);
      want("aux.card-clickable", s.hit);
      want("aux.native-positioning-kept", s.fixed === "fixed");
      if (errors.length) failures.push("aux.errors: " + errors.join("|"));
      await page.screenshot({ path: path.join(out, `accept-card-window-${dark ? "dark" : "light"}.png`) });
      results.push({ variant: "card-window-" + (dark ? "dark" : "light"), failures });
      failed += failures.length;
      await page.context().close();
    }
  } finally {
    await h.stop();
  }
  fs.writeFileSync(path.join(out, "acceptance.json"), JSON.stringify(results, null, 1));
  for (const r of results)
    console.log(
      (r.failures.length ? "FAIL " : "ok   ") +
        (typeof r.variant === "string" ? r.variant : `${r.variant.width}x${r.variant.height}@${r.variant.scale}${r.variant.dark ? " dark" : ""}`) +
        (r.failures.length ? "\n  - " + r.failures.join("\n  - ") : ""),
    );
  if (failed) {
    console.error(`acceptance: ${failed} failed check(s)`);
    process.exit(1);
  }
  console.log("acceptance: all checks passed (browser fixture, not the Windows client)");
}
run().catch((error) => {
  console.error(error);
  process.exit(1);
});
