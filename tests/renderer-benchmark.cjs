// Identical anonymous workload for a baseline checkout and the working tree.
// Chromium CPU/callback counts are diagnostic evidence, never Windows QQ FPS.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const current = path.resolve(__dirname, "..");
const baseline = process.argv[2] && path.resolve(process.argv[2]);
const output = path.join(current, "out", "ui-qa");

(async () => {
  const fixture = fs.readFileSync(path.join(__dirname, "qq-fixture.html"));
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html;charset=utf-8");
    res.end(fixture);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
    headless: true,
  });
  const results = [];
  const checkouts = baseline ? [baseline, current] : [current];
  try {
    for (let run = 0; run < 3; run++) {
      // Alternate order to reduce a persistent warm-up/order advantage.
      for (const repo of run % 2 ? checkouts.slice().reverse() : checkouts) {
        const bundle = await require(path.join(repo, "resources.cjs"))(repo);
        const page = await browser.newPage({
          viewport: { width: 1280, height: 860 },
        });
        const errors = [];
        page.on("pageerror", (err) => errors.push(err.message));
        page.on("console", (msg) => {
          if (!msg.text().startsWith("[qa-bench]")) return;
          try {
            const req = JSON.parse(msg.text().slice(10));
            if (req.id)
              page
                .evaluate((r) => window.LiuliHost?.reply(r.id, "", null), req)
                .catch(() => {});
          } catch {}
        });
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
          original.dataset.benchPane = "original";
          const cached = original.cloneNode(true);
          cached.dataset.benchPane = "cached";
          cached.querySelector(".panel-header__title").textContent =
            "另一个示例群聊";
          cached.style.display = "none";
          cached.setAttribute("aria-hidden", "true");
          original.parentElement.prepend(cached);
          window.__bench = {
            mutationCreated: 0,
            mutationCallbacks: 0,
            resizeCreated: 0,
            resizeCallbacks: 0,
            frames: 0,
            longTasks: [],
          };
          for (const [name, kind] of [
            ["MutationObserver", "mutation"],
            ["ResizeObserver", "resize"],
          ]) {
            const Native = window[name];
            window[name] = new Proxy(Native, {
              construct(target, args) {
                __bench[kind + "Created"]++;
                const callback = args[0];
                args[0] = function (...records) {
                  __bench[kind + "Callbacks"]++;
                  return callback.apply(this, records);
                };
                return Reflect.construct(target, args);
              },
            });
          }
          const frame = window.requestAnimationFrame;
          window.requestAnimationFrame = (callback) =>
            frame.call(window, (time) => {
              __bench.frames++;
              return callback(time);
            });
          new PerformanceObserver((list) => {
            __bench.longTasks.push(...list.getEntries().map((e) => e.duration));
          }).observe({ type: "longtask" });
        });
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Performance.enable");
        await page.addScriptTag({
          content:
            "const bootstrap=" +
            JSON.stringify({
              token: "[qa-bench]",
              assets: bundle.assets,
              wallpaper: "",
              info: { versions: {} },
            }) +
            ";\n" +
            bundle.source,
        });
        await page.evaluate(() => window.SnowLoraLiuli.ready);
        await page.waitForTimeout(700);
        const metrics = async () =>
          Object.fromEntries(
            (await cdp.send("Performance.getMetrics")).metrics.map((v) => [
              v.name,
              v.value,
            ]),
          );
        const start = await metrics();
        await page.evaluate(() => {
          __bench.longTasks.length = 0;
        });
        for (let i = 0; i < 12; i++) {
          await page.evaluate(
            (name) => {
              for (const pane of document.querySelectorAll(
                "[data-bench-pane]",
              )) {
                const on = pane.dataset.benchPane === name;
                pane.style.display = on ? "flex" : "none";
                pane.setAttribute("aria-hidden", String(!on));
              }
            },
            i % 2 ? "original" : "cached",
          );
          await page.waitForTimeout(90);
        }
        const geometry = [];
        for (let i = 0; i < 4; i++) {
          await page.mouse.move(1, 240, { steps: 4 });
          await page.waitForTimeout(300);
          geometry.push(
            await page.evaluate(() => {
              const side = document
                .querySelector(".container-sidebar")
                .getBoundingClientRect();
              const list = document
                .querySelector(".recent-contact")
                .getBoundingClientRect();
              return {
                overlap: side.width > 1 && side.right > list.left + 0.5,
                width: side.width,
              };
            }),
          );
          await page.mouse.move(650, 220, { steps: 4 });
          await page.waitForTimeout(480);
        }
        await page.mouse.move(120, 4);
        await page.waitForTimeout(300);
        await page.mouse.move(650, 220);
        await page.waitForTimeout(600);
        await page.waitForTimeout(300);
        const end = await metrics();
        const beforeIdle = await page.evaluate(() => ({ ...__bench }));
        await page.waitForTimeout(700);
        const idle = await page.evaluate(
          (prev) => ({
            mutationCallbacks:
              __bench.mutationCallbacks - prev.mutationCallbacks,
            resizeCallbacks: __bench.resizeCallbacks - prev.resizeCallbacks,
            frames: __bench.frames - prev.frames,
          }),
          beforeIdle,
        );
        const state = await page.evaluate(() => {
          const active = [
            ...document.querySelectorAll(".chat-input-area"),
          ].find((n) => n.getBoundingClientRect().height > 0);
          return {
            position: getComputedStyle(active).position,
            material: getComputedStyle(
              document.querySelector("[data-liuli-composer]") || active,
              "::before",
            ).backgroundColor,
            nativeEditorCount: document.querySelectorAll(".ProseMirror").length,
            textShadow: getComputedStyle(
              document.querySelector(".text-element"),
            ).textShadow,
          };
        });
        results.push({
          version: require(path.join(repo, "snowlora-plugin.json")).version,
          run: run + 1,
          sourceBytes: Buffer.byteLength(bundle.source),
          cssBytes: Object.values(bundle.assets).reduce(
            (sum, a) => sum + (a.name.endsWith(".css") ? a.bytes : 0),
            0,
          ),
          cpuMs: Object.fromEntries(
            [
              "ScriptDuration",
              "LayoutDuration",
              "RecalcStyleDuration",
              "TaskDuration",
            ].map((k) => [k, +(1000 * (end[k] - start[k])).toFixed(2)]),
          ),
          observers: {
            mutation: beforeIdle.mutationCreated,
            resize: beforeIdle.resizeCreated,
          },
          callbacks: {
            mutation: beforeIdle.mutationCallbacks,
            resize: beforeIdle.resizeCallbacks,
            frames: beforeIdle.frames,
          },
          longTasks: beforeIdle.longTasks.length,
          idle,
          geometry,
          state,
          errors,
        });
        await page.close();
      }
    }
    const median = (list) =>
      list.sort((a, b) => a - b)[Math.floor(list.length / 2)];
    const versions = [...new Set(results.map((r) => r.version))];
    const medians = versions.map((version) => {
      const rows = results.filter((r) => r.version === version);
      return {
        version,
        cpuMs: Object.fromEntries(
          Object.keys(rows[0].cpuMs).map((k) => [
            k,
            median(rows.map((r) => r.cpuMs[k])),
          ]),
        ),
        sourceBytes: rows[0].sourceBytes,
        cssBytes: rows[0].cssBytes,
        observers: rows[0].observers,
        idleFrames: median(rows.map((r) => r.idle.frames)),
        navOverlaps: rows.reduce(
          (sum, r) => sum + r.geometry.filter((n) => n.overlap).length,
          0,
        ),
      };
    });
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, "benchmark.json"),
      JSON.stringify(
        { chromium: browser.version(), medians, results },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ medians, output: path.join(output, "benchmark.json") }),
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
