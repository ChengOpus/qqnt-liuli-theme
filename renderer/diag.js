// Adapted from qqnt-liuli-theme @ dda858b7.
(() => {
  const DIAG_SCHEMA = 1;
  const PLUGIN_SLUG = 'liuli-dsh-theme';
  const STYLE_ID = 'liuli-dsh-theme';
  const WALLPAPER_STYLE_ID = 'liuli-wallpaper-style';
  const FILES = [
    'wallpaper.css',
    'qq-tokens.css',
    'palette.css',
    'liuli.css',
    'typography.css',
    'panel.css',
    'settings-page.css',
    'details.css',
    'no-dividers.css',
    'input-bar.css',
    'bubbles.css',
    'layout.css',
    'lists.css',
    'motion.css',
    'markdown.css',
    'layout-custom.css',
    'integration.css'
  ];
  const OPTIONAL_FILES = ['wallpaper.css'];
  const DEFAULT_WALLPAPER = {
    css: 'wallpaper.css',
    jpg: 'wallpaper.jpg'
  };
  const WALLPAPER_KEY = 'liuli-dsh-wallpaper';
  const WALLPAPER_REV_KEY = 'liuli-dsh-wallpaper-rev';
  const AUDIT_KEY = 'liuli-dsh-wallpaper-audit';
  const ERROR_MAX = 60;
  const ERROR_ITEM_MAX = 2048;
  const ERROR_STACK_MAX = 1200;
  const AUDIT_MAX = 20;
  const AUDIT_MAX_CHARS = 4096;
  const STORAGE_EVENTS_MAX = 30;
  const STORAGE_KEYS_MAX = 80;
  const PREVIEW_MAX = 120;
  const DIAG_LOG_MAX = 4000;
  const QUOTA_PROBE_MB = [0.5, 1, 2, 4, 8, 12];
  const SENSITIVE_KEY = /token|pass|cookie|session|uid|device|guid|imei|serial/i;
  const WALLPAPER_DATAURL_BUDGET = 3.5 * 1024 * 1024;
  const PERF_MATERIAL_VARS = ['--ll-material-blur', '--ll-material-opacity', '--ll-glow-strength'];
  const PERF_MAX_ELEMENTS = 5000;
  const PERF_SCAN_BUDGET_MS = 2500;
  const PERF_FPS_SAMPLE_MS = 2000;
  const PERF_FPS_TIMEOUT_MS = 3000;
  const PERF_LONG_FRAME_MS = 50;
  const bootState = {
    startedAt: null,
    readyAt: null,
    readyMs: null,
    failed: false,
    failedMsg: ''
  };
  let runtimeInstalled = false;
  let consoleHooksInstalled = false;
  let hookDepth = 0;
  let forwardDepth = 0;
  let errors = [];
  let storageEvents = [];
  let auditMem = [];
  let ratioReader = null;
  let lastAppliedRev = '';
  let themeFailure = '';
  let panelBuild = {
    ok: null,
    error: '',
    at: null
  };
  function nowIso() {
    try {
      return new Date().toISOString();
    } catch (e) {
      return '';
    }
  }
  function safe(fn, fallback) {
    try {
      const v = fn();
      return v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function win() {
    try {
      return typeof window !== 'undefined' ? window : null;
    } catch (e) {
      return null;
    }
  }
  function doc() {
    const w = win();
    try {
      return (w && w.document) || (typeof document !== 'undefined' ? document : null);
    } catch (e) {
      return null;
    }
  }
  function ls() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    } catch (e) {}
    const w = win();
    try {
      if (w && w.localStorage) return w.localStorage;
    } catch (e) {}
    return null;
  }
  function computed(el, pseudo) {
    const w = win();
    if (!w || !el || typeof w.getComputedStyle !== 'function') return null;
    try {
      return w.getComputedStyle(el, pseudo || null);
    } catch (e) {
      return null;
    }
  }
  function clipText(text, maxLen) {
    const s = text == null ? '' : String(text);
    const n = maxLen == null ? 1000 : Math.max(0, Number(maxLen) || 0);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  function errorText(err) {
    if (!err) return '';
    try {
      if (typeof err === 'string') return err;
      const name = err.name ? String(err.name) : '';
      const msg = err.message != null ? String(err.message) : String(err);
      return name && name !== 'Error' && msg.indexOf(name) !== 0 ? name + ': ' + msg : msg;
    } catch (e) {
      return '[unprintable error]';
    }
  }
  function fmtBytes(n) {
    const v = Number(n) || 0;
    if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(2) + 'MB';
    if (v >= 1024) return (v / 1024).toFixed(1) + 'KB';
    return v + 'B';
  }
  function sanitizeText(input, maxLen) {
    let s = input == null ? '' : String(input);
    s = s.replace(
      /\b(uin|uid|skey|p_skey|bkn|pass_ticket|gtk|clientkey|token|access_token|password|passwd|cookie|secret)\b\s*[=:]\s*[^\s&;,]+/gi,
      '$1=<redacted>'
    );
    s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>');
    s = s.replace(/\bsk-[A-Za-z0-9_-]{10,}/g, 'sk-<redacted>');
    s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
    s = s.replace(/\bu_[A-Za-z0-9_-]{6,}/g, 'u_<redacted>');
    s = s.replace(
      /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{40,}/gi,
      'data:image/<redacted>'
    );
    s = s.replace(
      /(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]{160,}={0,2}/g,
      '<base64>'
    );
    return clipText(s, maxLen == null ? 1000 : maxLen);
  }
  function beginBoot() {
    bootState.startedAt = nowIso();
    bootState.readyAt = null;
    bootState.readyMs = null;
    bootState.failed = false;
    bootState.failedMsg = '';
    forwardLog({
      t: bootState.startedAt,
      level: 'info',
      scope: 'boot',
      msg: 'renderer boot started'
    });
    return getBoot();
  }
  function markBootReady() {
    const now = Date.now();
    bootState.readyAt = nowIso();
    const started = bootState.startedAt ? Date.parse(bootState.startedAt) : NaN;
    bootState.readyMs = Number.isFinite(started) ? Math.max(0, now - started) : null;
    forwardLog({
      t: bootState.readyAt,
      level: 'info',
      scope: 'boot',
      msg: 'renderer ready in ' + bootState.readyMs + 'ms'
    });
    return getBoot();
  }
  function markBootFailed(err) {
    const msg = sanitizeText(errorText(err) || '未知错误', 500);
    bootState.failed = true;
    bootState.failedMsg = msg;
    if (!bootState.readyAt) {
      bootState.readyAt = nowIso();
      const started = bootState.startedAt ? Date.parse(bootState.startedAt) : NaN;
      bootState.readyMs = Number.isFinite(started) ? Math.max(0, Date.now() - started) : null;
    }
    pushError('error', '渲染进程启动失败：' + msg, '', 'boot');
    return getBoot();
  }
  function getBoot() {
    return {
      startedAt: bootState.startedAt,
      readyAt: bootState.readyAt,
      readyMs: bootState.readyMs,
      failed: bootState.failed,
      failedMsg: bootState.failedMsg
    };
  }
  function pushError(level, msg, stack, scope) {
    const item = {
      t: nowIso(),
      level: level === 'warn' ? 'warn' : level === 'info' ? 'info' : 'error',
      msg: sanitizeText(msg || '', ERROR_ITEM_MAX),
      stack: sanitizeText(stack || '', ERROR_STACK_MAX),
      scope: String(scope || 'renderer').slice(0, 60)
    };
    try {
      errors.push(item);
      if (errors.length > ERROR_MAX) errors = errors.slice(-ERROR_MAX);
    } catch (e) {}
    forwardLog(item);
    win()?.dispatchEvent(new Event('liuli-errors'));
    return item;
  }
  function getErrors() {
    return errors.slice(-ERROR_MAX).map(e => ({
      t: e.t,
      level: e.level,
      msg: e.msg,
      stack: e.stack,
      scope: e.scope
    }));
  }
  function getErrorCount() {
    return errors.length;
  }
  function formatConsoleArgs(args) {
    const parts = [];
    const count = Math.min(args ? args.length : 0, 8);
    for (let i = 0; i < count; i++) {
      const a = args[i];
      let s;
      try {
        if (a instanceof Error) s = errorText(a);
        else if (typeof a === 'string') s = a;
        else if (typeof a === 'object' && a !== null) s = safe(() => JSON.stringify(a), String(a));
        else s = String(a);
      } catch (e) {
        s = '[unserializable]';
      }
      parts.push(clipText(s, 400));
    }
    return sanitizeText(parts.join(' '), 1500);
  }
  function firstErrorStack(args) {
    if (!args) return '';
    for (let i = 0; i < args.length && i < 8; i++) {
      const a = args[i];
      if (a && a instanceof Error && a.stack) return String(a.stack);
    }
    return '';
  }
  function installConsoleHooks() {
    if (consoleHooksInstalled) return;
    const w = win();
    if (!w || !w.console) return;
    consoleHooksInstalled = true;
    ['error', 'warn'].forEach(level => {
      const orig = w.console[level];
      if (typeof orig !== 'function' || orig.__liuliDiagHooked) return;
      const wrapped = function () {
        if (hookDepth === 0) {
          hookDepth++;
          try {
            pushError(
              level,
              formatConsoleArgs(arguments),
              firstErrorStack(arguments),
              'console.' + level
            );
          } catch (e) {
          } finally {
            hookDepth--;
          }
        }
        try {
          return orig.apply(w.console, arguments);
        } catch (e) {
          return undefined;
        }
      };
      wrapped.__liuliDiagHooked = true;
      safe(() => {
        w.console[level] = wrapped;
      }, null);
    });
  }
  function installWindowErrorHooks() {
    const w = win();
    if (!w || typeof w.addEventListener !== 'function') return;
    safe(() =>
      w.addEventListener(
        'error',
        function (ev) {
          try {
            if (!ev) return;
            const target = ev.target;
            if (target && target !== w && target.tagName) {
              const src = target.currentSrc || target.src || target.href || '';
              pushError(
                'error',
                '资源加载失败：' + target.tagName + ' ' + sanitizeText(src, 300),
                '',
                'resource'
              );
              return;
            }
            const err = ev.error;
            const msg = ev.message || (err && errorText(err)) || '未知脚本错误';
            const where = ev.filename
              ? ' (' + ev.filename + ':' + (ev.lineno || 0) + ':' + (ev.colno || 0) + ')'
              : '';
            pushError('error', msg + where, (err && err.stack) || '', 'window.onerror');
          } catch (e) {}
        },
        true
      )
    );
    safe(() =>
      w.addEventListener('unhandledrejection', function (ev) {
        try {
          const reason = ev && ev.reason;
          const msg =
            reason && reason.message
              ? reason.message
              : typeof reason === 'string'
                ? reason
                : safe(() => JSON.stringify(reason), String(reason));
          pushError(
            'error',
            '未处理的 Promise 拒绝：' + clipText(msg || '未知原因', 600),
            (reason && reason.stack) || '',
            'unhandledrejection'
          );
        } catch (e) {}
      })
    );
  }
  function installStorageTap() {
    const w = win();
    if (!w || typeof w.addEventListener !== 'function') return;
    safe(() =>
      w.addEventListener('storage', function (ev) {
        try {
          const key = ev && ev.key != null ? String(ev.key) : '';
          storageEvents.push({
            key: key,
            at: nowIso()
          });
          if (storageEvents.length > STORAGE_EVENTS_MAX)
            storageEvents = storageEvents.slice(-STORAGE_EVENTS_MAX);
        } catch (e) {}
      })
    );
  }
  function forwardLog(entry) {
    if (forwardDepth > 1) return false;
    const w = win();
    const api = safe(() => (w && w.LiuliHost) || null, null);
    if (!api || typeof api.diagLog !== 'function') return false;
    forwardDepth++;
    try {
      let e = {
        t: entry && entry.t ? String(entry.t) : nowIso(),
        level:
          entry && entry.level === 'error'
            ? 'error'
            : entry && entry.level === 'warn'
              ? 'warn'
              : 'info',
        scope: String((entry && entry.scope) || 'renderer').slice(0, 60),
        msg: sanitizeText((entry && entry.msg) || '', 1800)
      };
      if (entry && entry.stack) e.stack = sanitizeText(entry.stack, ERROR_STACK_MAX);
      if (entry && entry.extra) {
        const extra = sanitizeAuditValue(entry.extra, 0);
        const extraJson = safe(() => JSON.stringify(extra), '');
        if (extra !== undefined && extraJson && extraJson.length <= 2000) e.extra = extra;
      }
      const json = safe(() => JSON.stringify(e), '');
      if (!json) return false;
      if (json.length > DIAG_LOG_MAX) {
        e = {
          t: e.t,
          level: e.level,
          scope: e.scope,
          msg: clipText(e.msg, 800),
          extra: {
            truncated: true,
            originalLen: json.length
          }
        };
      }
      safe(() => api.diagLog(e), null);
      return true;
    } catch (e) {
      return false;
    } finally {
      forwardDepth--;
    }
  }
  function installDiagRuntime() {
    const w = win();
    if (!w)
      return {
        installed: false,
        reason: 'no window'
      };
    if (runtimeInstalled)
      return {
        installed: true,
        already: true
      };
    runtimeInstalled = true;
    installConsoleHooks();
    installWindowErrorHooks();
    installStorageTap();
    safe(() => {
      w.__liuliDiagInstalled = true;
    }, null);
    forwardLog({
      t: nowIso(),
      level: 'info',
      scope: 'runtime',
      msg:
        'diag runtime installed | href=' +
        sanitizeText(
          safe(() => String(w.location.href), ''),
          300
        )
    });
    return {
      installed: true,
      already: false
    };
  }
  function setImageRatioReader(fn) {
    ratioReader = typeof fn === 'function' ? fn : null;
  }
  function noteThemeFailure(reason) {
    themeFailure = sanitizeText(reason || '', 600);
    forwardLog({
      t: nowIso(),
      level: 'error',
      scope: 'theme',
      msg: '启动注入失败：' + (themeFailure || '未知异常')
    });
    return themeFailure;
  }
  function getThemeFailure() {
    return themeFailure;
  }
  function notePanelBuild(ok, error) {
    panelBuild = {
      ok: !!ok,
      error: sanitizeText(error || '', 600),
      at: nowIso()
    };
    forwardLog({
      t: panelBuild.at,
      level: ok ? 'info' : 'error',
      scope: 'setting',
      msg: ok ? '设置面板构建成功' : '设置面板构建失败：' + (panelBuild.error || '未知异常')
    });
    return {
      ok: panelBuild.ok,
      error: panelBuild.error,
      at: panelBuild.at
    };
  }
  function cssMarkerOf(text) {
    let s = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    let prev;
    do {
      prev = s;
      s = s.replace(/^\s+/, '').replace(/^\/\*[\s\S]*?\*\//, '');
    } while (s !== prev && s.length > 0);
    return s.slice(0, 40);
  }
  function evaluateStyleFile(name, content, styleText, meta) {
    const text = String(content == null ? '' : content);
    const marker = cssMarkerOf(text);
    const style = String(styleText == null ? '' : styleText);
    const inStyle = !!marker && style.indexOf(marker) >= 0;
    let markerOk = inStyle;
    if (!markerOk && marker) {
      const norm = s => s.replace(/\s+/g, '');
      markerOk = norm(style).indexOf(norm(marker)) >= 0;
    }
    const m = meta && typeof meta === 'object' ? meta : {};
    return {
      name: String(name || ''),
      fetchOk: m.fetchOk !== undefined ? !!m.fetchOk : true,
      status: Number(m.status) || 0,
      bytes: m.bytes !== undefined ? Number(m.bytes) || 0 : text.length,
      chars: text.length,
      optional: OPTIONAL_FILES.indexOf(String(name || '')) >= 0,
      inStyle: inStyle,
      markerOk: markerOk
    };
  }
  function styleRuleInfo(el) {
    const out = {
      present: !!el,
      len: 0,
      ruleCount: null,
      ruleReadError: '',
      sheetReadable: false
    };
    if (!el) {
      out.ruleReadError = '#liuli-dsh-theme 不存在';
      return out;
    }
    out.len = safe(() => (el.textContent || '').length, 0);
    try {
      const sheet = el.sheet;
      if (!sheet) {
        out.ruleReadError = 'style.sheet 为 null';
        return out;
      }
      const rules = sheet.cssRules;
      out.ruleCount = rules ? rules.length : 0;
      out.sheetReadable = true;
    } catch (e) {
      out.ruleReadError = errorText(e) || '读取 cssRules 失败';
    }
    return out;
  }
  function cssVarInfo() {
    const d = doc();
    const names = ['--ll-brand', '--ll-acrylic', '--ll-material-blur'];
    const out = {
      missing: []
    };
    const cs = computed(d && d.body, null);
    names.forEach(name => {
      const value = cs ? safe(() => String(cs.getPropertyValue(name) || '').trim(), '') : '';
      out[name] = value;
      if (!value) out.missing.push(name);
    });
    return out;
  }
  const PANEL_CONTROL_SELECTORS = [
    '.liuli-btn',
    '.liuli-field',
    '.liuli-slider',
    '.liuli-embedded'
  ];
  function panelInfo() {
    const d = doc();
    const embedded = safe(
      () => (d && d.getElementById ? d.getElementById('liuli-embedded') : null),
      null
    );
    const controls = PANEL_CONTROL_SELECTORS.map(selector => {
      const el = safe(() => (d && d.querySelector ? d.querySelector(selector) : null), null);
      if (!el) {
        return {
          selector: selector,
          found: false,
          borderRadius: '',
          bg: '',
          fontFamily: ''
        };
      }
      const cs = computed(el, null);
      return {
        selector: selector,
        found: true,
        borderRadius: cs ? String(cs.borderRadius || '') : '',
        bg: cs ? String(cs.backgroundColor || '') : '',
        fontFamily: cs ? String(cs.fontFamily || '').slice(0, 160) : ''
      };
    });
    const cs = embedded ? computed(embedded, null) : null;
    return {
      embeddedFound: !!embedded,
      childCount: safe(() => (embedded ? embedded.children.length : 0), 0),
      buildOk: panelBuild.ok,
      buildError: panelBuild.error,
      buildAt: panelBuild.at,
      styledControls: controls,
      panelBg: cs ? String(cs.backgroundColor || '') : '',
      panelColor: cs ? String(cs.color || '') : ''
    };
  }
  function sanitizeAuditValue(value, depth) {
    if (value === null) return null;
    const t = typeof value;
    if (t === 'number' || t === 'boolean') return value;
    if (t === 'string') return sanitizeText(value, 300);
    if (t !== 'object') return undefined;
    if (depth >= 3) return undefined;
    if (Array.isArray(value)) {
      const arr = [];
      for (let i = 0; i < value.length && i < 12; i++) {
        const item = sanitizeAuditValue(value[i], depth + 1);
        if (item !== undefined) arr.push(item);
      }
      return arr;
    }
    const out = {};
    const keys = safe(() => Object.keys(value), []).slice(0, 12);
    for (const k of keys) {
      if (k === 'src' || k === 'dataUrl' || k === 'dataURL') {
        out[k] = '<dataurl:' + safe(() => String(value[k] == null ? '' : value[k]).length, 0) + '>';
        continue;
      }
      if (SENSITIVE_KEY.test(k)) {
        out[k] = '<redacted>';
        continue;
      }
      const item = sanitizeAuditValue(value[k], depth + 1);
      if (item !== undefined) out[k] = item;
    }
    return out;
  }
  function trimAuditEntries(list, maxEntries, maxChars) {
    const limitEntries = Math.max(1, Number(maxEntries) || AUDIT_MAX);
    const limitChars = Math.max(200, Number(maxChars) || AUDIT_MAX_CHARS);
    let arr = Array.isArray(list)
      ? list.filter(x => x && typeof x === 'object').slice(-limitEntries)
      : [];
    let json = safe(() => JSON.stringify(arr), '[]') || '[]';
    while (arr.length > 0 && json.length > limitChars) {
      arr = arr.slice(1);
      json = safe(() => JSON.stringify(arr), '[]') || '[]';
    }
    return {
      arr: arr,
      json: arr.length === 0 ? '[]' : json
    };
  }
  function rememberAudit(entry) {
    try {
      auditMem.push(entry);
      if (auditMem.length > AUDIT_MAX) auditMem = auditMem.slice(-AUDIT_MAX);
      const trimmed = trimAuditEntries(auditMem);
      auditMem = trimmed.arr.slice(-AUDIT_MAX);
      const store = ls();
      if (store) safe(() => store.setItem(AUDIT_KEY, trimmed.json), null);
    } catch (e) {}
  }
  function readWallpaperAudit() {
    const store = ls();
    const persisted = safe(() => {
      if (!store) return [];
      const raw = store.getItem(AUDIT_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }, []);
    const mem = auditMem.slice(-AUDIT_MAX);
    const seen = {};
    mem.forEach(e => {
      seen[String(e.t) + '|' + String(e.action)] = 1;
    });
    const merged = mem.concat(
      persisted.filter(e => e && !seen[String(e.t) + '|' + String(e.action)])
    );
    return merged.slice(-AUDIT_MAX);
  }
  function auditEntryOf(action, extra) {
    const entry = {
      t: nowIso(),
      action: String(action || 'unknown')
    };
    if (extra && typeof extra === 'object') {
      const keys = safe(() => Object.keys(extra), []).slice(0, 24);
      for (const k of keys) {
        if (k === 'src' || k === 'dataUrl' || k === 'dataURL') continue;
        const v = sanitizeAuditValue(extra[k], 0);
        if (v !== undefined) entry[k] = v;
      }
    }
    return entry;
  }
  function auditWallpaper(action, extra) {
    let entry;
    try {
      entry = auditEntryOf(action, extra);
      if (entry.error === '') delete entry.error;
      rememberAudit(entry);
      if (entry.action === 'apply') {
        const rev = entry.rev != null ? String(entry.rev) : '';
        if (rev) lastAppliedRev = rev;
      }
      forwardAudit(entry);
    } catch (e) {
      entry = {
        t: nowIso(),
        action: String(action || 'unknown')
      };
    }
    return entry;
  }
  function forwardAudit(entry) {
    const extra = {};
    safe(() => {
      Object.keys(entry).forEach(k => {
        if (k === 't' || k === 'action') return;
        extra[k] = entry[k];
      });
    }, null);
    forwardLog({
      t: entry.t,
      level: entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'info',
      scope: 'wallpaper',
      msg: 'wallpaper:' + entry.action,
      extra: extra
    });
  }
  function mimeOf(src) {
    const m = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i.exec(src || '');
    return m ? m[1].toLowerCase() : '';
  }
  function dataUrlPrefixOf(src) {
    if (!src) return '';
    if (/^data:/i.test(src)) {
      const comma = src.indexOf(',');
      if (comma > 0) return src.slice(0, Math.min(comma + 1, 64));
    }
    return '<non-data-url>';
  }
  function wallpaperSrcOf(raw) {
    if (!raw) return '';
    try {
      if (raw.charAt(0) === '{') {
        const parsed = JSON.parse(raw);
        return parsed && parsed.src ? String(parsed.src) : '';
      }
      return String(raw);
    } catch (e) {
      return '';
    }
  }
  function describeStorageKey(k, v) {
    const key = String(k == null ? '' : k);
    const value = v == null ? '' : String(v);
    const out = {
      k: key,
      len: value.length
    };
    if (key === WALLPAPER_KEY) {
      out.dataUrl =
        /^data:image\//i.test(value) || /^\{[\s\S]*"src"\s*:\s*"data:image\//i.test(value);
      out.mime = mimeOf(wallpaperSrcOf(value));
      return out;
    }
    if (SENSITIVE_KEY.test(key)) return out;
    if (value && (value.charAt(0) === '{' || value.charAt(0) === '[')) {
      out.jsonOk = safe(() => {
        JSON.parse(value);
        return true;
      }, false);
    }
    if (!/^liuli[-_.]/i.test(key)) {
      out.previewRedacted = true;
      return out;
    }
    out.preview = sanitizeText(value, PREVIEW_MAX);
    return out;
  }
  function probeLocalStorageQuota(sizesMb) {
    const out = [];
    const store = ls();
    const sizes = Array.isArray(sizesMb) && sizesMb.length ? sizesMb : QUOTA_PROBE_MB;
    if (!store) {
      sizes.forEach(mb =>
        out.push({
          bytes: Math.round(Number(mb) * 1024 * 1024),
          ok: false,
          err: 'localStorage 不可用'
        })
      );
      return out;
    }
    const key = 'liuli-dsh-quota-probe';
    for (const mb of sizes) {
      const bytes = Math.round(Number(mb) * 1024 * 1024);
      let ok = false;
      let err = null;
      try {
        const chunk = 'x'.repeat(bytes);
        store.setItem(key, chunk);
        ok = true;
      } catch (e) {
        err = errorText(e) || 'QuotaExceededError';
      } finally {
        safe(() => store.removeItem(key), null);
      }
      out.push({
        bytes: bytes,
        ok: ok,
        err: ok ? null : err
      });
    }
    return out;
  }
  function datasetInfo() {
    const d = doc();
    const out = {};
    const ds = safe(() => (d && d.body && d.body.dataset) || null, null);
    if (!ds) return out;
    safe(() => {
      Object.keys(ds)
        .slice(0, 40)
        .forEach(k => {
          const v = ds[k];
          out[k] = typeof v === 'string' ? clipText(v, 120) : String(v);
        });
    }, null);
    return out;
  }
  function windowInfo() {
    const w = win();
    const d = doc();
    return {
      href: safe(() => String(w.location.href), ''),
      origin: safe(() => String(w.location.origin), ''),
      hash: safe(() => String(w.location.hash), ''),
      scope: safe(() => String((d.body && d.body.dataset && d.body.dataset.liuliScope) || ''), ''),
      visibility: safe(() => String(d.visibilityState), ''),
      ua: safe(() => String(w.navigator.userAgent), ''),
      language: safe(() => String(w.navigator.language), ''),
      online: safe(() => !!w.navigator.onLine, null),
      viewport: {
        w: safe(() => Number(w.innerWidth) || 0, 0),
        h: safe(() => Number(w.innerHeight) || 0, 0),
        dpr: safe(() => Number(w.devicePixelRatio) || 1, 1),
        zoom: safe(() => {
          const vv = w.visualViewport;
          return vv && vv.scale ? Math.round(vv.scale * 100) / 100 : 1;
        }, 1)
      },
      screen: {
        w: safe(() => Number(w.screen.width) || 0, 0),
        h: safe(() => Number(w.screen.height) || 0, 0),
        availW: safe(() => Number(w.screen.availWidth) || 0, 0),
        availH: safe(() => Number(w.screen.availHeight) || 0, 0)
      },
      colorScheme: safe(
        () =>
          w.matchMedia && w.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        'unknown'
      ),
      reducedMotion: safe(
        () => !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches),
        false
      )
    };
  }
  function runtimeInfo() {
    return window.LiuliHost.info;
  }
  function themeInfo() {
    const d = doc();
    const ds = datasetInfo();
    const styleTags = safe(() => {
      if (!d || typeof d.querySelectorAll !== 'function') return [];
      return Array.prototype.slice
        .call(d.querySelectorAll('style[id^="liuli"]'))
        .slice(0, 10)
        .map(el => ({
          id: String(el.id || ''),
          len: safe(() => (el.textContent || '').length, 0)
        }));
    }, []);
    const mainStyle = safe(() => (d && d.getElementById ? d.getElementById(STYLE_ID) : null), null);
    const wpStyle = safe(
      () => (d && d.getElementById ? d.getElementById(WALLPAPER_STYLE_ID) : null),
      null
    );
    const wpText = safe(() => (wpStyle && wpStyle.textContent) || '', '');
    const themeStyle = styleRuleInfo(mainStyle);
    const themeState = ds.liuliTheme || '';
    const failed = themeState === 'failed';
    return {
      dataset: ds,
      failed: failed,
      failedReason:
        themeFailure || (failed ? 'data-liuli-theme=failed（index.js 未记录具体异常）' : ''),
      bootOk: !!(bootState.readyAt && !bootState.failed),
      styleTags: styleTags,
      themeStyleLen: themeStyle.len,
      themeStyle: themeStyle,
      wallpaperStyle: {
        present: !!wpStyle,
        len: wpText.length,
        hasUrl: wpText.indexOf('url(') >= 0
      },
      files: null,
      cssVars: cssVarInfo(),
      panel: panelInfo()
    };
  }
  function appliedInfo() {
    const d = doc();
    const app = safe(() => (d && d.getElementById ? d.getElementById('app') : null), null);
    const cs = computed(app, '::before');
    const rect = safe(
      () =>
        app && typeof app.getBoundingClientRect === 'function' ? app.getBoundingClientRect() : null,
      null
    );
    const appCs = computed(app, null);
    const bgImage = cs ? String(cs.backgroundImage || '') : '';
    return {
      pseudoBgContainsUrl: bgImage.indexOf('url(') >= 0,
      pseudoBgSize: cs ? String(cs.backgroundSize || '') : '',
      pseudoBgPosition: cs ? String(cs.backgroundPosition || '') : '',
      pseudoContent: cs ? String(cs.content || '') : '',
      pseudoZIndex: cs ? String(cs.zIndex || '') : '',
      appFound: !!app,
      appSize: {
        w: rect ? Math.round(rect.width) : 0,
        h: rect ? Math.round(rect.height) : 0
      },
      appPosition: appCs ? String(appCs.position || '') : '',
      appBgAlpha: appCs ? alphaOf(appCs.backgroundColor) : null
    };
  }
  function alphaOf(color) {
    const s = String(color || '');
    if (!s) return null;
    if (s === 'transparent') return 0;
    const m = /rgba?\(([^)]+)\)/.exec(s);
    if (!m) return null;
    const parts = m[1].split(',').map(x => x.trim());
    if (parts.length >= 4) {
      const a = Number(parts[3]);
      return Number.isFinite(a) ? a : null;
    }
    return 1;
  }
  function zIndexOf(z) {
    const s = String(z == null ? '' : z);
    if (!s || s === 'auto') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  function wallpaperInfo() {
    const store = ls();
    const raw = safe(() => (store ? store.getItem(WALLPAPER_KEY) : null), null);
    const out = {
      key: WALLPAPER_KEY,
      present: !!raw,
      rawLen: raw ? raw.length : 0,
      parseOk: true,
      parseError: '',
      format: 'none',
      srcLen: 0,
      mime: '',
      dataUrlPrefix: '',
      fit: 'cover',
      area: null,
      areaValid: false,
      imageRatioCached: null,
      decodeOk: null,
      naturalWidth: null,
      naturalHeight: null,
      approxBytes: 0,
      lastAppliedAt: null,
      lastApplyScope: null,
      applied: appliedInfo(),
      defaultWallpaper: {
        wallpaperCssPresent: null,
        wallpaperJpgPresent: null
      }
    };
    if (!raw) return out;
    let src = '';
    try {
      const parsed =
        raw.charAt(0) === '{'
          ? JSON.parse(raw)
          : {
              src: raw
            };
      out.format = raw.charAt(0) === '{' ? 'json' : 'legacy-string';
      out.parseOk = true;
      src = parsed && parsed.src ? String(parsed.src) : '';
      out.fit = parsed && parsed.fit ? String(parsed.fit).slice(0, 20) : 'cover';
      out.area = parsed && parsed.area && typeof parsed.area === 'object' ? parsed.area : null;
      out.areaValid = !!(
        out.area &&
        typeof out.area.w === 'number' &&
        out.area.w > 0 &&
        out.area.w <= 1 &&
        typeof out.area.h === 'number' &&
        out.area.h > 0 &&
        out.area.h <= 1 &&
        typeof out.area.x === 'number' &&
        typeof out.area.y === 'number'
      );
    } catch (e) {
      out.parseOk = false;
      out.parseError = errorText(e) || 'JSON.parse failed';
      out.format = 'json';
    }
    out.srcLen = src.length;
    out.mime = mimeOf(src);
    out.dataUrlPrefix = dataUrlPrefixOf(src);
    out.approxBytes = Math.round(src.length * 0.75);
    if (ratioReader && src) out.imageRatioCached = safe(() => ratioReader(src), null);
    const ops = readWallpaperAudit();
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      if (op && op.action === 'apply') {
        out.lastAppliedAt = op.t || null;
        out.lastApplyScope = op.scope || null;
        break;
      }
    }
    return out;
  }
  function storageInfo() {
    const store = ls();
    const out = {
      totalChars: 0,
      keyCount: 0,
      keys: [],
      quotaProbe: [],
      revKey: ''
    };
    if (!store) {
      out.error = 'localStorage 不可用';
      return out;
    }
    try {
      const keys = [];
      const total = Number(store.length) || 0;
      for (let i = 0; i < total; i++) {
        const k = safe(() => store.key(i), null);
        if (k == null) continue;
        const v = safe(() => store.getItem(k), '');
        out.totalChars += String(k).length + (v ? v.length : 0);
        out.keyCount++;
        if (keys.length < STORAGE_KEYS_MAX) keys.push(describeStorageKey(k, v));
      }
      out.keys = keys;
      if (out.keyCount > keys.length) out.keysTruncated = out.keyCount - keys.length;
      out.revKey = safe(() => store.getItem(WALLPAPER_REV_KEY) || '', '');
    } catch (e) {
      out.error = errorText(e);
    }
    return out;
  }
  function eventsInfo() {
    let appliedRev = lastAppliedRev;
    const ops = readWallpaperAudit();
    if (!appliedRev) {
      for (let i = ops.length - 1; i >= 0; i--) {
        const op = ops[i];
        if (!op) continue;
        if (op.action === 'apply' && op.rev) {
          appliedRev = String(op.rev);
          break;
        }
      }
    }
    return {
      storage: storageEvents.slice(-20),
      lastWallpaperRev: appliedRev || '',
      wallpaperOps: ops
    };
  }
  function settingsInfo() {
    const w = win();
    const cache = safe(() => (w && w.__liuliSettingsCache) || null, null);
    if (!cache)
      return {
        present: false
      };
    const json = safe(() => JSON.stringify(cache), '');
    if (!json)
      return {
        present: true,
        jsonLen: 0,
        value: null
      };
    if (json.length <= 1500) {
      return {
        present: true,
        jsonLen: json.length,
        value: safe(() => JSON.parse(json), null)
      };
    }
    return {
      present: true,
      jsonLen: json.length,
      truncated: true,
      value: sanitizeText(json, 1500)
    };
  }
  const OVERLAY_SELECTORS = ['.container-sidebar', '.right-sidebar', '.group-box'];
  function overlaysInfo() {
    const d = doc();
    return OVERLAY_SELECTORS.map(sel => {
      const el = safe(() => (d && d.querySelector ? d.querySelector(sel) : null), null);
      if (!el)
        return {
          selector: sel,
          present: false,
          bgAlpha: null,
          zIndex: null
        };
      const cs = computed(el, null);
      return {
        selector: sel,
        present: true,
        bgAlpha: cs ? alphaOf(cs.backgroundColor) : null,
        zIndex: cs ? zIndexOf(cs.zIndex) : null
      };
    });
  }
  function domInfo() {
    const d = doc();
    const app = safe(() => (d && d.getElementById ? d.getElementById('app') : null), null);
    const cs = computed(app, '::before');
    const rect = safe(
      () =>
        app && typeof app.getBoundingClientRect === 'function' ? app.getBoundingClientRect() : null,
      null
    );
    const hasBg = !!cs && String(cs.backgroundImage || '').indexOf('url(') >= 0;
    const visiblePseudo =
      !!cs &&
      cs.display !== 'none' &&
      cs.visibility !== 'hidden' &&
      (cs.opacity === '' || Number(cs.opacity) > 0);
    return {
      readyState: safe(() => String(d.readyState), ''),
      elementCount: safe(() => {
        if (!d || typeof d.getElementsByTagName !== 'function') return 0;
        const list = d.getElementsByTagName('*');
        return list ? list.length : 0;
      }, 0),
      appBeforeVisibleHint: !!(
        app &&
        hasBg &&
        rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        visiblePseudo
      ),
      overlays: overlaysInfo()
    };
  }
  function perfNow() {
    const w = win();
    try {
      if (w && w.performance && typeof w.performance.now === 'function') return w.performance.now();
    } catch (e) {}
    return Date.now();
  }
  function visibilityInfo() {
    const d = doc();
    return {
      state: safe(() => String(d.visibilityState), ''),
      hidden: safe(() => !!d.hidden, false)
    };
  }
  function viewportInfo() {
    const w = win();
    return {
      w: safe(() => Number(w.innerWidth) || 0, 0),
      h: safe(() => Number(w.innerHeight) || 0, 0),
      dpr: safe(() => Number(w.devicePixelRatio) || 1, 1)
    };
  }
  function materialVars() {
    const d = doc();
    const cs = computed(d && d.body, null);
    const out = {};
    PERF_MATERIAL_VARS.forEach(name => {
      out[name] = cs ? safe(() => String(cs.getPropertyValue(name) || '').trim(), '') : '';
    });
    return out;
  }
  function performanceBaseInfo() {
    return {
      at: nowIso(),
      sampled: false,
      visibility: visibilityInfo(),
      viewport: viewportInfo(),
      material: materialVars(),
      backdrop: null,
      animations: null,
      fps: null,
      wallpaper: null
    };
  }
  function backdropFilterOf(cs) {
    if (!cs) return '';
    const raw = safe(() => String(cs.backdropFilter || ''), '');
    const webkit = safe(() => String(cs.webkitBackdropFilter || ''), '');
    const value = String(raw || webkit || '').trim();
    return !value || value === 'none' ? '' : value;
  }
  function elementVisible(el, cs) {
    if (!el || el.nodeType !== 1) return false;
    if (cs) {
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse')
        return false;
      if (cs.opacity !== '' && Number(cs.opacity) === 0) return false;
    }
    const rects = safe(
      () => (typeof el.getClientRects === 'function' ? el.getClientRects() : null),
      null
    );
    return !!(rects && rects.length > 0);
  }
  function countBackdropInfo() {
    const out = {
      visible: 0,
      pseudoBefore: 0,
      total: 0,
      anyBackdrop: 0,
      pseudoScanned: 0,
      scanned: 0,
      elements: 0,
      maxElements: PERF_MAX_ELEMENTS,
      truncated: false,
      budgetHit: false,
      scanMs: 0,
      note: '',
      error: ''
    };
    const d = doc();
    if (!d || typeof d.querySelectorAll !== 'function') {
      out.error = 'document.querySelectorAll 不可用';
      return out;
    }
    const all = safe(() => d.querySelectorAll('*'), null);
    if (!all) {
      out.error = '遍历 DOM 失败';
      return out;
    }
    out.elements = Number(all.length) || 0;
    const count = Math.min(out.elements, PERF_MAX_ELEMENTS);
    out.truncated = out.elements > count;
    const started = perfNow();
    for (let i = 0; i < count; i++) {
      if (perfNow() - started > PERF_SCAN_BUDGET_MS) {
        out.budgetHit = true;
        break;
      }
      const el = all[i];
      if (!el || el.nodeType !== 1) continue;
      out.scanned++;
      const cs = computed(el, null);
      const backdrop = backdropFilterOf(cs);
      if (backdrop) out.anyBackdrop++;
      const visible = elementVisible(el, cs);
      if (backdrop && visible) out.visible++;
      if (visible) {
        out.pseudoScanned++;
        const pseudo = computed(el, '::before');
        if (
          pseudo &&
          pseudo.content !== 'none' &&
          pseudo.content !== 'normal' &&
          backdropFilterOf(pseudo)
        ) {
          out.pseudoBefore++;
        }
      }
    }
    out.total = out.visible + out.pseudoBefore;
    out.scanMs = Math.round(perfNow() - started);
    if (out.budgetHit) {
      out.note = '扫描超过 ' + PERF_SCAN_BUDGET_MS + 'ms 预算，提前停止，计数可能偏小';
    } else if (out.truncated) {
      out.note =
        '元素超过 ' + PERF_MAX_ELEMENTS + ' 个上限，只统计了前 ' + PERF_MAX_ELEMENTS + ' 个';
    }
    return out;
  }
  function countRunningAnimations() {
    const d = doc();
    if (!d || typeof d.getAnimations !== 'function') return null;
    const list = safe(() => d.getAnimations(), null);
    if (!Array.isArray(list)) return null;
    let running = 0;
    for (const anim of list) {
      if (!anim) continue;
      if (safe(() => String(anim.playState || ''), '') === 'running') running++;
    }
    return {
      total: list.length,
      running: running
    };
  }
  function sampleFrameRate() {
    const out = {
      ok: false,
      hidden: false,
      sampled: false,
      partial: false,
      frames: 0,
      ms: 0,
      avgFps: null,
      worstFrameMs: null,
      longFrames: 0,
      longFrameMs: PERF_LONG_FRAME_MS,
      sampleTargetMs: PERF_FPS_SAMPLE_MS,
      timeoutMs: PERF_FPS_TIMEOUT_MS,
      error: ''
    };
    const w = win();
    const d = doc();
    out.hidden = safe(() => !!(d && d.hidden), false);
    if (!w || typeof w.requestAnimationFrame !== 'function') {
      out.error = 'requestAnimationFrame 不可用';
      return Promise.resolve(out);
    }
    if (out.hidden) {
      out.error = '页面在后台（document.hidden=true），requestAnimationFrame 不会触发，未采样';
      return Promise.resolve(out);
    }
    return new Promise(resolve => {
      let done = false;
      let frames = 0;
      let worst = 0;
      let longFrames = 0;
      let start = 0;
      let last = 0;
      const finish = reason => {
        if (done) return;
        done = true;
        safe(() => clearTimeout(timer), null);
        out.hidden = safe(() => !!(d && d.hidden), out.hidden);
        const elapsed = start && last ? last - start : 0;
        out.frames = frames;
        out.ms = Math.round(elapsed);
        if (frames > 1 && elapsed > 0) {
          out.avgFps = Math.round(((frames - 1) / (elapsed / 1000)) * 10) / 10;
          out.worstFrameMs = Math.round(worst * 10) / 10;
          out.longFrames = longFrames;
          out.partial = elapsed < PERF_FPS_SAMPLE_MS * 0.8;
          out.ok = true;
          out.sampled = true;
          resolve(out);
          return;
        }
        if (out.hidden) {
          out.error = '页面在后台（document.hidden=true），requestAnimationFrame 不会触发，未采样';
        } else if (reason === 'timeout') {
          out.error =
            '采样超时（' + PERF_FPS_TIMEOUT_MS + 'ms 内只拿到 ' + frames + ' 帧，页面可能卡死）';
        } else if (!out.error) {
          out.error = '采样期间没有拿到足够的帧（' + frames + ' 帧）';
        }
      };
      const timer = setTimeout(() => finish('timeout'), PERF_FPS_TIMEOUT_MS);
      const tick = ts => {
        if (done) return;
        const now = typeof ts === 'number' ? ts : perfNow();
        if (!start) {
          start = now;
          last = now;
          frames = 1;
        } else {
          const delta = now - last;
          last = now;
          frames++;
          if (delta > worst) worst = delta;
          if (delta > PERF_LONG_FRAME_MS) longFrames++;
        }
        if (now - start >= PERF_FPS_SAMPLE_MS) {
          finish('done');
          return;
        }
        safe(() => w.requestAnimationFrame(tick), null);
      };
      safe(() => w.requestAnimationFrame(tick), null);
    });
  }
  async function collectPerformance() {
    const started = Date.now();
    const perf = performanceBaseInfo();
    try {
      perf.fps = await sampleFrameRate();
    } catch (e) {
      perf.fps = {
        ok: false,
        hidden: false,
        sampled: false,
        frames: 0,
        avgFps: null,
        worstFrameMs: null,
        longFrames: 0,
        error: errorText(e) || '帧率采样异常'
      };
    }
    try {
      perf.backdrop = countBackdropInfo();
    } catch (e) {
      perf.backdrop = {
        visible: null,
        pseudoBefore: null,
        error: errorText(e) || 'DOM 扫描异常'
      };
    }
    try {
      perf.animations = countRunningAnimations();
    } catch (e) {
      perf.animations = null;
    }
    try {
      const wp = wallpaperInfo();
      perf.wallpaper = {
        key: wp.key,
        present: !!wp.present,
        mime: wp.mime,
        srcLen: Number(wp.srcLen) || 0,
        approxBytes: Number(wp.approxBytes) || 0,
        fit: wp.fit,
        naturalWidth: wp.naturalWidth == null ? null : wp.naturalWidth,
        naturalHeight: wp.naturalHeight == null ? null : wp.naturalHeight,
        decodeOk: wp.decodeOk == null ? null : wp.decodeOk
      };
    } catch (e) {
      perf.wallpaper = {
        error: errorText(e) || '壁纸信息采集异常'
      };
    }
    perf.visibility = visibilityInfo();
    perf.viewport = viewportInfo();
    perf.sampled = true;
    perf.sampleMs = Date.now() - started;
    return perf;
  }
  function buildSnapshot(asyncInfo) {
    const snap = {
      schema: DIAG_SCHEMA,
      generatedAt: nowIso(),
      window: windowInfo(),
      boot: getBoot(),
      runtime: runtimeInfo(),
      theme: themeInfo(),
      wallpaper: wallpaperInfo(),
      storage: storageInfo(),
      events: eventsInfo(),
      errors: getErrors(),
      settings: settingsInfo(),
      dom: domInfo(),
      performance: performanceBaseInfo()
    };
    if (asyncInfo && typeof asyncInfo === 'object') {
      if (asyncInfo.themeFiles) snap.theme.files = asyncInfo.themeFiles;
      if (asyncInfo.wallpaperDecode) {
        snap.wallpaper.decodeOk = asyncInfo.wallpaperDecode.ok;
        snap.wallpaper.naturalWidth = asyncInfo.wallpaperDecode.w;
        snap.wallpaper.naturalHeight = asyncInfo.wallpaperDecode.h;
        if (asyncInfo.wallpaperDecode.error)
          snap.wallpaper.decodeError = sanitizeText(asyncInfo.wallpaperDecode.error, 300);
      }
      if (asyncInfo.defaultWallpaper) snap.wallpaper.defaultWallpaper = asyncInfo.defaultWallpaper;
      if (Array.isArray(asyncInfo.quotaProbe)) snap.storage.quotaProbe = asyncInfo.quotaProbe;
      if (asyncInfo.performance && typeof asyncInfo.performance === 'object') {
        snap.performance = asyncInfo.performance;
        const perfWallpaper = snap.performance.wallpaper;
        const wp = snap.wallpaper || {};
        if (perfWallpaper && typeof perfWallpaper === 'object' && !perfWallpaper.error) {
          perfWallpaper.present = !!wp.present;
          perfWallpaper.srcLen = Number(wp.srcLen) || 0;
          perfWallpaper.approxBytes = Number(wp.approxBytes) || 0;
          perfWallpaper.mime = wp.mime || '';
          perfWallpaper.fit = wp.fit || 'cover';
          if (wp.naturalWidth != null) perfWallpaper.naturalWidth = wp.naturalWidth;
          if (wp.naturalHeight != null) perfWallpaper.naturalHeight = wp.naturalHeight;
          perfWallpaper.decodeOk = wp.decodeOk == null ? null : wp.decodeOk;
        }
      }
    }
    snap.checks = buildChecks(snap);
    snap.theme.checks = snap.checks;
    return snap;
  }
  function snapshot() {
    return buildSnapshot(null);
  }
  function checkFrom(level, text, id) {
    return {
      id: String(id || 'check'),
      level: level,
      text: String(text || '')
    };
  }
  function versionText(versions) {
    if (!versions || typeof versions !== 'object') return '';
    const parts = [];
    if (versions.qqnt) parts.push('QQNT ' + versions.qqnt);
    if (versions.electron) parts.push('Electron ' + versions.electron);
    return parts.join(' / ');
  }
  function buildChecks(snap) {
    const checks = [];
    const add = (level, text, id) => checks.push(checkFrom(level, text, id));
    if (!snap || typeof snap !== 'object') {
      return [checkFrom('bad', '快照生成失败：输入不是对象', 'snapshot')];
    }
    const boot = snap.boot || {};
    if (boot.failed) {
      add('bad', '渲染进程启动失败：' + clipText(boot.failedMsg || '未知原因', 300), 'boot');
    } else if (boot.readyMs != null) {
      add('ok', '渲染进程已就绪（' + boot.readyMs + ' ms）', 'boot');
    } else {
      add('warn', '渲染进程尚未就绪（启动标记未完成）', 'boot');
    }
    const theme = snap.theme || {};
    const dataset = theme.dataset || {};
    const themeState = dataset.liuliTheme || '';
    const themeStyle = theme.themeStyle || {};
    const stylePresent =
      themeStyle.present !== undefined ? !!themeStyle.present : Number(theme.themeStyleLen) > 0;
    const styleLen =
      Number(themeStyle.len !== undefined ? themeStyle.len : theme.themeStyleLen) || 0;
    const ruleCount = themeStyle.ruleCount === undefined ? null : themeStyle.ruleCount;
    const themeFailed = theme.failed === true || themeState === 'failed';
    const failedReason = String(theme.failedReason || '');
    if (themeFailed) {
      add(
        'bad',
        '主题注入失败（data-liuli-theme=failed）' +
          (failedReason
            ? '：' + clipText(failedReason, 400)
            : '，未记录具体异常（见 session.log / 错误环形缓冲）'),
        'theme-failed'
      );
    }
    if (!stylePresent || styleLen === 0) {
      add(
        'bad',
        '主题样式未注入（#liuli-dsh-theme 不存在或内容为空）' +
          (themeFailed ? '；启动注入在 FILES 循环里抛错' : '；启动可能尚未完成'),
        'theme-injected'
      );
    } else if (ruleCount === 0) {
      add(
        'bad',
        '主题样式已写入但规则数为 0（样式表解析失败或被清空，style 长度 ' +
          fmtBytes(styleLen) +
          '）',
        'theme-injected'
      );
    } else if (ruleCount === null) {
      add(
        'warn',
        '读不到 #liuli-dsh-theme.sheet.cssRules（' +
          clipText(themeStyle.ruleReadError || 'sheet 不可读', 200) +
          '），样式是否生效无法确认',
        'theme-injected'
      );
    } else {
      add(
        'ok',
        '主题样式已注入（' +
          fmtBytes(styleLen) +
          '，' +
          ruleCount +
          ' 条规则，data-liuli-theme=' +
          (themeState || '空') +
          '）',
        'theme-injected'
      );
    }
    const files = Array.isArray(theme.files) ? theme.files.filter(f => f) : null;
    if (files) {
      const isOptional = name => OPTIONAL_FILES.indexOf(name) >= 0;
      const fetchFailed = files.filter(f => !f.fetchOk && !isOptional(f.name));
      const notInjected = files.filter(f => f.fetchOk && f.inStyle === false);
      const optionalFailed = files.filter(f => !f.fetchOk && isOptional(f.name));
      if (fetchFailed.length) {
        const names = fetchFailed
          .slice(0, 6)
          .map(f => 'assets/' + f.name + '(' + (f.status || '网络错误') + ')')
          .join('、');
        add(
          'bad',
          '主题 CSS 资源加载失败：' +
            names +
            (fetchFailed.length > 6 ? ' 等 ' + fetchFailed.length + ' 个' : ''),
          'files'
        );
      }
      if (notInjected.length) {
        const names = notInjected
          .slice(0, 6)
          .map(f => 'assets/' + f.name)
          .join('、');
        add(
          'bad',
          '主题样式注入不完整：' +
            names +
            (notInjected.length > 6 ? ' 等 ' + notInjected.length + ' 个' : '') +
            ' 能加载但内容不在 <style> 里（启动注入可能中途失败）',
          'theme-files-injected'
        );
      }
      if (!fetchFailed.length && !notInjected.length) {
        const loaded = files.filter(f => f.fetchOk);
        const totalBytes = loaded.reduce((sum, f) => sum + (Number(f.bytes) || 0), 0);
        add(
          'ok',
          '全部 ' + loaded.length + ' 个主题 CSS 已加载并注入（共 ' + fmtBytes(totalBytes) + '）',
          'files'
        );
      }
      const loadedFiles = files.filter(f => f.fetchOk && Number(f.chars) > 0);
      if (loadedFiles.length && styleLen > 0) {
        const sumChars =
          loadedFiles.reduce((sum, f) => sum + (Number(f.chars) || 0), 0) +
          Math.max(0, loadedFiles.length - 1);
        const diff = Math.abs(sumChars - styleLen);
        if (diff > Math.max(2000, sumChars * 0.02)) {
          add(
            'warn',
            '样式内容与磁盘 CSS 总长度不一致（页面 ' +
              styleLen +
              ' 字符 / 磁盘 ' +
              sumChars +
              ' 字符），可能是主题更新后页面仍在使用旧样式',
            'theme-stale'
          );
        }
      }
      if (optionalFailed.length) {
        add(
          'ok',
          '没有默认壁纸资源（assets/' + DEFAULT_WALLPAPER.css + ' 不存在）；可在设置层选择图片',
          'default-wallpaper'
        );
      } else if (files.some(f => f.name === DEFAULT_WALLPAPER.css && f.fetchOk)) {
        add('ok', '默认壁纸资源存在（assets/' + DEFAULT_WALLPAPER.css + '）', 'default-wallpaper');
      }
    }
    const cssVars = theme.cssVars || {};
    const varMissing = Array.isArray(cssVars.missing) ? cssVars.missing.filter(Boolean) : [];
    if (varMissing.length) {
      add(
        'bad',
        '关键 CSS 变量缺失：' +
          varMissing.join(' / ') +
          '（样式表未生效或色板未派生，设置页会看到原生控件）',
        'theme-cssvars'
      );
    } else if (cssVars['--ll-brand']) {
      add(
        'ok',
        '关键 CSS 变量已就绪（--ll-brand=' +
          clipText(cssVars['--ll-brand'], 40) +
          '，--ll-acrylic=' +
          clipText(cssVars['--ll-acrylic'] || '', 60) +
          '，--ll-material-blur=' +
          clipText(cssVars['--ll-material-blur'] || '', 40) +
          '）',
        'theme-cssvars'
      );
    }
    const panel = theme.panel || {};
    const scopeName = (snap.window && snap.window.scope) || '';
    if (panel.embeddedFound) {
      if (panel.childCount === 0) {
        add('warn', '#liuli-embedded 存在但没有子节点（面板构建失败或未渲染）', 'theme-panel');
      }
      const btn = (Array.isArray(panel.styledControls) ? panel.styledControls : []).find(
        c => c && c.selector === '.liuli-btn'
      );
      if (btn && btn.found) {
        const radius = parseFloat(btn.borderRadius) || 0;
        const bg = String(btn.bg || '');
        const transparentBg = !bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)';
        if (radius < 6 || transparentBg) {
          add(
            'bad',
            '面板控件未套用样式：.liuli-btn 计算 border-radius=' +
              (btn.borderRadius || '空') +
              '（预期 10px），背景=' +
              (bg || '空') +
              (panel.buildOk === false
                ? '；面板构建失败：' + clipText(panel.buildError || '未知异常', 200)
                : ''),
            'theme-panel'
          );
        } else {
          add(
            'ok',
            '面板控件样式已应用（.liuli-btn radius=' + btn.borderRadius + '，背景=' + bg + '）',
            'theme-panel'
          );
        }
      } else {
        add('warn', '设置面板里没有 .liuli-btn（面板控件未构建）', 'theme-panel');
      }
    } else if (scopeName === 'setting') {
      add(
        'warn',
        '设置页没有找到 #liuli-embedded（设置面板未构建）' +
          (panel.buildOk === false
            ? '；构建异常：' + clipText(panel.buildError || '未知异常', 200)
            : ''),
        'theme-panel'
      );
    }
    const wp = snap.wallpaper || {};
    const applied = wp.applied || {};
    const mainScope = !(snap.window && snap.window.scope) || snap.window.scope === 'main';
    if (!wp.present) {
      add('ok', '未设置自定义壁纸（取色与背景使用默认值）', 'wallpaper-present');
    } else if (!wp.parseOk) {
      add(
        'bad',
        '壁纸状态解析失败：' +
          clipText(wp.parseError || 'JSON 损坏', 300) +
          '（建议在设置页重新选图）',
        'wallpaper-parse'
      );
    } else if (!wp.srcLen) {
      add('warn', '壁纸状态存在但没有图片数据（src 为空）', 'wallpaper-parse');
    } else {
      add(
        'ok',
        '壁纸已写入 localStorage（' +
          fmtBytes(wp.approxBytes) +
          '，dataURL ' +
          wp.srcLen +
          ' 字符，MIME ' +
          (wp.mime || '未知') +
          '）',
        'wallpaper-present'
      );
      if (wp.srcLen > WALLPAPER_DATAURL_BUDGET) {
        add(
          'warn',
          '壁纸 dataURL 超过 3.5MB 预算（' + fmtBytes(wp.srcLen) + '），可能写入失败或被浏览器截断',
          'wallpaper-size'
        );
      }
      if (wp.decodeOk === false) {
        add(
          'bad',
          '壁纸图片解码失败（MIME ' +
            (wp.mime || '未知') +
            '，长度 ' +
            wp.srcLen +
            '），图片可能已损坏',
          'wallpaper-decode'
        );
      } else if (wp.decodeOk === true) {
        add(
          'ok',
          '壁纸图片解码正常（' + wp.naturalWidth + '×' + wp.naturalHeight + '）',
          'wallpaper-decode'
        );
      }
      if (applied.pseudoBgContainsUrl) {
        add(
          'ok',
          '壁纸已生效：#app::before 有背景图（size=' +
            (applied.pseudoBgSize || '-') +
            '，position=' +
            (applied.pseudoBgPosition || '-') +
            '）',
          'wallpaper-applied'
        );
      } else if (!mainScope) {
        add(
          'ok',
          '当前窗口作用域是「' +
            ((snap.window && snap.window.scope) || '未知') +
            '」，不渲染壁纸；主窗口是否生效见主窗口快照',
          'wallpaper-applied'
        );
      } else if (wp.decodeOk === false) {
        add(
          'bad',
          '壁纸已保存但无法应用：#app::before 没有背景图，且图片解码失败',
          'wallpaper-applied'
        );
      } else {
        add(
          'bad',
          '壁纸已保存但 #app::before 没有背景图（CSS 未生效 / #app 不存在 / 样式被覆盖）',
          'wallpaper-applied'
        );
      }
      if (applied.appBgAlpha != null && Number(applied.appBgAlpha) >= 0.7) {
        add(
          'warn',
          '#app 背景不透明（alpha=' + applied.appBgAlpha + '），壁纸会被遮住',
          'wallpaper-covered'
        );
      }
    }
    const storage = snap.storage || {};
    const probe = Array.isArray(storage.quotaProbe) ? storage.quotaProbe.filter(p => p) : [];
    if (probe.length) {
      const okProbe = probe.filter(p => p.ok);
      if (!okProbe.length) {
        add(
          'bad',
          'localStorage 不可写：0.5MB 测试即失败（' + (probe[0].err || '未知错误') + '）',
          'storage-quota'
        );
      } else {
        const maxBytes = okProbe.reduce((m, p) => Math.max(m, Number(p.bytes) || 0), 0);
        add('ok', 'localStorage 可写，最大测试 ' + fmtBytes(maxBytes) + ' 成功', 'storage-quota');
      }
    }
    const totalChars = Number(storage.totalChars) || 0;
    if (totalChars > 0) {
      const wpShare = wp.rawLen ? Math.round((Number(wp.rawLen) / totalChars) * 100) : 0;
      add(
        totalChars > 8 * 1024 * 1024 ? 'warn' : 'ok',
        'localStorage 共 ' +
          (Number(storage.keyCount) || 0) +
          ' 个键、累计 ' +
          fmtBytes(totalChars) +
          (wp.rawLen ? '（壁纸占 ' + (wpShare > 100 ? 100 : wpShare) + '%）' : ''),
        'storage-usage'
      );
      if (totalChars > 8 * 1024 * 1024) {
        add(
          'warn',
          'localStorage 已用 ' + fmtBytes(totalChars) + '，接近配额上限，换大图可能写入失败',
          'storage-usage-high'
        );
      }
    }
    const events = snap.events || {};
    const ops = Array.isArray(events.wallpaperOps) ? events.wallpaperOps.filter(o => o) : [];
    const lastPersist = ops
      .slice()
      .reverse()
      .find(o => o.action === 'persist');
    if (lastPersist) {
      if (lastPersist.ok === false) {
        add(
          'bad',
          '最近一次壁纸写入 localStorage 失败：' + clipText(lastPersist.error || '未知错误', 300),
          'wallpaper-persist'
        );
      } else {
        add(
          'ok',
          '最近一次壁纸写入 localStorage 成功（' + fmtBytes(lastPersist.valueLen || 0) + '）',
          'wallpaper-persist'
        );
        if (lastPersist.revOk === false) {
          add(
            'warn',
            '壁纸已保存但 revision 键写入失败（' +
              clipText(lastPersist.revError || '未知错误', 200) +
              '），诊断无法核对壁纸版本',
            'wallpaper-rev-write'
          );
        }
      }
    }
    const lastEncode = ops
      .slice()
      .reverse()
      .find(o => o.action === 'encode');
    if (lastEncode) {
      if (lastEncode.ok === false) {
        add(
          'bad',
          '最近一次壁纸压缩/编码失败：' + clipText(lastEncode.error || '未知错误', 300),
          'wallpaper-encode'
        );
      } else if (lastEncode.over) {
        add(
          'warn',
          '壁纸已压到最小仍超过 3.5MB（' +
            fmtBytes(lastEncode.dataUrlLen || 0) +
            '），可能保存失败',
          'wallpaper-encode'
        );
      }
    }
    const storageEv = Array.isArray(events.storage) ? events.storage.filter(e => e) : [];
    const scope = (snap.window && snap.window.scope) || '';
    const revMismatch = !!(
      wp.present &&
      storage.revKey &&
      events.lastWallpaperRev &&
      String(storage.revKey) !== String(events.lastWallpaperRev)
    );
    if (storageEv.length) {
      const last = storageEv[storageEv.length - 1];
      add(
        'ok',
        '已收到 ' +
          storageEv.length +
          ' 次 localStorage 变更事件（最近：' +
          (last.key || '') +
          '）',
        'storage-events'
      );
    } else if (wp.present && scope === 'main' && revMismatch) {
      add(
        'warn',
        '主窗口未收到壁纸更新且 revision 不一致（storage 事件 0 次），检查窗口是否使用同一份本地存储',
        'storage-events'
      );
    }
    if (
      wp.present &&
      storage.revKey &&
      events.lastWallpaperRev &&
      String(storage.revKey) !== String(events.lastWallpaperRev)
    ) {
      add(
        'warn',
        '壁纸 revision 不一致（当前 ' +
          storage.revKey +
          ' / 已应用 ' +
          events.lastWallpaperRev +
          '），可能尚未应用最新壁纸',
        'wallpaper-rev'
      );
    }
    const errs = Array.isArray(snap.errors) ? snap.errors.filter(e => e) : [];
    if (!errs.length) {
      add('ok', '本次启动没有捕获到错误', 'errors');
    } else {
      const last = errs[errs.length - 1];
      add(
        'warn',
        '本次启动捕获到 ' +
          errs.length +
          ' 条错误/警告（最近一条：' +
          clipText(last.msg || '', 180) +
          '）',
        'errors'
      );
    }
    const dom = snap.dom || {};
    const appFound = applied.appFound === false ? false : true;
    if (!appFound) {
      add('bad', '找不到 #app 容器，QQ 结构可能已变化', 'dom-app');
    } else if (wp.present && mainScope && !dom.appBeforeVisibleHint) {
      add('warn', '#app::before 壁纸层不可见（元素/尺寸/背景图/可见性任一不满足）', 'dom-app');
    } else {
      add(
        'ok',
        '#app 与 ::before 壁纸层可见（页面元素 ' + (Number(dom.elementCount) || 0) + ' 个）',
        'dom-app'
      );
    }
    const runtime = snap.runtime || {};
    add(
      runtime.present ? 'ok' : 'bad',
      runtime.present
        ? '主题宿主已连接（' + versionText(runtime.versions || {}) + '）'
        : '主题宿主未连接',
      'runtime'
    );
    return checks;
  }
  function withTimeout(promise, ms, fallback) {
    return new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(
        () => {
          if (settled) return;
          settled = true;
          resolve(fallback);
        },
        Math.max(50, Number(ms) || 5000)
      );
      Promise.resolve(promise).then(
        value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      );
    });
  }
  async function fetchAsset(name) {
    return window.LiuliHost.readAsset(name);
  }
  async function probeFiles() {
    const d = doc();
    const styleText = safe(() => {
      const el = d && d.getElementById ? d.getElementById(STYLE_ID) : null;
      return el && el.textContent ? String(el.textContent) : '';
    }, '');
    const out = [];
    for (const name of FILES) {
      const asset = await withTimeout(fetchAsset(name), 6000, {
        name: name,
        fetchOk: false,
        status: 0,
        bytes: 0,
        text: '',
        error: '超时'
      });
      const entry = evaluateStyleFile(name, asset.text, styleText, asset);
      if (asset.error) entry.error = sanitizeText(asset.error, 200);
      out.push(entry);
    }
    return out;
  }
  async function probeDefaultWallpaper() {
    const css = await withTimeout(fetchAsset(DEFAULT_WALLPAPER.css), 6000, {
      name: DEFAULT_WALLPAPER.css,
      fetchOk: false,
      status: 0,
      bytes: 0,
      text: ''
    });
    const jpg = await withTimeout(fetchAsset(DEFAULT_WALLPAPER.jpg), 6000, {
      name: DEFAULT_WALLPAPER.jpg,
      fetchOk: false,
      status: 0,
      bytes: 0,
      text: ''
    });
    return {
      wallpaperCssPresent: !!css.fetchOk,
      wallpaperJpgPresent: !!jpg.fetchOk,
      cssBytes: Number(css.bytes) || 0,
      jpgBytes: Number(jpg.bytes) || 0,
      cssInStyle: null
    };
  }
  async function decodeCurrentWallpaper() {
    const store = ls();
    const raw = safe(() => (store ? store.getItem(WALLPAPER_KEY) : null), null);
    const src = wallpaperSrcOf(raw);
    const w = win();
    if (!src)
      return {
        skipped: true,
        ok: null,
        w: 0,
        h: 0
      };
    if (!w || typeof w.Image !== 'function')
      return {
        skipped: true,
        ok: null,
        w: 0,
        h: 0,
        error: 'Image 不可用'
      };
    const img = new w.Image();
    return withTimeout(
      new Promise(resolve => {
        let done = false;
        const finish = ok => {
          if (done) return;
          done = true;
          resolve({
            ok: ok,
            w: Number(img.naturalWidth) || 0,
            h: Number(img.naturalHeight) || 0
          });
        };
        try {
          img.onload = () => finish(true);
          img.onerror = () => finish(false);
          img.src = src;
          if (typeof img.decode === 'function')
            img
              .decode()
              .then(() => finish(true))
              .catch(() => finish(false));
        } catch (e) {
          finish(false);
        }
      }),
      8000,
      {
        ok: false,
        w: 0,
        h: 0,
        error: '解码超时'
      }
    );
  }
  async function collectDiagnostics(opts) {
    const started = Date.now();
    const o = Object.assign(
      {
        files: true,
        quota: true,
        wallpaperDecode: true,
        defaultWallpaper: true,
        performance: true,
        timeoutMs: 30000
      },
      opts && typeof opts === 'object' ? opts : {}
    );
    const asyncInfo = {};
    const tasks = [];
    if (o.files)
      tasks.push(
        probeFiles().then(v => {
          asyncInfo.themeFiles = v;
        })
      );
    if (o.defaultWallpaper)
      tasks.push(
        probeDefaultWallpaper().then(v => {
          asyncInfo.defaultWallpaper = v;
        })
      );
    if (o.wallpaperDecode)
      tasks.push(
        decodeCurrentWallpaper().then(v => {
          asyncInfo.wallpaperDecode = v;
        })
      );
    if (o.quota)
      tasks.push(
        Promise.resolve().then(() => {
          asyncInfo.quotaProbe = probeLocalStorageQuota();
        })
      );
    if (o.performance)
      tasks.push(
        collectPerformance().then(v => {
          asyncInfo.performance = v;
        })
      );
    await withTimeout(
      Promise.all(tasks.map(p => Promise.resolve(p).catch(() => null))),
      o.timeoutMs,
      null
    );
    const snap = buildSnapshot(asyncInfo);
    snap.collect = {
      ms: Date.now() - started,
      opts: {
        files: !!o.files,
        quota: !!o.quota,
        wallpaperDecode: !!o.wallpaperDecode,
        defaultWallpaper: !!o.defaultWallpaper,
        performance: !!o.performance
      }
    };
    return snap;
  }
  function selfInfo() {
    const w = win();
    const d = doc();
    return {
      href: safe(() => String(w.location.href), ''),
      hash: safe(() => String(w.location.hash), ''),
      scope: safe(() => String((d.body && d.body.dataset && d.body.dataset.liuliScope) || ''), ''),
      ua: safe(() => String(w.navigator.userAgent), ''),
      viewport: {
        w: safe(() => Number(w.innerWidth) || 0, 0),
        h: safe(() => Number(w.innerHeight) || 0, 0)
      },
      dpr: safe(() => Number(w.devicePixelRatio) || 1, 1),
      visibility: safe(() => String(d.visibilityState), ''),
      origin: safe(() => String(w.location.origin), '')
    };
  }
  function buildExportPayload(opts, snap) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const s = snap || snapshot();
    return {
      schema: DIAG_SCHEMA,
      generatedAt: nowIso(),
      opts: {
        screenshots: !!o.screenshots,
        wallpaperPreview: o.wallpaperPreview !== undefined ? !!o.wallpaperPreview : !!o.screenshots
      },
      self: selfInfo(),
      errorCount: getErrorCount(),
      windowsKnown: 1,
      snapshot: s
    };
  }
  function payloadStats(payload) {
    const json = safe(() => JSON.stringify(payload), '');
    return {
      chars: json.length,
      bytes: Math.round(json.length * 0.75),
      jsonOk: !!json
    };
  }
  if (typeof window !== 'undefined') {
    try {
      if (typeof window.__liuliDiagSnapshot !== 'function') window.__liuliDiagSnapshot = snapshot;
      if (typeof window.__liuliDiagCollect !== 'function')
        window.__liuliDiagCollect = collectDiagnostics;
      if (typeof window.__liuliDiagAudit !== 'function') window.__liuliDiagAudit = auditWallpaper;
    } catch (e) {}
  }
  window.LiuliDiag = {
    DIAG_SCHEMA,
    PLUGIN_SLUG,
    errorText,
    sanitizeText,
    beginBoot,
    markBootReady,
    markBootFailed,
    getBoot,
    getErrors,
    getErrorCount,
    installDiagRuntime,
    setImageRatioReader,
    noteThemeFailure,
    getThemeFailure,
    notePanelBuild,
    cssMarkerOf,
    evaluateStyleFile,
    trimAuditEntries,
    readWallpaperAudit,
    auditWallpaper,
    describeStorageKey,
    probeLocalStorageQuota,
    collectPerformance,
    snapshot,
    buildChecks,
    collectDiagnostics,
    selfInfo,
    buildExportPayload,
    payloadStats
  };
})();
