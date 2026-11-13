// Failure scenarios from 093557. This is an anonymous browser regression,
// NOT a dump of QQ's private DOM and NOT a Windows acceptance claim.
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const repo = path.resolve(process.argv[2] || path.join(__dirname, ".."));
(async () => {
  const resources = await require(path.join(repo, "resources.cjs"))(repo);
  const fixture = fs.readFileSync(path.join(__dirname, "qq-fixture.html"));
  const server = http.createServer((_q, r) => {
    r.setHeader("content-type", "text/html;charset=utf-8");
    r.end(fixture);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const results = [],
    out =
      process.env.LIULI_QA_OUT || path.join(__dirname, "..", "out", "ui-qa");
  fs.mkdirSync(out, { recursive: true });
  try {
    for (const [width, height, scale, dark] of [
      [1280, 860, 1, false],
      [1920, 1080, 1.25, true],
      [900, 680, 1.5, false],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: scale,
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `http://127.0.0.1:${server.address().port}/#/main/message`,
      );
      await page.evaluate((dark) => {
        document.body.setAttribute("q-theme", dark ? "dark" : "light");
        localStorage.setItem(
          "liuli-dsh-settings",
          JSON.stringify({ blur: 18, opacity: 0.15, pinGroup: true }),
        );
        localStorage.setItem(
          "liuli-layout",
          JSON.stringify({ barPinned: 0, edgeHints: true }),
        );
        // A short search wrapper can clip an absolute native popup. It is
        // precreated hidden, before theme boot, just like v-show cached UI.
        document.querySelector(".main-search").style.overflow = "hidden";
        document.querySelector(".recent-contact").style.overflow = "hidden";
        const result = document.createElement("div");
        result.className = "search-result";
        result.hidden = true;
        result.innerHTML =
          '<button class="search-result-item">匿名搜索结果</button>';
        document.querySelector(".main-search").append(result);
        window.__resultClicks = 0;
        result.firstElementChild.onclick = () => window.__resultClicks++;
        document.querySelector(".main-search input").onfocus = () =>
          (result.hidden = false);
        const bar = document.querySelector(".chat-func-bar");
        bar.innerHTML =
          '<div class="chat-func-bar__left"><div class="func-bar-native">' +
          ["表情", "截图", "文件", "图片", "红包", "语音", "翻译", "聊天记录"]
            .map(
              (label) =>
                '<div class="bar-icon"><button class="icon-item" aria-label="' +
                label +
                '"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor"/></svg></button>' +
                (label === "截图" || label === "文件"
                  ? '<div class="arrow" style="padding:4px;filter:drop-shadow(8px 8px 2px #555);min-width:20px"><i class="q-icon" style="transform:translate(8px,8px);background:#777"><svg viewBox="0 0 24 24"><path d="m5 8 7 7 7-7"/></svg></i></div>'
                  : "") +
                "</div>",
            )
            .join("") +
          "</div></div>";
        const nativeCSS = document.createElement("style");
        // Native reservation can be rewritten on focus; editor being absolute
        // alone does not make the message viewport cover its old flow slot.
        nativeCSS.textContent =
          ".group-chat{--inputAreaHeight:207px}.chat-msg-area{flex:none;height:calc(100% - var(--inputAreaHeight))}";
        document.head.append(nativeCSS);
        document.querySelector(".ProseMirror").addEventListener("focus", () => {
          const region = document.querySelector(".chat-msg-area");
          region.style.setProperty("--inputAreaHeight", "260px");
          region.style.height = "calc(100% - var(--inputAreaHeight))";
        });
      }, dark);
      await page.addScriptTag({
        content:
          "const bootstrap=" +
          JSON.stringify({
            token: "[qa]",
            assets: resources.assets,
            wallpaper: "",
            info: { versions: {} },
          }) +
          ";\n" +
          resources.source,
      });
      await page.evaluate(() => SnowLoraLiuli.ready);
      await page.waitForTimeout(300);
      const checks = {},
        failures = [];
      const check = (key, fn) => {
        try {
          fn();
        } catch (e) {
          failures.push(key + ": " + e.message);
        }
      };
      // Focus and actual browser wheel events while retaining native caret.
      await page.locator(".ProseMirror").click();
      await page.mouse.move(width / 2, height / 2);
      await page.mouse.wheel(0, 650);
      await page.waitForTimeout(200);
      checks.composer = await page.evaluate(() => {
        const host = document
          .querySelector("[data-liuli-composer-host]")
          .getBoundingClientRect();
        const region = document
          .querySelector(".chat-msg-area")
          .getBoundingClientRect();
        const area = document
          .querySelector(".chat-input-area")
          .getBoundingClientRect();
        return {
          regionGap: host.bottom - region.bottom,
          floatGap: host.bottom - area.bottom,
          overlap: region.bottom - area.top,
          focus: document.activeElement.matches(".ProseMirror"),
          filter: getComputedStyle(
            document.querySelector(".chat-input-area"),
            "::before",
          ).backdropFilter,
        };
      });
      check("focused composer", () => {
        assert.ok(checks.composer.regionGap < 1);
        assert.ok(checks.composer.overlap > 40);
        assert.ok(checks.composer.floatGap >= 10);
        assert.equal(checks.composer.focus, true);
      });
      // Search appears from hidden precreation, remains hittable and does not
      // conceal the native conversation list.
      await page.locator(".main-search input").focus();
      await page.waitForTimeout(120);
      checks.search = await page.locator(".search-result").evaluate((n) => {
        const button = n.firstElementChild,
          r = button.getBoundingClientRect();
        return {
          paint: getComputedStyle(n, "::before").backdropFilter,
          root: getComputedStyle(n).backdropFilter,
          hit: button.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          ),
          list: getComputedStyle(document.querySelector(".list-toggler"))
            .visibility,
        };
      });
      check("search", () => {
        assert.match(checks.search.paint, /blur\(18px\)/);
        assert.equal(checks.search.hit, true);
        assert.equal(checks.search.list, "visible");
      });
      if (checks.search.hit) await page.locator(".search-result-item").click();
      checks.search.clicks = await page.evaluate(() => window.__resultClicks);
      check("native search click", () => assert.equal(checks.search.clicks, 1));
      await page.screenshot({
        path: path.join(out, `transitions-search-${scale}.png`),
      });
      await page.evaluate(
        () => (document.querySelector(".search-result").hidden = true),
      );
      // The parent's filter must not turn the profile's fixed coordinates into
      // parent-relative coordinates (the same problem affects search portals).
      await page.evaluate(() => {
        const shell = document.createElement("div");
        shell.className = "q-float-card";
        shell.id = "profile-shell";
        shell.style.cssText =
          "position:absolute;left:90px;top:70px;width:0;height:0";
        shell.innerHTML =
          '<div class="mini-group" style="position:fixed;left:340px;top:90px;width:320px;height:310px;background:white;border:1px solid gray;padding:20px"><div class="group-profile-card" style="background:white"><div class="profile-row" style="background:#ddd">匿名群资料</div><div class="profile-row" style="background:#ddd;margin-top:20px">群介绍</div><button class="q-button" style="margin-top:50px;background:#09f">发消息</button></div></div>';
        document.body.append(shell);
      });
      await page.waitForTimeout(150);
      checks.profile = await page.locator(".mini-group").evaluate((n) => {
        const r = n.getBoundingClientRect(),
          owner = n.closest('[data-liuli-surface="profile"]') || n;
        return {
          left: r.left,
          top: r.top,
          ownerWidth: owner.getBoundingClientRect().width,
          filter: getComputedStyle(owner, "::before").backdropFilter,
          border: getComputedStyle(n).borderWidth,
          inner: getComputedStyle(n.querySelector(".profile-row"))
            .backgroundColor,
        };
      });
      check("profile owner and position", () => {
        assert.equal(checks.profile.left, 340);
        assert.equal(checks.profile.top, 90);
        assert.ok(checks.profile.ownerWidth >= 300);
        assert.match(checks.profile.filter, /blur\(18px\)/);
        assert.equal(checks.profile.inner, "rgba(0, 0, 0, 0)");
      });
      await page.evaluate(() => {
        const row = document.createElement("div");
        row.className = "late-detail";
        row.style.background = "#ddd";
        row.textContent = "延迟加载的匿名资料";
        document.querySelector(".group-profile-card").append(row);
      });
      await page.waitForTimeout(100);
      checks.lateProfile = await page
        .locator(".late-detail")
        .evaluate((n) => getComputedStyle(n).backgroundColor);
      check("late profile details", () =>
        assert.equal(checks.lateProfile, "rgba(0, 0, 0, 0)"),
      );
      await page.screenshot({
        path: path.join(out, `transitions-profile-${scale}.png`),
      });
      await page.evaluate(() =>
        document.querySelector("#profile-shell").remove(),
      );
      // Controls can open without moving the title; title/actions are two panes.
      await page.mouse.move(width / 2, 300);
      await page.waitForTimeout(750);
      const titleY = await page
        .locator(".panel-header__title")
        .evaluate((n) => n.getBoundingClientRect().y);
      // The earlier criterion asserted a 36px margin on the action panel. That
      // margin stretched the header and pushed the whole message viewport
      // down; the test passed while the defect shipped. What must hold is the
      // geometry the user sees: header and viewport do not move at all.
      const topGeometry = () =>
        page.evaluate(() => {
          const r = (s) => {
            const b = document.querySelector(s).getBoundingClientRect();
            return [b.top, b.height];
          };
          return {
            header: r(".chat-header"),
            region: r(".chat-msg-area"),
            actionY: r(".panel-header__action")[0],
          };
        });
      const topBefore = await topGeometry();
      await page.mouse.move(width - 20, 5);
      await page.waitForTimeout(300);
      const topAfter = await topGeometry();
      checks.top = await page.locator(".chat-header").evaluate((n) => {
        const title = n.querySelector(".panel-header__title"),
          action = n.querySelector(".panel-header__action"),
          controls = document
            .querySelector(".window-control-area")
            .getBoundingClientRect();
        return {
          titleY: title.getBoundingClientRect().y,
          titlePaint: getComputedStyle(title, "::before").backdropFilter,
          actionPaint: getComputedStyle(action, "::before").backdropFilter,
          margin: getComputedStyle(action).marginTop,
          clear: action.getBoundingClientRect().right <= controls.left + 0.5,
        };
      });
      checks.top.before = topBefore;
      checks.top.after = topAfter;
      check("independent header", () => {
        assert.equal(checks.top.titleY, titleY);
        assert.match(checks.top.titlePaint, /blur/);
        assert.match(checks.top.actionPaint, /blur/);
        assert.equal(checks.top.margin, "0px");
        assert.deepEqual(topAfter.header, topBefore.header);
        assert.deepEqual(topAfter.region, topBefore.region);
        assert.equal(topAfter.actionY, topBefore.actionY);
        assert.equal(checks.top.clear, true);
      });
      await page.screenshot({
        path: path.join(out, `transitions-top-${scale}.png`),
      });
      // Native header descendants must remain clickable above both the later
      // member panel and our floating composer, without changing fixed origin.
      checks.headerMenu = await page.evaluate(() => {
        const action = document.querySelector(".panel-header__action"),
          editor = document.querySelector(".chat-input-area"),
          side = document.querySelector(".group-box");
        const points = [editor, side].map((n) => {
          const r = n.getBoundingClientRect();
          return [r.left + r.width / 2, r.top + r.height / 2];
        });
        const menu = document.createElement("button");
        menu.textContent = "匿名标题菜单";
        menu.style.cssText =
          "position:fixed;width:32px;height:32px;z-index:4002";
        action.append(menu);
        const hits = points.map(([x, y]) => {
          menu.style.left = x - 16 + "px";
          menu.style.top = y - 16 + "px";
          return document.elementFromPoint(x, y) === menu;
        });
        menu.remove();
        return hits;
      });
      check("header menu layering", () =>
        assert.deepEqual(checks.headerMenu, [true, true]),
      );
      // Selection in an offscreen cached editor must not hide this editor.
      // The active editor's v-show toolbar must still enter and leave normally.
      checks.selection = await page.evaluate(() => {
        const active = document.querySelector("[data-liuli-composer]"),
          overlay = active.querySelector("#liuli-input-overlay"),
          cached = document.createElement("div");
        cached.className = "aio";
        cached.hidden = true;
        cached.innerHTML =
          '<div class="chat-input-area"><div class="msg-input"></div><div class="forward-ops">匿名转发</div></div>';
        document.body.append(cached);
        const otherHidden = getComputedStyle(overlay).display === "none";
        const ops = document.createElement("div");
        ops.className = "forward-ops";
        ops.textContent = "匿名转发";
        active.append(ops);
        const selected = getComputedStyle(overlay).display === "none";
        ops.style.display = "none";
        const restored = getComputedStyle(overlay).display !== "none";
        ops.remove();
        cached.remove();
        return { otherHidden, selected, restored };
      });
      check("local selection mode", () =>
        assert.deepEqual(checks.selection, {
          otherHidden: false,
          selected: true,
          restored: true,
        }),
      );
      await page.mouse.move(width / 2, 300);
      await page.waitForTimeout(750);
      await page.evaluate(() => LiuliComposer.expand(true));
      await page.waitForTimeout(220);
      checks.arrow = await page
        .locator('.bar-icon:has([aria-label="截图"])')
        .evaluate((n) => {
          const a = n.querySelector(".arrow"),
            i = a.querySelector("i"),
            r = a.getBoundingClientRect(),
            icon = i.getBoundingClientRect(),
            box = n.getBoundingClientRect();
          return {
            pinned: n.classList.contains("liuli-pinned"),
            width: r.width,
            height: r.height,
            right: box.right - r.right,
            bottom: box.bottom - r.bottom,
            aligned:
              Math.abs(r.x + r.width / 2 - icon.x - icon.width / 2) < 1 &&
              Math.abs(r.y + r.height / 2 - icon.y - icon.height / 2) < 1,
            shadow: getComputedStyle(a).boxShadow,
            filter: getComputedStyle(a).filter,
          };
        });
      check("arrow paint box", () => {
        assert.equal(checks.arrow.width, 14);
        assert.equal(checks.arrow.height, 14);
        // 截图 now sits beside "+" as a 28px round icon (moved out of the menu
        // on request); its arrow is a corner badge. Inside the grid it keeps
        // the author's 2px inset.
        const inset = checks.arrow.pinned ? -3 : 2;
        assert.equal(checks.arrow.right, inset);
        assert.equal(checks.arrow.bottom, inset);
        assert.equal(checks.arrow.aligned, true);
        assert.equal(checks.arrow.shadow, "none");
        assert.equal(checks.arrow.filter, "none");
      });
      await page.screenshot({
        path: path.join(out, `transitions-tools-${scale}.png`),
      });
      await page.evaluate(() => LiuliComposer.expand(false));
      checks.pin = await page
        .locator(".recent-contact-item--top")
        .first()
        .evaluate((n) => ({
          content: getComputedStyle(n, "::before").content,
          width: getComputedStyle(n, "::before").width,
          height: getComputedStyle(n, "::before").height,
        }));
      check("pin indicator", () => {
        assert.equal(checks.pin.content, '""');
        // A short row-local pill (20px, 28px when hovered/selected).
        assert.equal(checks.pin.width, "3px");
        assert.match(checks.pin.height, /^(20|28)px$/);
      });
      await page.locator(".recent-contact-item--top").nth(1).hover();
      checks.pin.hover = await page
        .locator(".recent-contact-item--top")
        .nth(1)
        .evaluate((n) => getComputedStyle(n, "::before").content);
      checks.pin.ordinary = await page
        .locator(".recent-contact-item:not(.recent-contact-item--top)")
        .first()
        .evaluate((n) => getComputedStyle(n, "::before").content);
      check("pin only on native pinned rows", () => {
        assert.equal(checks.pin.hover, '\"\"');
        assert.equal(checks.pin.ordinary, "none");
      });
      checks.sensor = await page
        .locator("#liuli-nav-handle")
        .evaluate((n) => getComputedStyle(n, "::after").content);
      check("no edge stripe", () => assert.equal(checks.sensor, "none"));
      await page.evaluate(() => __liuliPinGroups.apply({ group: false }));
      assert.equal(await page.locator("[data-liuli-pinned]").count(), 0);
      await page.evaluate(() => {
        const unrelated = document.createElement("section");
        unrelated.id = "unrelated";
        unrelated.style.cssText =
          "position:fixed;left:500px;top:100px;width:300px;height:220px;background:rgb(30, 40, 50)";
        unrelated.innerHTML = "<button>发消息</button>";
        document.body.append(unrelated);
      });
      await page.waitForTimeout(100);
      checks.unrelated = await page.locator("#unrelated").evaluate((n) => ({
        kind: n.dataset.liuliSurface,
        paint: getComputedStyle(n).backgroundColor,
      }));
      check("no profile guessing from text", () => {
        assert.equal(checks.unrelated.kind, undefined);
        assert.equal(checks.unrelated.paint, "rgb(30, 40, 50)");
      });
      await page.evaluate(() => document.querySelector("#unrelated").remove());
      // Reused popup shells must release material when QQ puts protected UI in them.
      await page.evaluate(() => {
        const popup = document.createElement("div");
        popup.id = "reuse";
        popup.className = "q-popup__main";
        popup.style.cssText =
          "position:fixed;left:350px;top:120px;width:300px;height:200px;background:rgb(12, 34, 56)";
        document.body.append(popup);
      });
      await page.waitForTimeout(100);
      await page.evaluate(
        () =>
          (document.querySelector("#reuse").innerHTML =
            '<div class="lucky-money-dialog">protected</div>'),
      );
      await page.waitForTimeout(100);
      checks.protected = await page.locator("#reuse").evaluate((n) => ({
        kind: n.dataset.liuliSurface,
        paint: getComputedStyle(n).backgroundColor,
      }));
      check("protected shell reuse", () => {
        assert.equal(checks.protected.kind, undefined);
        assert.equal(checks.protected.paint, "rgb(12, 34, 56)");
      });
      check("page errors", () => assert.deepEqual(errors, []));
      results.push({ width, height, scale, dark, checks, failures });
      await page.close();
    }
    fs.writeFileSync(
      path.join(out, "native-transitions.json"),
      JSON.stringify({ repo, results }, null, 2),
    );
    console.log(JSON.stringify({ repo, results }));
    assert.equal(
      results.flatMap((r) => r.failures).length,
      0,
      "See native-transitions.json for failing conditions",
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
