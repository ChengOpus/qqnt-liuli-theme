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
const all = [main, existingView],
  electron = {
    app,
    BrowserWindow: {
      getAllWindows: () => [browserWindow],
      fromWebContents: (wc) => (wc === main ? browserWindow : null),
    },
    webContents: { getAllWebContents: () => all },
    shell: {},
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
  assert.equal(main.listenerCount("did-finish-load"), 1);
  assert.equal(pool.listenerCount("did-finish-load"), 1);
  console.log(
    "window injection: existing/new/pooled views, repeated registration, query data and protected documents passed",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
