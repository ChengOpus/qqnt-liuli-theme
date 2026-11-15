// Exercise the actual SnowLora entry point with Electron lifecycle doubles.
// No QQ process, account, protocol or external application is used.
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { EventEmitter } = require("node:events");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  source = fs.readFileSync(path.join(root, "load.js"), "utf8");
let nextId = 1;
class Contents extends EventEmitter {
  constructor(route, type = "window") {
    super();
    this.id = nextId++;
    this.url = route;
    this.type = type;
    this.calls = [];
    this.mainFrame = {};
  }
  isDestroyed() {
    return false;
  }
  getType() {
    return this.type;
  }
  getURL() {
    return this.url;
  }
  isLoadingMainFrame() {
    return false;
  }
  executeJavaScript(script) {
    this.calls.push(script);
    return Promise.resolve();
  }
}
const ui = (route) => "app://qq/renderer/index.html#/" + route;
const main = new Contents(ui("main/message"));
const existingView = new Contents(
  ui("mini-group?payload=%7B%22share%22%3Atrue%7D"),
  "browserView",
);
const browserWindow = {
  webContents: main,
  isDestroyed: () => false,
  getNativeWindowHandle: () => Buffer.from("0100000000000000", "hex"),
};
const app = new EventEmitter();
app.getVersion = () => "9.9.36";
// Electron's BrowserWindow: flashFrame lives on the prototype.
function BrowserWindowDouble() {}
BrowserWindowDouble.prototype.flashFrame = function (flag) {
  this.flashes.push(flag);
};
BrowserWindowDouble.getAllWindows = () => [browserWindow];
BrowserWindowDouble.fromWebContents = (wc) => (wc === main ? browserWindow : wc.window || null);
let unreadGrew = null;
const mainExec = main.executeJavaScript.bind(main);
main.executeJavaScript = (script) =>
  script.includes("LiuliNotice") ? Promise.resolve(unreadGrew) : mainExec(script);
const all = [main, existingView],
  electron = {
    app,
    BrowserWindow: BrowserWindowDouble,
    webContents: { getAllWebContents: () => all },
    shell: { opened: [], openExternal(url) { this.opened.push(url); return Promise.resolve(); } },
    screen: {},
  };
const req = (name) => {
  if (name === "electron") return electron;
  if (name === "node:path") return path;
  if (name === "node:crypto") return { randomUUID: () => "anonymous-test" };
  if (name === "./resources.cjs")
    return async () => ({ assets: {}, wallpaper: "", source: "" });
  if (name === "./diagnostics.cjs") return () => ({ log: () => {} });
  if (name === "./window-state.cjs") return () => {};
  throw Error("unexpected require " + name);
};
const context = vm.createContext({
  console,
  URL,
  Buffer,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  snowlora: { script: path.join(root, "load.js"), window: "1" },
  process: {
    versions: {},
    getBuiltinModule: () => ({ createRequire: () => req }),
  },
});
const run = () => vm.runInContext("(async()=>{" + source + "})()", context);
const flush = () => new Promise((r) => setImmediate(r));
(async () => {
  await run();
  await flush();
  assert.equal(main.calls.length, 1);
  assert.equal(
    existingView.calls.length,
    1,
    "pre-existing view receives theme, even with share in query data",
  );
  await run();
  await flush();
  assert.equal(
    main.calls.length,
    1,
    "repeated SnowLora title matches do not reinject",
  );
  assert.equal(app.listenerCount("web-contents-created"), 1);
  assert.equal(app.listenerCount("browser-window-created"), 1);
  const pool = new Contents(ui("blank"), "browserView");
  app.emit("web-contents-created", {}, pool);
  await flush();
  assert.equal(pool.calls.length, 0);
  pool.url = ui("mini-group");
  pool.emit("did-navigate-in-page", {}, pool.url, true);
  await flush();
  assert.equal(
    pool.calls.length,
    1,
    "pooled view is injected when it enters an eligible route",
  );
  pool.emit("did-finish-load");
  await flush();
  assert.equal(
    pool.calls.length,
    2,
    "fresh document receives one fresh injection",
  );
  for (const [url, type] of [
    ["https://example.com/renderer/index.html#/main", "window"],
    ["app://qq/renderer/newLogin.html", "window"],
    ["app://qq/renderer/screenshot.html#/capture", "window"],
    [ui("screen-share"), "window"],
    [ui("av?scene=call"), "window"],
    [ui("main"), "webview"],
  ]) {
    const wc = new Contents(url, type);
    app.emit("web-contents-created", {}, wc);
    wc.emit("did-finish-load");
    await flush();
    assert.equal(wc.calls.length, 0, url);
  }
  // Picture viewer: a pooled window QQ routes, sizes and then shows. The
  // theme waits until it is shown and has kept its size for 400 ms.
  // The main window's look, handed over earlier through the host bridge.
  context.__snowloraLiuliViewerPreset = { css: "body{--qa:1}", attrs: { liuliTheme: "dsh" }, vars: { "--ll-brand": "#aa3341" } };
  const viewer = new Contents(ui("blank"), "window");
  const order = [];
  viewer.insertCSS = (css) => (order.push("insert:" + css), Promise.resolve("key-1"));
  viewer.removeInsertedCSS = (key) => (order.push("remove:" + key), Promise.resolve());
  const exec = viewer.executeJavaScript.bind(viewer);
  viewer.executeJavaScript = (script) => (order.push(script.includes("liuliScope='aux'") ? "attrs" : "theme"), exec(script));
  const viewerWindow = new EventEmitter();
  let shown = false;
  viewerWindow.isDestroyed = () => false;
  viewerWindow.isVisible = () => shown;
  viewer.window = viewerWindow;
  app.emit("web-contents-created", {}, viewer);
  await flush();
  viewer.url = ui("image-viewer?data=%7B%7D");
  viewer.emit("did-navigate-in-page", {}, viewer.url, true);
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(order, ["insert:body{--qa:1}", "attrs"], "viewer wears the theme's CSS at once");
  assert.equal(viewer.calls.filter((c) => !c.includes("liuliScope='aux'")).length, 0, "viewer is not themed while hidden");
  viewerWindow.emit("resize");
  shown = true;
  viewerWindow.emit("show");
  await new Promise((r) => setTimeout(r, 200));
  viewerWindow.emit("resize"); // QQ sizing it to the picture
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(order.length, 2, "viewer is not themed while QQ sizes it");
  await new Promise((r) => setTimeout(r, 400));
  await flush();
  assert.deepEqual(order.slice(2), ["theme", "remove:key-1"], "themed once shown and settled, then the pre-style is dropped");
  // a viewer that never reports anything is themed after the cap
  const quiet = new Contents(ui("blank"), "window");
  app.emit("web-contents-created", {}, quiet);
  quiet.url = ui("video-player");
  quiet.emit("did-navigate-in-page", {}, quiet.url, true);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(quiet.calls.length, 0);
  await new Promise((r) => setTimeout(r, 400));
  await flush();
  assert.equal(quiet.calls.length, 1, "no window object: themed after a short quiet period");
  // Taskbar flash: only when the unread message count went up.
  main.emit("console-message", {
    message: "[theme-host:anonymous-test]" + JSON.stringify({ id: 0, method: "flashGuard", argument: true }),
    frame: main.mainFrame,
  });
  await flush();
  const win = new BrowserWindowDouble();
  win.flashes = [];
  win.isDestroyed = () => false;
  win.isFocused = () => false;
  const attempt = async (grew) => {
    unreadGrew = grew;
    win.flashFrame(true);
    await new Promise((r) => setTimeout(r, 650));
  };
  await attempt(false);
  assert.deepEqual(win.flashes, [], "a join request (no new message) does not flash");
  await attempt(true);
  assert.deepEqual(win.flashes, [true], "a new message flashes");
  await attempt(null);
  assert.deepEqual(win.flashes, [true, true], "unknown: flash as QQ would");
  win.flashFrame(false);
  assert.deepEqual(win.flashes, [true, true, false], "stopping a flash is immediate");
  main.emit("console-message", {
    message: "[theme-host:anonymous-test]" + JSON.stringify({ id: 0, method: "flashGuard", argument: false }),
    frame: main.mainFrame,
  });
  await flush();
  unreadGrew = false;
  win.flashFrame(true);
  assert.deepEqual(win.flashes, [true, true, false, true], "guard off: QQ's behaviour");
  // Links: QQ's safety page is unwrapped, everything else opens as asked.
  main.emit("console-message", {
    message: "[theme-host:anonymous-test]" + JSON.stringify({ id: 0, method: "linkGuard", argument: true }),
    frame: main.mainFrame,
  });
  await flush();
  const shell = electron.shell;
  const target = "https://docs.qq.com/sheet/EXAMPLE?tab=AB12";
  await shell.openExternal(
    "https://c.pc.qq.com/middlem.html?pfurl=" + encodeURIComponent(target) + "&pfuin=10001&pfto=qq.msg&type=0&gjlevel=15&ADUIN=10001&ADSESSION=1&ADTAG=CLIENT.QQ",
  );
  await shell.openExternal("https://c.pc.qq.com/pc.html?url=" + encodeURIComponent("example.org/a?b=1") + "&level=14");
  await shell.openExternal("https://c.pc.qq.com/ios.html?url=" + encodeURIComponent("javascript:alert(1)"));
  await shell.openExternal("https://c.pc.qq.com/middlem.html?pfurl=" + encodeURIComponent("https://c.pc.qq.com/pc.html?url=" + encodeURIComponent(target)));
  await shell.openExternal("https://example.net/x?pfurl=https%3A%2F%2Fevil.example");
  await shell.openExternal("mailto:someone@example.invalid");
  assert.deepEqual(
    shell.opened,
    [
      target,
      "http://example.org/a?b=1",
      "https://c.pc.qq.com/ios.html?url=" + encodeURIComponent("javascript:alert(1)"),
      target,
      "https://example.net/x?pfurl=https%3A%2F%2Fevil.example",
      "mailto:someone@example.invalid",
    ],
    "QQ's safety page unwrapped to http(s) links only",
  );
  main.emit("console-message", {
    message: "[theme-host:anonymous-test]" + JSON.stringify({ id: 0, method: "linkGuard", argument: false }),
    frame: main.mainFrame,
  });
  await flush();
  shell.opened.length = 0;
  const wrapped = "https://c.pc.qq.com/middlem.html?pfurl=" + encodeURIComponent(target);
  await shell.openExternal(wrapped);
  assert.deepEqual(shell.opened, [wrapped], "guard off: QQ's behaviour");
  assert.equal(main.listenerCount("did-finish-load"), 1);
  assert.equal(pool.listenerCount("did-finish-load"), 1);
  console.log(
    "window injection: existing/new/pooled views, repeated registration, query data, protected documents and pre-styled, deferred media viewers, the taskbar flash guard and the link guard passed",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
