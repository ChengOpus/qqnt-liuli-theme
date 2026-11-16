const require = process.getBuiltinModule('module').createRequire(snowlora.script);
const path = require('node:path');
const loadResources = require('./resources.cjs');
const { randomUUID } = require('node:crypto');
const { BrowserWindow, webContents, app, shell, screen } = require('electron');

const root = path.dirname(snowlora.script);
// One registry per QQ process. SnowLora runs this script once per matching
// HWND, and QQ pre-creates windows (#/blank) that only route in-page later,
// so window state has to outlive a single execution.
const windows = (globalThis.__snowloraLiuliWindows ??= new Map());
let diagnostics = globalThis.__snowloraLiuliDiagnostics ?? null;

// Only QQ's main renderer document, and only its UI routes, receive the theme:
// hiddenWindow.html / screenshot.html / newLogin.html, about: shells, the
// screen-share surfaces and the "#/blank" holding page stay untouched.
// Standalone declaration so the porting tests can eval it in isolation.
function eligible(url) {
  if (typeof url !== 'string' || url === '') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'app:') return false;
  if (!parsed.pathname.endsWith('/renderer/index.html')) return false;
  const hash = parsed.hash;
  if (hash === '' || hash === '#' || hash === '#/') return false;
  // Deliberately inspects the raw hash: auxiliary windows carry percent-encoded
  // JSON in their route, and decoding would let quoted message text trip the
  // screen/share filter below. chatPoolWin=1 lives in the query, so it is not
  // treated as a reason to skip.
  const route = hash.slice(1).split('?')[0].toLowerCase();
  if (route.includes('screen') || route.includes('share')) return false;
  if (/^\/(?:blank|tray-menu|av)(?:[/?]|$)/.test(route)) return false;
  return true;
}

function initDiagnostics() {
  if (!diagnostics) {
    diagnostics = globalThis.__snowloraLiuliDiagnostics = require('./diagnostics.cjs')(root, () =>
      // Only themed documents take part in a diagnostic export, as before.
      [...windows.values()].filter(state => state.applied).map(state => state.wc)
    );
    require('./window-state.cjs')(diagnostics.log);
  }
  return diagnostics;
}

function stateUrl(state) {
  try {
    return state.wc.isDestroyed() ? '' : state.wc.getURL();
  } catch {
    return '';
  }
}

function logSkip(state, url) {
  if (!diagnostics || !url) return;
  state.skipped ??= new Set();
  if (state.skipped.has(url)) return;
  state.skipped.add(url);
  diagnostics.log({ event: 'theme-skip', window: state.wc.id, url: url.slice(0, 240) });
}

function createMethods(state) {
  const wc = state.wc;
  return {
    selfUid: () => wc.executeJavaScript('window.LiuliQQ.selfUid()'),
    async openExternal(value) {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持 HTTP/HTTPS 外链');
      await shell.openExternal(url.href);
      return true;
    },
    // 「禁止 QQ 自动更新」：主窗口启动和切换开关时调用，见 update-guard.cjs。
    updateGuard(enabled) {
      const report = require('./update-guard.cjs').apply(app, enabled === true);
      diagnostics?.log({ event: 'update-guard', ...report });
      return report;
    },
    // 「只在新消息时闪任务栏图标」：主窗口启动和切换开关时调用。
    flashGuard(enabled) {
      installFlashGuard();
      globalThis.__snowloraLiuliFlashGuard.enabled = enabled === true;
      return globalThis.__snowloraLiuliFlashGuard.enabled;
    },
    // QQ's update reminder that could not be dismissed (renderer
    // update-prompt.js): the calling window — and only it — is hidden.
    hideOwnWindow(reason) {
      const win = BrowserWindow.fromWebContents(wc);
      if (!win || win.isDestroyed()) return false;
      let route = '';
      try {
        route = new URL(wc.getURL()).hash.split('?')[0].replace(/\d{4,}/g, '#').slice(0, 60);
      } catch {}
      diagnostics?.log({ event: 'hide-window', reason: String(reason || '').slice(0, 40), route });
      win.hide();
      return true;
    },
    // 「链接直接打开」：主窗口启动和切换开关时调用，见 installLinkGuard。
    linkGuard(enabled) {
      installLinkGuard();
      globalThis.__snowloraLiuliLinkGuard.enabled = enabled === true;
      return globalThis.__snowloraLiuliLinkGuard.enabled;
    },
    // The main window's current look, used to pre-style viewers (below).
    viewerPreset(preset) {
      if (!preset || typeof preset.css !== 'string' || preset.css.length > 3 * 1024 * 1024) return false;
      const clean = (object, test) =>
        Object.fromEntries(
          Object.entries(object && typeof object === 'object' ? object : {}).filter(
            ([k, v]) => test.test(k) && typeof v === 'string' && v.length < 4096
          )
        );
      globalThis.__snowloraLiuliViewerPreset = {
        css: preset.css,
        attrs: clean(preset.attrs, /^liuli[A-Za-z]{1,40}$/),
        vars: clean(preset.vars, /^--ll-[a-z0-9-]{1,60}$/)
      };
      return true;
    },
    diagLog: entry => diagnostics.log(entry),
    diagExport: payload => diagnostics.exportReport(payload),
    diagOpenPath: file => diagnostics.openPath(file)
  };
}

// A scoped console channel reaches the host without adding a QQ preload or IPC hook.
async function onConsole(state, details) {
  const wc = state.wc;
  const message = details.message;
  if (!state.token || typeof message !== 'string' || !message.startsWith(state.token)) return;
  if (wc.isDestroyed() || details.frame !== wc.mainFrame || message.length > 4 * 1024 * 1024)
    return;
  const token = state.token;
  const methods = (state.methods ??= createMethods(state));
  let request;
  try {
    request = JSON.parse(message.slice(token.length));
    if (!Number.isSafeInteger(request.id) || !Object.hasOwn(methods, request.method)) return;
  } catch {
    return;
  }
  let result, error;
  try {
    result = await methods[request.method](request.argument);
  } catch (cause) {
    error = cause.message;
    diagnostics.log({ method: request.method, error });
  }
  if (request.id && !wc.isDestroyed() && state.token === token) {
    await wc
      .executeJavaScript(
        `window.LiuliHost.reply(${request.id},${JSON.stringify(result ?? null)},${JSON.stringify(error ?? null)})`
      )
      .catch(() => {});
  }
}

// Taskbar flashing. QQ flashes the taskbar button through Electron's
// flashFrame for new messages and for notices alike (join requests, friend
// requests), with no reason attached. With the guard on, a flash request is
// held for half a second and the main window is asked whether its unread
// message count went up just before (renderer: LiuliNotice.grew). Only then
// does the button flash. Unknown (no main window, no answer) flashes as before.
function mainState() {
  for (const state of windows.values()) {
    if (state.applied && /#\/main(?:[/?]|$)/.test(stateUrl(state))) return state;
  }
  return null;
}
function installFlashGuard() {
  if (globalThis.__snowloraLiuliFlashGuard) return;
  let proto = BrowserWindow.prototype;
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'flashFrame')) proto = Object.getPrototypeOf(proto);
  const guard = (globalThis.__snowloraLiuliFlashGuard = { enabled: true, original: proto?.flashFrame || null });
  if (!proto || typeof guard.original !== 'function') return;
  proto.flashFrame = function (flag) {
    if (!flag || !guard.enabled) return guard.original.call(this, flag);
    const win = this;
    setTimeout(async () => {
      let grew = null;
      const main = mainState();
      if (main && !main.wc.isDestroyed()) {
        grew = await main.wc
          .executeJavaScript('window.LiuliNotice ? window.LiuliNotice.grew() : null')
          .catch(() => null);
      }
      diagnostics?.log({ event: 'taskbar-flash', grew });
      if (grew === false) return;
      try {
        if (!win.isDestroyed() && !win.isFocused()) guard.original.call(win, true);
      } catch {}
    }, 500);
  };
}

// Links. QQ sends a web link to the system browser wrapped in its own safety
// page (c.pc.qq.com/middlem.html?pfurl=<link>&pfuin=<your QQ number>&…,
// pc.html?url=…, ios.html?url=…), where the link has to be copied out by
// hand (user request, 2026-11-15). With the guard on, such a wrapper is
// unwrapped and the link itself opened. Only http(s) links come out of it;
// anything else, or a wrapper that cannot be read, is opened as QQ asked.
// The log keeps host names only (the wrapper carries the QQ number).
const QQ_WRAP_HOST = /(^|\.)(c\.pc\.qq\.com|c\.mp\.qq\.com|urlsec\.qq\.com)$/i;
const QQ_WRAP_KEYS = ['pfurl', 'url', 'u', 'target', 'targeturl'];
function unwrapQQLink(value) {
  let current = String(value || '');
  for (let round = 0; round < 3; round++) {
    let url;
    try {
      url = new URL(current);
    } catch {
      return null;
    }
    if (!QQ_WRAP_HOST.test(url.hostname)) return round ? current : null;
    let inner = null;
    for (const key of QQ_WRAP_KEYS) {
      const raw = url.searchParams.get(key);
      if (!raw) continue;
      let candidate = raw.trim();
      if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate) && /^[\w-]+(\.[\w-]+)+([/?#:]|$)/.test(candidate)) candidate = 'http://' + candidate;
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          inner = parsed.href;
          break;
        }
      } catch {}
    }
    if (!inner) return null;
    current = inner;
  }
  return current;
}
function hostOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}
function installLinkGuard() {
  if (globalThis.__snowloraLiuliLinkGuard) return;
  const guard = (globalThis.__snowloraLiuliLinkGuard = { enabled: true, original: shell.openExternal, unwrap: unwrapQQLink });
  if (typeof guard.original !== 'function') return;
  const original = guard.original;
  const patched = function (target, ...rest) {
    if (guard.enabled) {
      const inner = unwrapQQLink(target);
      if (inner) {
        diagnostics?.log({ event: 'link-open', via: hostOf(target), host: hostOf(inner) });
        return original.call(this, inner, ...rest);
      }
    }
    return original.call(this, target, ...rest);
  };
  try {
    shell.openExternal = patched;
  } catch {}
  guard.installed = shell.openExternal === patched;
  diagnostics?.log({ event: 'link-guard', installed: guard.installed });
}

// QQ's picture/video viewer is a pooled blank window routed in place, then
// sized to the media and shown. Injecting the theme at that same moment
// blocks the page while QQ is sizing it, and the viewer sometimes came up at
// its default size instead of the picture's (user report, 2026-11-15). The
// theme there is only the toolbar glass, so it waits until the window has
// been shown and has kept its size for a moment (at most 2.5 s).
function mediaViewer(url) {
  try {
    const route = new URL(url).hash.slice(1).split('?')[0].toLowerCase();
    return /viewer|player|preview|media|video/.test(route);
  } catch {
    return false;
  }
}
function settled(state) {
  const wc = state.wc;
  let win = null;
  try {
    win = BrowserWindow.fromWebContents(wc);
  } catch {}
  return new Promise(resolve => {
    let quiet = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(quiet);
      clearTimeout(cap);
      clearInterval(poll);
      if (win && !win.isDestroyed()) {
        win.removeListener('resize', bump);
        win.removeListener('show', bump);
      }
      resolve();
    };
    const visible = () => {
      try {
        return !win || win.isDestroyed() || win.isVisible();
      } catch {
        return true;
      }
    };
    const bump = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => (visible() ? finish() : bump()), 400);
    };
    const cap = setTimeout(finish, 2500);
    const poll = setInterval(() => wc.isDestroyed() && finish(), 250);
    if (win && !win.isDestroyed()) {
      win.on('resize', bump);
      win.on('show', bump);
    }
    bump();
  });
}

// While a viewer waits for QQ to size it (settled), it already wears the
// theme: the stylesheet and wallpaper rule the main window built, plus its
// theme attributes and colour variables on <body>. Plain CSS and a few
// attribute writes, nothing that runs for long. Removed once the theme proper
// is in, which writes the same things itself.
async function preStyle(state) {
  const preset = globalThis.__snowloraLiuliViewerPreset;
  const wc = state.wc;
  if (!preset || state.presetKey || wc.isDestroyed()) return;
  try {
    state.presetKey = await wc.insertCSS(preset.css);
    await wc.executeJavaScript(
      `(()=>{const b=document.body;if(!b)return;const a=${JSON.stringify(preset.attrs)};` +
        `for(const k in a)b.dataset[k]=a[k];b.dataset.liuliScope='aux';b.dataset.hash=location.hash;` +
        `const v=${JSON.stringify(preset.vars)};for(const k in v)b.style.setProperty(k,v[k]);})()`
    );
  } catch (error) {
    diagnostics?.log({ event: 'viewer-prestyle', error: error?.message ?? String(error) });
  }
}
function dropPreStyle(state) {
  const key = state.presetKey;
  state.presetKey = null;
  if (key && !state.wc.isDestroyed()) state.wc.removeInsertedCSS(key).catch(() => {});
}

async function apply(state, generation = state.generation) {
  const wc = state.wc;
  if (wc.isDestroyed() || generation !== state.generation) return false;
  let url = stateUrl(state);
  if (!eligible(url)) return false;
  if (mediaViewer(url)) {
    await preStyle(state);
    await settled(state);
    if (wc.isDestroyed() || generation !== state.generation) return false;
    url = stateUrl(state);
    if (!eligible(url)) return false;
  }
  const { assets, wallpaper, source } = await loadResources(root);
  if (wc.isDestroyed() || wc.isLoadingMainFrame() || state.generation !== generation) return false;
  if (state.applied || !eligible(stateUrl(state))) return false;
  state.token = '[theme-host:' + randomUUID() + ']';
  const bootstrap = {
    token: state.token,
    assets,
    wallpaper,
    info: {
      present: true,
      host: 'native',
      versions: { ...process.versions, qqnt: app.getVersion() }
    }
  };
  try {
    await wc.executeJavaScript(
      `(async () => {\nconst bootstrap = ${JSON.stringify(bootstrap)};\n${source}\nawait window.SnowLoraLiuli.ready;\n})()`
    );
  } catch (error) {
    diagnostics.log({
      event: 'theme-failed',
      window: wc.id,
      url: url.slice(0, 120),
      error: error?.message ?? String(error)
    });
    console.error('[theme]', error);
    return false;
  }
  state.applied = true;
  dropPreStyle(state);
  diagnostics.log({ event: 'theme-ready', window: wc.id, url: url.slice(0, 120) });
  return true;
}

// Queue one injection per webContents: apply calls never overlap, and the
// queued task re-checks "already applied" so one document is never themed twice.
function enqueue(state, generation) {
  state.ready = state.ready.catch(() => {}).then(() => {
    if (state.applied) return false;
    return apply(state, generation);
  });
  // Never let a failure escape as a rejection: SnowLora awaits this execution.
  state.ready = state.ready.catch(error => {
    const url = stateUrl(state);
    diagnostics?.log({
      event: 'theme-failed',
      window: state.wc.id,
      url: url.slice(0, 120),
      error: error?.message ?? String(error)
    });
    console.error('[theme]', error);
  });
  return state.ready;
}

function onLoad(state) {
  if (state.wc.isDestroyed()) return;
  // A fresh document: any previous injection is gone.
  const generation = ++state.generation;
  state.applied = false;
  state.presetKey = null; // inserted CSS went with the old document
  const url = stateUrl(state);
  if (!eligible(url)) {
    logSkip(state, url);
    return;
  }
  enqueue(state, generation);
}

function onRoute(state, _event, url, isMainFrame) {
  if (!isMainFrame || state.wc.isDestroyed()) return;
  const target = typeof url === 'string' && url ? url : stateUrl(state);
  if (!state.applied) {
    // The usual case for pre-created windows: attach saw "#/blank", and the
    // real route was entered without a reload.
    if (eligible(target)) enqueue(state, state.generation);
    else logSkip(state, target);
    return;
  }
  // Same document, only the hash changed: let the renderer re-sync in place.
  state.wc.executeJavaScript("window.dispatchEvent(new Event('liuli-route'))").catch(() => {});
}

function attach(browserWindow) {
  let wc;
  try {
    if (!browserWindow || browserWindow.isDestroyed()) return null;
    wc = browserWindow.webContents;
  } catch {
    return null;
  }
  return attachContents(wc, browserWindow);
}

// QQ can host auxiliary UI in a WebContentsView rather than a BrowserWindow.
// The same URL guard applies. Never inject a webview, screenshot/login document,
// external page or the native AV/screen-sharing surfaces.
function attachContents(wc, browserWindow = null) {
  if (!wc || wc.isDestroyed() || wc.getType?.() === 'webview') return null;
  const existing = windows.get(wc.id);
  if (existing) {
    if (existing.managed) return existing;
    // Adopt a state left by an older load.js: it already injected this document
    // and already owns its listeners, so neither re-attach nor re-inject.
    existing.managed = true;
    existing.applied = true;
    existing.ready ??= Promise.resolve();
    return existing;
  }
  const state = {
    wc,
    ready: Promise.resolve(),
    token: '',
    generation: 0,
    applied: false,
    managed: true,
    skipped: new Set()
  };
  windows.set(wc.id, state);
  wc.on('console-message', details => onConsole(state, details));
  wc.on('did-finish-load', () => onLoad(state));
  wc.on('did-navigate-in-page', (event, url, isMainFrame) =>
    onRoute(state, event, url, isMainFrame)
  );
  wc.on('page-title-updated', (_event, title) => {
    browserWindow ??= BrowserWindow.fromWebContents(wc);
    if (state.searchSized || !/综合搜索/.test(String(title)) || !browserWindow || browserWindow.isDestroyed()) return;
    state.searchSized = true;
    try {
      const old = browserWindow.getBounds();
      if (old.width <= 1000 && old.height <= 880) return;
      const work = screen.getDisplayMatching(old).workArea;
      const width = Math.min(920, work.width - 32);
      const height = Math.min(740, work.height - 32);
      browserWindow.setBounds({
        x: Math.round(Math.max(work.x, Math.min(work.x + work.width - width, old.x + (old.width - width) / 2))),
        y: Math.round(Math.max(work.y, Math.min(work.y + work.height - height, old.y + (old.height - height) / 2))),
        width,
        height
      });
    } catch (error) {
      diagnostics?.log({ event: 'search-window-size', error: error.message });
    }
  });
  wc.once('destroyed', () => windows.delete(wc.id));
  const url = stateUrl(state);
  if (eligible(url)) {
    // Already past the load event (windows that existed before this injection,
    // or a window whose load finished between creation and attach).
    if (!wc.isLoadingMainFrame()) enqueue(state, state.generation);
  } else if (url) {
    logSkip(state, url);
  }
  return state;
}

function createManager() {
  initDiagnostics();
  const instance = { windows, diagnostics, eligible, attach, attachContents };
  // One listener registration per process, on purpose.
  app.on('browser-window-created', (_event, browserWindow) => attach(browserWindow));
  app.on('web-contents-created', (_event, wc) => attachContents(wc));
  for (const browserWindow of BrowserWindow.getAllWindows()) attach(browserWindow);
  for (const wc of webContents.getAllWebContents()) attachContents(wc);
  return instance;
}

// Repeated executions reuse the manager; only the per-call hand-off below runs.
const manager = (globalThis.__snowloraLiuliManager ??= createManager());

// SnowLora invokes this file once per window it matched by title. The manager
// now decides globally what to theme, so this call only waits for its window
// and never throws.
const snowloraWindow = BrowserWindow.getAllWindows().find(browserWindow => {
  try {
    return (
      !browserWindow.isDestroyed() &&
      browserWindow.getNativeWindowHandle().readBigUInt64LE().toString(16) === snowlora.window
    );
  } catch {
    return false;
  }
});
if (!snowloraWindow) return;
const targetState = manager.attach(snowloraWindow);
if (!targetState || !eligible(stateUrl(targetState))) return;
await targetState.ready;
