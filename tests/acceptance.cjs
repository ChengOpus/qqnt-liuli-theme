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
      // Two interleaved runs per condition; the better run of each is
      // compared (min-of-N, so a stray GC or scheduler hiccup in this shared
      // container does not decide the result).
      const best = (a, b) => (a.slow + a.median / 100 <= b.slow + b.median / 100 ? a : b);
      const runs = { off: [], on: [] };
      for (let round = 0; round < 2; round++) {
        await page.emulateMedia({ reducedMotion: "reduce" });
        runs.off.push(await pace());
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.waitForTimeout(200);
        runs.on.push(await pace());
      }
      const paceOff = best(...runs.off),
        paceOn = best(...runs.on);
      checks.pacing = { effectsOff: paceOff, effectsOn: paceOn, runs };
      expect("fx.no-long-tasks-while-typing", runs.on.every((r) => r.long === 0), checks.pacing);
      // "slow" = a frame that took two vsync intervals. Two of ~110 is the
      // run-to-run noise of this environment with the effects off.
      expect(
        "fx.no-added-frame-cost",
        paceOn.slow <= paceOff.slow + 2 && paceOn.median <= paceOff.median + 1 && paceOn.max <= 50,
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
        };
        await __qa.frames(1);
        window.__cardRows = [mail, file, text];
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
      expect("arrival.received-glides", /px/.test(arrival.received.listShift) && arrival.received.bubble > 0 && arrival.received.pane, arrival);
      expect("arrival.sent-glides", /px/.test(arrival.sent.listShift) && arrival.sent.bubble > 0, arrival);
      expect("arrival.no-blur-while-moving", arrival.received.blur === "none", arrival);
      expect("arrival.blur-back-at-rest", arrival.rest !== "none" || variant.dark === undefined, arrival);
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
        __qa.q(".operation .send-msg").addEventListener("click", () => sent++);
        const opened = [];
        let panelEl = null;
        // QQ's behaviour: the icon toggles the panel.
        native.addEventListener("click", () => {
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
        editor.innerHTML = "<p><br></p>";
        panelEl.querySelector(".emoji-tile").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        const face = document.createElement("img");
        face.className = "face-element";
        editor.firstElementChild.append(face);
        await new Promise((r) => setTimeout(r, 120));
        const afterEmoji = sent;
        editor.innerHTML = "<p>写了一半</p>";
        panelEl.querySelector(".stickers-item img").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        editor.firstElementChild.append(img.cloneNode());
        await new Promise((r) => setTimeout(r, 120));
        const afterDraft = sent;
        // expanding "+" keeps both icons where they were
        document.getElementById("liuli-func-toggle").click();
        await __qa.frames(3);
        const er2 = emojiIcon.getBoundingClientRect();
        const expandedKept = Math.abs(er2.left - er.left) < 1.5 && Math.abs(er2.top - er.top) < 1.5;
        const gridHasEmoji = [...__qa.q(".chat-func-bar").querySelectorAll(".bar-icon")].filter((n) => !n.classList.contains("liuli-pinned") && getComputedStyle(n).display !== "none").some((n) => n.querySelector('[aria-label="表情"]'));
        LiuliComposer.expand(false);
        panelEl?.remove();
        editor.innerHTML = "<p><br></p>";
        return { placement, afterHover, afterClick, afterSticker, afterEmoji, afterDraft, expandedKept, gridHasEmoji };
      });
      checks.stickers = stickers;
      const P = stickers.placement;
      expect("toolbar.native-emoji-and-screenshot-beside-plus", P.sameRow && P.emojiGap >= 2 && P.emojiGap <= 6 && P.shotGap >= 2 && P.shotGap <= 6 && P.proxies === 1, stickers);
      expect("toolbar.rest-stay-in-plus-menu", P.othersHidden, stickers);
      expect("toolbar.icons-stay-while-plus-open", stickers.expandedKept && !stickers.gridHasEmoji, stickers);
      expect("sticker.hover-opens-sticker-tab", stickers.afterHover.open && stickers.afterHover.tab[0] === 2, stickers);
      expect("sticker.click-keeps-panel-open", stickers.afterClick.open && stickers.afterClick.nativeClicks === 1, stickers);
      expect("sticker.sends-at-once", stickers.afterSticker === 1, stickers);
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
    for (const variant of ["main", "main-reduced-motion", "setting", "chat-window", "main-contain", "main-no-frame-callbacks"]) {
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
        };
      }, { b64: clip, fit: variant === "main-contain" ? "contain" : "cover", wait: variant === "main-no-frame-callbacks" ? 2600 : 1500 });
      const want = (name, ok) => ok || failures.push(name + ": " + JSON.stringify(v));
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
        else want("video.native-container-position-kept", v.container === "fixed");
      }
      if (errors.length) failures.push("video.errors: " + errors.join("|"));
      results.push({ variant: "video-wallpaper-" + variant, failures, v });
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
