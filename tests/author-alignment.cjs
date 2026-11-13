// Compare native-structure CSS contracts with an actual author checkout.
// This is an anonymous browser fixture, not a Windows QQ runtime or DOM capture.
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "..");
const author = process.argv[2] && path.resolve(process.argv[2]);
if (!author)
  throw Error("Pass the author SnowLora checkout path as the first argument");

(async () => {
  const reference = execFileSync("git", ["-C", author, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const fixture = fs.readFileSync(path.join(__dirname, "qq-fixture.html"));
  const bundle = await require("../resources.cjs")(root);
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html;charset=utf-8");
    res.end(fixture);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const snapshots = [];
  fs.mkdirSync(path.join(root, "out", "ui-qa"), { recursive: true });
  try {
    for (const kind of ["author", "working"]) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 860 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `http://127.0.0.1:${server.address().port}/#/main/message`,
      );
      await page.evaluate(() => {
        localStorage.setItem(
          "liuli-layout",
          JSON.stringify({ barPinned: 0, edgeHints: false }),
        );
        localStorage.setItem(
          "liuli-dsh-settings",
          JSON.stringify({ blur: 18, opacity: 0.15, pinGroup: true }),
        );
        const shell = document.querySelector("#app");
        for (let i = 0; i < 2; i++) {
          const drag = document.createElement("div");
          drag.className = "draggable-view";
          drag.style.cssText =
            "position:fixed;top:0;left:0;pointer-events:none;" +
            (i ? "width:52px;height:100%" : "height:40px;width:100%");
          shell.insertBefore(drag, shell.querySelector(".global-container"));
        }
        const bar = document.querySelector(".chat-func-bar");
        const labels = [
          "表情",
          "截图",
          "文件",
          "图片",
          "红包",
          "语音",
          "翻译",
          "聊天记录",
        ];
        bar.innerHTML =
          '<div class="chat-func-bar__left"><div class="func-bar-native">' +
          labels
            .map(
              (label) =>
                '<div class="bar-icon"><button class="icon-item" aria-label="' +
                label +
                '"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg></button>' +
                (label === "截图"
                  ? '<div class="arrow"><svg viewBox="0 0 24 24"><path d="m5 8 7 7 7-7"/></svg></div><div class="bar-more-menu" style="position:absolute;left:29px;top:-18px;width:0;height:0"><div class="bar-more-menu-inner q-context-menu" style="position:fixed;left:0;top:0;width:150px;height:90px">原生截图子菜单</div></div>'
                  : "") +
                "</div>",
            )
            .join("") +
          "</div></div>";
      });
      if (kind === "author") {
        for (const file of [
          "liuli.css",
          "typography.css",
          "no-dividers.css",
          "input-bar.css",
          "layout.css",
          "layout-custom.css",
        ])
          await page.addStyleTag({ path: path.join(author, "assets", file) });
        await page.evaluate(() => {
          Object.assign(document.body.dataset, {
            liuliScope: "main",
            liuliRL: "1",
            liuliTb: "float",
            liuliHideEdgeHints: "",
          });
          const sensor = document.createElement("div");
          sensor.id = "liuli-nav-handle";
          sensor.innerHTML =
            '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
          document.body.append(sensor);
          for (const suffix of ["l", "r"]) {
            const hint = document.createElement("div");
            hint.id = "liuli-top-hint-" + suffix;
            hint.className = "liuli-top-hint";
            document.body.append(hint);
          }
          document
            .querySelector(".chat-func-bar")
            .classList.add("liuli-expanded");
        });
      } else {
        await page.addScriptTag({
          content:
            "const bootstrap=" +
            JSON.stringify({
              token: "[qa-alignment]",
              assets: bundle.assets,
              wallpaper: "",
              info: { versions: {} },
            }) +
            ";\n" +
            bundle.source,
        });
        await page.evaluate(() => window.SnowLoraLiuli.ready);
        await page.mouse.move(120, 20);
        await page.waitForFunction(() => LiuliDock.state().l);
        await page.evaluate(() => LiuliComposer.expand(true));
      }
      await page.waitForTimeout(100);
      const result = await page.evaluate(() => {
        const get = (s) => getComputedStyle(document.querySelector(s));
        const rect = (s) => document.querySelector(s).getBoundingClientRect();
        const bar = rect(".chat-func-bar"),
          menu = rect(".bar-more-menu-inner");
        return {
          logo: get(".topbar-content .qq-logo").display,
          profile: {
            height: rect(".topbar-profile").height,
            visible: get(".topbar-profile").visibility,
            opacity: get(".topbar-profile").opacity,
            infoHeight: rect(".user-profile-card__info").height,
            avatar: rect(".user-avatar").height,
            width: rect(".topbar-profile").width,
          },
          tools: {
            display: get(".chat-func-bar").display,
            columns: get(".chat-func-bar").gridTemplateColumns,
            wrappers: [".chat-func-bar__left", ".func-bar-native"].map(
              (s) => get(s).display,
            ),
            width: bar.width,
            height: bar.height,
            iconWidth: rect(".icon-item").width,
            label: getComputedStyle(
              document.querySelector(".icon-item"),
              "::after",
            ).display,
            arrow: rect(".arrow").width,
            menuX: menu.x - rect(".bar-more-menu").x,
            menuY: menu.y - rect(".bar-more-menu").y,
            shellTransform: get(".bar-more-menu").transform,
          },
          sensor: {
            width: rect("#liuli-nav-handle").width,
            height: rect("#liuli-nav-handle").height,
            text: document.querySelector("#liuli-nav-handle").textContent,
            visibleArrow:
              !!document.querySelector("#liuli-nav-handle svg") &&
              get("#liuli-nav-handle svg").display !== "none",
            hint: getComputedStyle(
              document.querySelector("#liuli-nav-handle"),
              "::after",
            ).content,
          },
          drag: {
            topHeight: rect("#app > .draggable-view:first-child").height,
            leftDisplay: get("#app > .draggable-view:nth-child(2)").display,
          },
          divider: get(".resize-handler.ew").opacity,
          extraPinLines: document.querySelectorAll(
            "[data-liuli-pin-heading],[data-liuli-pin-last],.liuli-pin-label",
          ).length,
        };
      });
      if (kind === "working") {
        await page.screenshot({
          path: path.join(root, "out", "ui-qa", "author-aligned-tools.png"),
        });
        await page.evaluate(() => LiuliComposer.expand(false));
        // Finish the deliberately opened tool popup before testing independent edges.
        // The whole edge, including the former excluded top 42px, must reveal.
        for (const y of [2, 120, 820]) {
          await page.mouse.move(600, 200);
          await page.waitForFunction(() => !LiuliDock.state().nav);
          await page.mouse.move(2, y);
          await page.waitForFunction(
            () => LiuliDock.state().nav,
            {},
            { timeout: 150 },
          );
        }
        await page.mouse.move(600, 200);
        await page.waitForFunction(() => !LiuliDock.state().nav);
        await page.evaluate(() => {
          const cfg = LiuliLayout.loadLayout();
          cfg.titlebar = "native";
          localStorage.setItem("liuli-layout", JSON.stringify(cfg));
          LiuliLayout.applyAll();
        });
        assert.notEqual(
          await page
            .locator(".qq-logo")
            .evaluate((n) => getComputedStyle(n).display),
          "none",
          "native-mode QQ logo remains native",
        );
      }
      snapshots.push({ kind, ...result, errors });
      await page.close();
    }
    fs.writeFileSync(
      path.join(root, "out", "ui-qa", "author-alignment.json"),
      JSON.stringify({ reference, snapshots }, null, 2),
    );
    const [a, b] = snapshots;
    assert.equal(b.logo, a.logo);
    // The capsule itself is deliberately 36px here (explicit request: every
    // top-row glass piece the same size and on one line); the author's is
    // 30px. Its native inner layout — 30px info block, 24px avatar — must
    // still match the author's exactly.
    assert.equal(a.profile.height, 30, "author capsule height");
    assert.equal(b.profile.height, 36, "capsule height");
    for (const key of ["visible", "opacity", "infoHeight", "avatar"])
      assert.equal(b.profile[key], a.profile[key], key);
    assert.ok(b.profile.width > 60);
    for (const key of [
      "display",
      "columns",
      "wrappers",
      "width",
      "height",
      "iconWidth",
      "label",
      "arrow",
      "menuX",
      "menuY",
    ])
      assert.deepEqual(b.tools[key], a.tools[key], key);
    assert.notEqual(b.tools.shellTransform, "none");
    assert.deepEqual(b.sensor, a.sensor);
    assert.deepEqual(b.drag, a.drag);
    assert.equal(b.divider, a.divider);
    assert.equal(b.extraPinLines, 0);
    assert.deepEqual(b.errors, []);
    fs.mkdirSync(path.join(root, "out", "ui-qa"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "out", "ui-qa", "author-alignment.json"),
      JSON.stringify({ reference, snapshots }, null, 2),
    );
    console.log(JSON.stringify({ reference, passed: true, snapshots }));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
