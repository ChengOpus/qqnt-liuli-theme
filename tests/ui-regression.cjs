// Full renderer boot against anonymous QQ-shaped DOM. Requires Playwright and
// Chromium (CHROMIUM_PATH may override the executable). No QQ account/data.
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright");
const repo = path.resolve(__dirname, ".."),
  out = process.env.LIULI_QA_OUT || path.join(repo, "out", "ui-qa");
fs.mkdirSync(out, { recursive: true });
const readResources = require("../resources.cjs");
(async () => {
  const bundle = await readResources(repo),
    fixture = fs.readFileSync(path.join(__dirname, "qq-fixture.html"));
  const server = http.createServer((_q, r) => {
    r.setHeader("content-type", "text/html;charset=utf-8");
    r.end(fixture);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const results = [];
  try {
    for (const variant of [
      { width: 1280, height: 860, scale: 1, dark: false },
      { width: 1920, height: 1080, scale: 1.25, dark: true },
      { width: 900, height: 680, scale: 1.5, dark: false },
    ]) {
      const context = await browser.newContext({
        viewport: { width: variant.width, height: variant.height },
        deviceScaleFactor: variant.scale,
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (msg) => {
        if (msg.type() === "debug" && msg.text().startsWith("[qa-host]")) {
          let req;
          try {
            req = JSON.parse(msg.text().slice(9));
          } catch {
            return;
          }
          if (req.id)
            page
              .evaluate((r) => window.LiuliHost?.reply(r.id, "", null), req)
              .catch(() => {});
        }
      });
      await page.goto(
        `http://127.0.0.1:${server.address().port}/#/main/message`,
      );
      await page.evaluate((v) => {
        localStorage.setItem(
          "liuli-dsh-settings",
          JSON.stringify({
            blur: 18,
            opacity: 0.15,
            chatStyle: "tg",
            pinGroup: true,
            pinColor: false,
          }),
        );
        localStorage.setItem(
          "liuli-color-source",
          JSON.stringify({ mode: "manual", hex: "#cba6f7", exact: true }),
        );
        document.body.setAttribute("q-theme", v.dark ? "dark" : "light");
        if (v.scale === 1.25)
          localStorage.setItem(
            "liuli-color-roles",
            JSON.stringify({
              accent: "secondary",
              selected: "tertiary",
              self: "tertiary",
              others: "surface",
            }),
          );
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 860;
        const ctx = canvas.getContext("2d");
        const gradient = ctx.createLinearGradient(0, 0, 1280, 860);
        gradient.addColorStop(0, v.dark ? "#192536" : "#f9e7f1");
        gradient.addColorStop(0.5, v.dark ? "#29364f" : "#e2ecff");
        gradient.addColorStop(1, v.dark ? "#3a2846" : "#c1e7f5");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1280, 860);
        for (let x = 250; x < 1100; x += 48) {
          ctx.fillStyle = x % 96 === 0 ? "#dbaeb433" : "#a7c2e833";
          ctx.fillRect(x, 620, 24, 240);
        }
        localStorage.setItem(
          "liuli-dsh-wallpaper",
          JSON.stringify({ src: canvas.toDataURL(), fit: "cover" }),
        );
      }, variant);
      await page.addScriptTag({
        content:
          "const bootstrap=" +
          JSON.stringify({
            token: "[qa-host]",
            assets: bundle.assets,
            wallpaper: "",
            info: { versions: {} },
          }) +
          ";\n" +
          bundle.source,
      });
      await page.evaluate(() => window.SnowLoraLiuli.ready);
      await page.waitForTimeout(300);
      const result = { variant };
      const measure = () =>
        page.evaluate(() => {
          const rect = (s) => {
            const r = document.querySelector(s).getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom };
          };
          return {
            aside: rect(".two-col-layout__aside"),
            main: rect(".two-col-layout__main"),
            composer: rect(".chat-input-area"),
            host: rect("[data-liuli-composer-host]"),
            message: rect(".chat-msg-area"),
            position: getComputedStyle(
              document.querySelector(".chat-input-area"),
            ).position,
          };
        });
      const base = await measure();
      await page
        .locator(".chat-msg-area__vlist")
        .evaluate((n) => (n.scrollTop = n.scrollHeight));
      await page.waitForTimeout(100);
      const latest = await page.locator(".ml-item").last().boundingBox();
      assert.ok(
        latest.y + latest.height <= base.composer.y - 5,
        "latest message is reachable above the input",
      );
      assert.equal(base.position, "absolute");
      assert.ok(base.host.b - base.composer.b >= 9);
      assert.ok(
        base.message.b > base.composer.y + 20,
        "messages extend behind the floating composer",
      );
      result.composer = base;
      await page.mouse.move(120, 90);
      await page.waitForTimeout(20);
      await page.mouse.move(120, 5);
      await page.waitForTimeout(320);
      const left = await measure();
      assert.equal(left.main.y, base.main.y, "left reveal must not lower chat");
      assert.equal(left.aside.y, base.aside.y); // padding, not the column box, reserves space.
      result.leftReveal = await page.evaluate(() => ({
        left: document.body.hasAttribute("data-liuli-r-l"),
        right: document.body.hasAttribute("data-liuli-r-r"),
        asidePad: getComputedStyle(
          document.querySelector(".two-col-layout__aside"),
        ).paddingTop,
        mainPad: getComputedStyle(
          document.querySelector(".two-col-layout__main"),
        ).paddingTop,
      }));
      assert.equal(result.leftReveal.left, true);
      assert.equal(result.leftReveal.mainPad, "0px");
      assert.equal(result.leftReveal.asidePad, "36px");
      await page.mouse.move(600, 150);
      await page.waitForTimeout(750);
      await page.mouse.move(variant.width - 20, 15);
      await page.waitForTimeout(90);
      result.rightReveal = await page.evaluate(() => ({
        right: document.body.hasAttribute("data-liuli-r-r"),
        asidePad: getComputedStyle(
          document.querySelector(".two-col-layout__aside"),
        ).paddingTop,
        mainPad: getComputedStyle(
          document.querySelector(".two-col-layout__main"),
        ).paddingTop,
      }));
      assert.equal(result.rightReveal.right, true);
      assert.equal(result.rightReveal.asidePad, "0px");
      assert.equal(result.rightReveal.mainPad, "36px");
      await page.mouse.move(600, 160);
      await page.waitForTimeout(750);
      result.pin = await page.evaluate(async () => {
        const row = document.querySelectorAll(".recent-contact-item--top")[1];
        window.__liuliPinGroups.apply({ group: false, color: false });
        await new Promise((r) => setTimeout(r, 220));
        const off = getComputedStyle(row).backgroundColor;
        window.__liuliPinGroups.apply({ group: true, color: false });
        await new Promise((r) => setTimeout(r, 220));
        const on = getComputedStyle(row).backgroundColor;
        const labelOn = !!document.querySelector(".liuli-pin-label");
        window.__liuliPinGroups.apply({ group: true, color: true });
        await new Promise((r) => setTimeout(r, 220));
        const color = getComputedStyle(row).backgroundColor;
        return {
          off,
          on,
          color,
          labelOn,
          value: document.body.getAttribute("data-liuli-pin-group"),
          label: document.querySelector(".liuli-pin-label")?.textContent,
          buttons: document.querySelectorAll(".liuli-pin-label button").length,
        };
      });
      assert.equal(result.pin.value, "1");
      assert.equal(result.pin.labelOn, true);
      assert.notEqual(result.pin.on, result.pin.color);
      assert.equal(result.pin.label, "置顶");
      assert.equal(result.pin.buttons, 0);
      await page.evaluate(() =>
        window.__liuliPinGroups.apply({ group: true, color: false }),
      );
      await page.waitForTimeout(220);
      await page.evaluate(() => {
        const panel = document.createElement("div");
        panel.className = "search-result";
        panel.innerHTML =
          '<div class="search-result-item">最近搜索 · 示例联系人</div><div class="search-result-item">示例群聊</div>';
        document.querySelector(".main-search").append(panel);
      });
      await page.waitForTimeout(300);
      result.search = await page.evaluate(() => ({
        surface: document.querySelector(".search-result").dataset.liuliSurface,
        filter: getComputedStyle(document.querySelector(".search-result"))
          .backdropFilter,
        list: getComputedStyle(document.querySelector(".list-toggler"))
          .visibility,
      }));
      assert.equal(result.search.surface, "search");
      assert.match(result.search.filter, /blur\(18px\)/);
      assert.equal(result.search.list, "hidden");
      if (variant.scale === 1)
        await page.screenshot({ path: path.join(out, "search.png") });
      await page.evaluate(
        () => (document.querySelector(".search-result").style.display = "none"),
      );
      await page.waitForTimeout(100);
      assert.equal(
        await page
          .locator(".list-toggler")
          .evaluate((n) => getComputedStyle(n).visibility),
        "visible",
      );
      await page.evaluate(() => {
        const modal = document.createElement("div");
        modal.className = "q-dialog";
        modal.innerHTML =
          '<div class="q-dialog-modal"></div><div class="q-dialog-main"><div class="test-pattern"></div><h3>创建群聊</h3><p>匿名联系人列表</p></div>';
        document.body.append(modal);
      });
      await page.waitForTimeout(300);
      result.modal = await page
        .locator(".q-dialog-modal")
        .evaluate((n) => getComputedStyle(n).backgroundColor);
      assert.equal(result.modal, "rgba(0, 0, 0, 0)");
      assert.match(
        await page
          .locator(".q-dialog-main")
          .evaluate((n) => getComputedStyle(n).backdropFilter),
        /blur\(18px\)/,
      );
      assert.notEqual(
        await page
          .locator(".q-dialog-main")
          .evaluate((n) => getComputedStyle(n).backgroundColor),
        "rgba(0, 0, 0, 0)",
      );
      if (variant.scale === 1)
        await page.screenshot({ path: path.join(out, "create-group.png") });
      await page.evaluate(() => document.querySelector(".q-dialog").remove());
      await page.evaluate(() => {
        const profile = document.createElement("div");
        profile.className = "group-info";
        profile.innerHTML =
          '<h2>示例群信息</h2><div class="group-info__content"><p>群介绍与群公告</p><div class="native-profile-tags"><span class="q-tag">游戏</span><span class="q-tag">服务器</span></div><p>备注　设置群聊备注</p></div><button class="q-button--primary">发消息</button>';
        document.body.append(profile);
      });
      await page.waitForTimeout(300);
      result.profile = await page.locator(".group-info").evaluate((n) => ({
        kind: n.dataset.liuliSurface,
        filter: getComputedStyle(n).backdropFilter,
        border: getComputedStyle(n).borderWidth,
        inner: getComputedStyle(n.querySelector(".group-info__content"))
          .backgroundColor,
      }));
      assert.equal(result.profile.kind, "profile");
      assert.match(result.profile.filter, /blur\(18px\)/);
      assert.equal(result.profile.inner, "rgba(0, 0, 0, 0)");
      if (variant.scale === 1)
        await page.screenshot({ path: path.join(out, "profile.png") });
      await page.evaluate(() => document.querySelector(".group-info").remove());
      await page.evaluate(() => window.SnowLoraLiuli.open());
      await page.locator('.liuli-tabs button[data-tab="color"]').click();
      assert.equal(await page.locator('input[type="color"]').count(), 0);
      assert.equal(
        await page.locator(".liuli-roles .liuli-seg__item").count(),
        0,
      );
      await page
        .locator('.liuli-color-role[data-slot="accent"] .liuli-color-button')
        .click();
      assert.equal(
        await page.locator(".liuli-picker__presets button").count(),
        6,
      );
      await page.waitForTimeout(240);
      if (variant.scale === 1)
        await page.screenshot({ path: path.join(out, "palette.png") });
      const hex = page.locator('.liuli-picker input[aria-label="HEX 颜色"]');
      await hex.fill("#89b4fa");
      await hex.press("Tab");
      await page.locator(".liuli-picker__actions .is-primary").click();
      await page.waitForTimeout(180);
      result.custom = await page.evaluate(() => ({
        saved: JSON.parse(localStorage.getItem("liuli-color-roles")).custom
          .accent,
        brand: getComputedStyle(document.body)
          .getPropertyValue("--ll-brand")
          .trim(),
      }));
      assert.equal(result.custom.saved, "#89b4fa");
      assert.equal(result.custom.brand, "#89b4fa");
      await page
        .locator('.liuli-color-role[data-slot="others"] .liuli-color-button')
        .click();
      await page.keyboard.press("Escape");
      await page
        .locator(".liuli-picker")
        .waitFor({ state: "detached", timeout: 2000 });
      assert.equal(await page.locator(".liuli-picker").count(), 0);
      assert.equal(
        await page.locator("#liuli-settings-dialog").evaluate((n) => n.open),
        true,
      );
      if (variant.scale === 1)
        await page.screenshot({ path: path.join(out, "colors.png") });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);
      // Exercise the real settings slider event rather than assigning its CSS token.
      for (const radius of [0, 18]) {
        await page.evaluate(() => window.SnowLoraLiuli.open());
        await page.locator('.liuli-tabs button[data-tab="look"]').click();
        await page
          .locator('.liuli-tabpage[data-tab="look"] input[type="range"]')
          .first()
          .evaluate((n, value) => {
            n.value = String(value);
            n.dispatchEvent(new Event("input", { bubbles: true }));
          }, radius);
        await page.waitForTimeout(100);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(80);
        const actual = await page
          .locator(".chat-input-area")
          .evaluate((n) => getComputedStyle(n, "::before").backdropFilter);
        assert.equal(
          radius === 0 ? actual === "none" : actual.includes("blur(18px)"),
          true,
        );
        if (variant.scale === 1)
          await page.screenshot({
            path: path.join(out, "composer-blur-" + radius + ".png"),
            clip: {
              x: base.composer.x,
              y: base.composer.y,
              width: base.composer.w,
              height: base.composer.h,
            },
          });
      }
      const editor = page.locator(".ProseMirror");
      await editor.fill("输入与文件工具保持可操作");
      assert.equal(
        (await editor.textContent()).trim(),
        "输入与文件工具保持可操作",
      );
      result.errors = errors;
      assert.deepEqual(errors, []);
      results.push(result);
      await context.close();
    }
    const aux = await browser.newPage({
      viewport: { width: 620, height: 680 },
    });
    await aux.goto(`http://127.0.0.1:${server.address().port}/#/groupProfile`);
    await aux.evaluate(() => {
      document.querySelector("#app").innerHTML =
        '<section class="native-profile-root"><h2>匿名群资料</h2><p>独立资料页面</p></section>';
    });
    await aux.addScriptTag({
      content:
        "const bootstrap=" +
        JSON.stringify({
          token: "[qa-host]",
          assets: bundle.assets,
          wallpaper: "",
          info: { versions: {} },
        }) +
        ";\n" +
        bundle.source,
    });
    await aux.evaluate(() => window.SnowLoraLiuli.ready);
    await aux.waitForTimeout(150);
    assert.equal(
      await aux
        .locator(".native-profile-root")
        .getAttribute("data-liuli-surface"),
      "profile",
    );
    assert.equal(
      await aux
        .locator("#app")
        .evaluate((n) => getComputedStyle(n, "::after").content),
      "none",
    );
    await aux.close();
    fs.writeFileSync(
      path.join(out, "results.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(
      JSON.stringify({ passed: results.length, output: out, results }),
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
