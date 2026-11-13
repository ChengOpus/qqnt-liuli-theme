// Lifecycle/geometry regression cases missing from the original single-pane fixture.
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
(async () => {
  const bundle = await require("../resources.cjs")(root),
    html = fs.readFileSync(path.join(__dirname, "qq-fixture.html"));
  const server = http.createServer((_q, r) => {
    r.setHeader("content-type", "text/html;charset=utf-8");
    r.end(html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const results = [];
  try {
    for (const scale of [1, 1.25, 1.5]) {
      const page = await browser.newPage({
          viewport: { width: 1180, height: 820 },
          deviceScaleFactor: scale,
        }),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `http://127.0.0.1:${server.address().port}/#/main/message`,
      );
      await page.evaluate(() => {
        localStorage.setItem(
          "liuli-dsh-settings",
          JSON.stringify({
            blur: 18,
            opacity: 0.15,
            chatStyle: "tg",
            pinGroup: true,
          }),
        );
        const original = document.querySelector(".aio");
        original.dataset.fixturePane = "original";
        const cached = original.cloneNode(true);
        cached.dataset.fixturePane = "cached";
        cached.querySelector(".panel-header__title").textContent =
          "另一个示例群聊";
        cached.style.display = "none";
        cached.setAttribute("aria-hidden", "true");
        original.parentElement.prepend(cached);
        document.querySelector(".container-sidebar").innerHTML =
          '<div class="sidebar-nav"><button class="nav-item" aria-label="消息">消息</button></div><div class="sidebar__menu"><button id="fixture-mail" class="func-menu__item" aria-label="邮箱">邮箱<span class="q-badge-dot" style="display:inline-block;width:7px;height:7px;border-radius:50%"></span></button></div>';
      });
      await page.addScriptTag({
        content:
          "const bootstrap=" +
          JSON.stringify({
            token: "[qa]",
            assets: bundle.assets,
            wallpaper: "",
            info: { versions: {} },
          }) +
          ";\n" +
          bundle.source,
      });
      await page.evaluate(() => window.SnowLoraLiuli.ready);
      await page.waitForTimeout(150);
      assert.equal(
        await page.evaluate(
          () => LiuliComposer.area().closest(".aio").dataset.fixturePane,
        ),
        "original",
        "hidden cached editors must not win document order",
      );
      // Native toolbar availability and click handlers remain authoritative.
      await page.evaluate(() => {
        LiuliComposer.bar().innerHTML =
          '<div class="chat-func-bar__left"><div class="func-bar-native"><div class="bar-icon"><button class="icon-item" aria-label="表情">表情</button></div><div class="bar-icon"><button class="icon-item" aria-label="文件">文件</button></div><div class="bar-icon" style="display: none"><button class="icon-item" aria-label="图片">图片</button></div></div></div>';
        window.__nativeEmojiClicks = 0;
        LiuliComposer.bar()
          .querySelector('[aria-label="表情"]')
          .addEventListener("click", () => window.__nativeEmojiClicks++);
      });
      await page.locator("#liuli-emoji-btn").click();
      assert.equal(await page.evaluate(() => window.__nativeEmojiClicks), 1);
      await page.evaluate(() => LiuliComposer.expand(true));
      assert.equal(
        await page
          .locator('.bar-icon[style*="display: none"]')
          .evaluate((n) => getComputedStyle(n).display),
        "none",
      );
      assert.equal(await page.locator("#liuli-bar-pins button").count(), 1);
      await page.evaluate(() => LiuliComposer.expand(false));
      // Same editor node moves under a new native wrapper after first initialization.
      await page.evaluate(() => {
        const area = LiuliComposer.area(),
          slot = document.createElement("div");
        slot.className = "native-editor-slot";
        slot.style.cssText = "position:relative;height:207px;flex:none";
        area.before(slot);
        slot.append(area);
      });
      await page.waitForFunction(
        () =>
          getComputedStyle(LiuliComposer.area().parentElement).display ===
          "contents",
      );
      assert.equal(
        await page.evaluate(
          () => getComputedStyle(LiuliComposer.area()).position,
        ),
        "absolute",
      );
      // Pool/cached-page switches update parent attributes without creating an editor.
      for (let turn = 0; turn < 12; turn++) {
        const active = turn % 2 ? "original" : "cached";
        await page.evaluate((name) => {
          for (const pane of document.querySelectorAll("[data-fixture-pane]")) {
            const on = pane.dataset.fixturePane === name;
            pane.style.display = on ? "flex" : "none";
            pane.setAttribute("aria-hidden", String(!on));
          }
        }, active);
        await page.waitForFunction(
          (name) =>
            window.LiuliComposer.area()?.closest(".aio").dataset.fixturePane ===
            name,
          active,
        );
        assert.equal(
          await page.evaluate(
            () => getComputedStyle(LiuliComposer.area()).position,
          ),
          "absolute",
        );
        assert.equal(await page.locator("#liuli-input-overlay").count(), 1);
      }
      await page.evaluate(() => {
        const node = LiuliComposer.area();
        node.removeAttribute("data-liuli-composer");
        node.querySelector(".ProseMirror").dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: "x",
          }),
        );
      });
      await page.waitForFunction(
        () => LiuliComposer.area()?.dataset.liuliComposer === "float",
      );
      const local = await page.evaluate(() => {
        const area = LiuliComposer.area(),
          r = area.getBoundingClientRect(),
          button = area.querySelector("#liuli-func-toggle"),
          b = button.getBoundingClientRect();
        return {
          parent: area.contains(button),
          left: b.left - r.left,
          bottom: r.bottom - b.bottom,
          shadow: getComputedStyle(button).boxShadow,
          alpha: getComputedStyle(document.body).getPropertyValue(
            "--ll-glass-alpha",
          ),
        };
      });
      assert.equal(local.parent, true);
      assert.equal(local.left, 8);
      assert.equal(local.bottom, 8);
      assert.equal(local.shadow, "none");
      // Navigation always has its own column; a focused mouse-clicked button must not latch it.
      for (let i = 0; i < 4; i++) {
        await page.mouse.move(1, 240);
        await page.waitForFunction(() => LiuliDock.state().nav);
        if (i === 0) {
          const samples = await page.evaluate(async () => {
            const frames = [];
            for (let n = 0; n < 8; n++) {
              await new Promise(requestAnimationFrame);
              const nav = document
                .querySelector(".container-sidebar")
                .getBoundingClientRect();
              const list = document
                .querySelector(".recent-contact")
                .getBoundingClientRect();
              frames.push({
                width: nav.width,
                right: nav.right,
                left: list.left,
              });
            }
            return frames;
          });
          assert.ok(
            samples.every((n) => n.right <= n.left + 0.5),
            "navigation has a real slot during the transition",
          );
        }
        await page.waitForFunction(() => !LiuliDock.moving());
        const bounds = await page.evaluate(() => {
          const a = document
              .querySelector(".container-sidebar")
              .getBoundingClientRect(),
            b = document
              .querySelector(".recent-contact")
              .getBoundingClientRect();
          return { right: a.right, list: b.left };
        });
        assert.ok(bounds.right <= bounds.list + 0.5, JSON.stringify(bounds));
        await page.locator("#fixture-mail").click();
        await page.mouse.move(500, 240);
        await page
          .waitForFunction(() => !LiuliDock.state().nav, {}, { timeout: 1800 })
          .catch(async (e) => {
            console.error(
              await page.evaluate(() => ({
                dock: LiuliDock.debug(),
                runtime: __liuliRuntime.stats(),
                height: LiuliComposer.area().getBoundingClientRect().height,
              })),
            );
            throw e;
          });
        assert.equal(
          await page.locator(".container-sidebar").evaluate((n) => n.inert),
          true,
        );
      }
      assert.equal(
        await page
          .locator(".q-badge-dot")
          .evaluate((n) => getComputedStyle(n).opacity),
        "1",
      );
      // Portaled children and an independent focused child keep only their owner open.
      await page.mouse.move(120, 90);
      await page.mouse.move(120, 4);
      await page.waitForFunction(() => LiuliDock.state().l);
      await page.evaluate(() => {
        const child = document.createElement("div");
        child.id = "fixture-child";
        child.className = "q-popup__main";
        child.style.cssText =
          "position:fixed;left:320px;top:160px;width:160px;height:120px";
        child.textContent = "原生子菜单";
        document.body.append(child);
      });
      await page.mouse.move(350, 200);
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => LiuliDock.state().l), true);
      await page.evaluate(() =>
        document.querySelector("#fixture-child").remove(),
      );
      await page.waitForFunction(() => !LiuliDock.state().l);
      await page.mouse.move(120, 4);
      await page.waitForFunction(() => LiuliDock.state().l);
      await page.evaluate(() => dispatchEvent(new Event("blur")));
      await page.mouse.move(500, 200);
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => LiuliDock.state().l), true);
      await page.evaluate(() => dispatchEvent(new Event("focus")));
      await page.waitForFunction(() => !LiuliDock.state().l);
      // Member search owns a full hit area, with no overlap from a long name/tag.
      const members = await page
        .locator("[data-liuli-composer-host]")
        .evaluate(() => {
          const gm = document.querySelector(
            '.aio:not([aria-hidden="true"]) .group-member',
          );
          const title = gm
            .querySelector(".group-member-title")
            .getBoundingClientRect();
          const search = gm
            .querySelector(".search-icon")
            .getBoundingClientRect();
          const name = gm
            .querySelector(".group-user__name")
            .getBoundingClientRect();
          const tag = gm.querySelector(".q-tag").getBoundingClientRect();
          return {
            button: search.width,
            right: title.right - search.right,
            gap: tag.left - name.right,
            tagBackground: getComputedStyle(gm.querySelector(".q-tag"))
              .backgroundColor,
          };
        });
      assert.ok(members.button >= 28 && members.right >= 4);
      assert.ok(members.gap >= -0.5);
      assert.equal(members.tagBackground, "rgba(0, 0, 0, 0)");
      // The native pinned heading can exist outside a viewport-list__inner wrapper.
      await page.evaluate(() => {
        document.querySelector(".viewport-list__inner").className =
          "qq-native-list";
        const heading = document.createElement("div");
        heading.className = "native-pin-heading";
        heading.textContent = "置顶";
        document.querySelector(".list-toggler").before(heading);
      });
      await page.waitForTimeout(80);
      const line = await page.locator(".native-pin-heading").evaluate((n) => ({
        text: n.textContent,
        image: getComputedStyle(n).backgroundImage,
        themed: n.hasAttribute("data-liuli-pin-heading"),
        injected: document.querySelectorAll(
          ".liuli-pin-label,[data-liuli-pin-last]",
        ).length,
      }));
      assert.equal(line.text, "置顶");
      assert.equal(line.image, "none");
      assert.equal(line.themed, false);
      assert.equal(line.injected, 0);
      // Search keeps the list visible, owns exactly one edge, and fits its column.
      await page.evaluate(() => {
        const shell = document.createElement("div");
        shell.className = "q-float-card";
        shell.innerHTML =
          '<div class="search-result"><div class="search-result__content" style="background:#eee"><div class="search-result-item">匿名最近搜索</div></div></div>';
        document.querySelector(".main-search").append(shell);
      });
      await page.waitForFunction(() =>
        document.querySelector('[data-liuli-surface="search"]'),
      );
      const search = await page.evaluate(() => {
        const node = document.querySelector(".search-result"),
          r = node.getBoundingClientRect(),
          pane = document
            .querySelector(".recent-contact")
            .getBoundingClientRect();
        return {
          width: r.width,
          pane: pane.width,
          visible: getComputedStyle(document.querySelector(".list-toggler"))
            .visibility,
          outer: getComputedStyle(node.parentElement).backdropFilter,
          inner: getComputedStyle(node.firstElementChild).backgroundColor,
        };
      });
      assert.ok(search.width <= search.pane);
      assert.equal(search.visible, "visible");
      assert.equal(search.outer, "none");
      assert.equal(search.inner, "rgba(0, 0, 0, 0)");
      await page.evaluate(() =>
        document.querySelector(".main-search .q-float-card").remove(),
      );
      // Author-supported member profile card shares the same material as group details.
      await page.evaluate(() => {
        const card = document.createElement("section");
        card.className = "group-member-card";
        card.style.cssText =
          "position:fixed;left:330px;top:90px;width:330px;height:260px;background:#dfe6ee;border:1px solid #aab";
        card.innerHTML =
          '<div class="native-info-body" style="background:#dfe6ee;height:200px">群资料</div><button style="background:#0099ff">发消息</button>';
        document.body.append(card);
      });
      await page.waitForFunction(
        () =>
          document.querySelector(".group-member-card").dataset
            .liuliSurface === "profile",
      );
      assert.equal(
        await page
          .locator(".native-info-body")
          .evaluate((n) => getComputedStyle(n).backgroundColor),
        "rgba(0, 0, 0, 0)",
      );
      await page.evaluate(() =>
        document.querySelector(".group-member-card").remove(),
      );
      // Native protected popup descendants never become a material owner.
      await page.evaluate(() => {
        const node = document.createElement("div");
        node.className = "q-dialog q-popup__main";
        node.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
        node.id = "protected";
        node.innerHTML = '<div class="lucky-money-dialog"></div>';
        document.body.append(node);
      });
      await page.waitForTimeout(80);
      assert.equal(
        await page.locator("#protected").getAttribute("data-liuli-surface"),
        null,
      );
      assert.equal(
        await page
          .locator("#protected")
          .evaluate((n) => getComputedStyle(n).backgroundColor),
        "rgba(0, 0, 0, 0.5)",
      );
      await page.locator("#protected").evaluate((n) => n.remove());
      // Author layout.css:1525: a zero-sized native shell must anchor its
      // fixed inner menu; global viewport coordinates were the wrong contract.
      await page.evaluate(() => {
        const child = document.createElement("div");
        child.className =
          "native-fixed-tool-submenu bar-more-menu-inner q-context-menu";
        const shell = document.createElement("div");
        shell.className = "bar-more-menu";
        shell.style.cssText =
          "position:absolute;left:38px;top:-18px;width:0;height:0";
        child.style.cssText =
          "position:fixed;left:0;top:0;width:100px;height:80px";
        shell.append(child);
        LiuliComposer.bar().append(shell);
        LiuliComposer.expand(true);
      });
      const tool = await page.evaluate(() => {
        const bar = LiuliComposer.bar(),
          rect = bar
            .querySelector(".native-fixed-tool-submenu")
            .getBoundingClientRect();
        return {
          filter: getComputedStyle(bar).backdropFilter,
          pseudo: getComputedStyle(bar, "::before").backdropFilter,
          left: rect.left,
          top: rect.top,
          shellLeft: bar.querySelector(".bar-more-menu").getBoundingClientRect()
            .left,
          shellTop: bar.querySelector(".bar-more-menu").getBoundingClientRect()
            .top,
          columns: getComputedStyle(bar).gridTemplateColumns,
          wrappers: [
            ...bar.querySelectorAll(".chat-func-bar__left,.func-bar-native"),
          ].map((n) => getComputedStyle(n).display),
        };
      });
      assert.equal(tool.filter, "none");
      assert.match(tool.pseudo, /blur\(18px\)/);
      assert.ok(Math.abs(tool.left - (tool.shellLeft - 29)) < 0.5);
      assert.ok(Math.abs(tool.top - (tool.shellTop - 10)) < 0.5);
      assert.equal(tool.columns, "38px 38px 38px 38px");
      assert.ok(tool.wrappers.every((value) => value === "contents"));
      await page.evaluate(() => {
        LiuliComposer.bar().querySelector(".bar-more-menu").remove();
        LiuliComposer.expand(false);
      });
      // Input/delete feedback animates a marker, not the editable text or caret.
      const editor = page.locator('[data-liuli-composer="float"] .ProseMirror');
      await editor.fill("测试输入");
      await editor.dispatchEvent("compositionend", { data: "输入" });
      await page.keyboard.press("Backspace");
      await page.waitForFunction(
        () =>
          LiuliComposer.area().querySelector(".liuli-edit-feedback")?.dataset
            .edit === "delete",
      );
      assert.equal(
        await editor.evaluate((n) => getComputedStyle(n).transform),
        "none",
      );
      assert.equal(
        await editor.evaluate((n) => getComputedStyle(n).textShadow),
        "none",
      );
      const text = (await editor.textContent()).trim();
      assert.equal(text, "测试输");
      await page.evaluate(() => {
        const img = document.createElement("img");
        img.className = "image-element";
        img.style.cssText = "width:40px;height:40px";
        img.src =
          'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Crect width="40" height="40" fill="pink"/%3E%3C/svg%3E';
        LiuliComposer.area().querySelector(".msg-input").append(img);
      });
      await page.waitForFunction(
        () =>
          LiuliComposer.area().querySelector(".image-element").getAnimations()
            .length > 0,
      );
      await page.waitForTimeout(400);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(() => {
        const img = document.createElement("img");
        img.className = "reduced-attachment";
        img.style.cssText = "width:20px;height:20px";
        LiuliComposer.area().querySelector(".msg-input").append(img);
      });
      await page.waitForTimeout(150);
      assert.equal(
        await page
          .locator(".reduced-attachment")
          .evaluate((n) => n.getAnimations().length),
        0,
      );
      const idle = await page.evaluate(() => __liuliRuntime.stats());
      assert.equal(idle.frameQueued, false);
      assert.equal(idle.pending, 0);
      assert.deepEqual(errors, []);
      results.push({
        scale,
        cachedSwitches: 12,
        navCycles: 4,
        local,
        line,
        search,
        members,
        tool,
        idle,
        errors,
      });
      if (scale === 1) {
        fs.mkdirSync(path.join(root, "out", "ui-qa"), { recursive: true });
        await page.screenshot({
          path: path.join(root, "out", "ui-qa", "lifecycle.png"),
        });
      }
      await page.close();
    }
    console.log(JSON.stringify({ passed: results.length, results }));
    fs.writeFileSync(
      path.join(root, "out", "ui-qa", "lifecycle-results.json"),
      JSON.stringify(results, null, 2),
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
