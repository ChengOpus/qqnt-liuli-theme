// Shared boot for browser tests: serves an anonymous fixture, injects the real
// renderer bundle exactly as load.js does, and answers the host bridge.
// CHROMIUM_PATH may override the executable. No QQ account or data.
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const { chromium } = require("playwright");
const repo = path.resolve(__dirname, "..");
const readResources = require("../resources.cjs");

function wallpaper(dark) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 860;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 1280, 860);
  gradient.addColorStop(0, dark ? "#192536" : "#f9e7f1");
  gradient.addColorStop(0.5, dark ? "#29364f" : "#e2ecff");
  gradient.addColorStop(1, dark ? "#3a2846" : "#c1e7f5");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1280, 860);
  // High-contrast stripes make any seam, unblurred edge or double layer visible.
  for (let x = 0; x < 1280; x += 48) {
    ctx.fillStyle = x % 96 === 0 ? "#d9809088" : "#5f8fd088";
    ctx.fillRect(x, 0, 24, 860);
  }
  return canvas.toDataURL();
}

async function start() {
  const bundle = await readResources(repo);
  const fixtures = new Map();
  const server = http.createServer((request, response) => {
    const name =
      new URL(request.url, "http://x").searchParams.get("fixture") ||
      "qq-native-fixture.html";
    if (!fixtures.has(name))
      fixtures.set(name, fs.readFileSync(path.join(__dirname, name)));
    response.setHeader("content-type", "text/html;charset=utf-8");
    response.end(fixtures.get(name));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  // options: { width, height, scale, dark, hash, fixture, settings, layout, before }
  async function open(options = {}) {
    const {
      width = 1280,
      height = 860,
      scale = 1,
      dark = false,
      hash = "#/main/message",
      fixture = "qq-native-fixture.html",
      settings = {},
      layout = {},
      before = null,
    } = options;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "debug" || !message.text().startsWith("[qa-host]"))
        return;
      let request;
      try {
        request = JSON.parse(message.text().slice(9));
      } catch {
        return;
      }
      if (request.id)
        page
          .evaluate((r) => window.LiuliHost?.reply(r.id, "", null), request)
          .catch(() => {});
    });
    await page.goto(`${origin}/?fixture=${fixture}${hash}`);
    await page.evaluate(
      ({ dark, settings, layout, paint }) => {
        document.body.setAttribute("q-theme", dark ? "dark" : "light");
        localStorage.setItem(
          "liuli-dsh-settings",
          JSON.stringify({
            blur: 18,
            opacity: 0.15,
            chatStyle: "tg",
            pinGroup: true,
            pinColor: false,
            ...settings,
          }),
        );
        localStorage.setItem(
          "liuli-layout",
          JSON.stringify({ barPinned: 0, edgeHints: true, ...layout }),
        );
        localStorage.setItem(
          "liuli-color-source",
          JSON.stringify({ mode: "manual", hex: "#cba6f7", exact: true }),
        );
        localStorage.setItem(
          "liuli-dsh-wallpaper",
          JSON.stringify({ src: new Function("return " + paint)()(dark), fit: "cover" }),
        );
      },
      { dark, settings, layout, paint: wallpaper.toString() },
    );
    if (before) await page.evaluate(before);
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
    await page.evaluate(() => SnowLoraLiuli.ready);
    await page.waitForTimeout(350);
    return { page, context, errors };
  }
  async function stop() {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  return { open, stop, origin, repo };
}

module.exports = { start, repo };
