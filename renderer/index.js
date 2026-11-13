// Adapted from qqnt-liuli-theme @ dda858b7.
(() => {
  const motion = window.LiuliMotion;
  const {
    installLayout,
    applyAll: llLayoutPass,
    buildLayoutSection
  } = window.LiuliLayout;
  const { installArkExternal } = window.LiuliArk;
  const { ROLE_KEY, loadRoles, roleVars, accentPalette, buildRoleControls } = window.LiuliRoles;
  const {
    installDiagRuntime,
    beginBoot,
    markBootReady,
    markBootFailed,
    auditWallpaper,
    collectDiagnostics,
    getErrors,
    getErrorCount,
    buildExportPayload,
    setImageRatioReader,
    noteThemeFailure,
    notePanelBuild
  } = window.LiuliDiag;
  beginBoot();
  installDiagRuntime();
  const FILES = window.LiuliStyles.files;
  const STYLE_ID = 'liuli-dsh-theme';
  const WALLPAPER = window.LiuliHost.wallpaper;
  const OPTIONAL_FILES = new Set(['wallpaper.css']);
  const DEFAULT_SOURCE = '#1d9bf0';
  const COLOR_SOURCE_KEY = 'liuli-color-source';
  function colorSourceConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(COLOR_SOURCE_KEY) || '{}');
      const hex = typeof saved.hex === 'string' ? saved.hex.trim() : '';
      if (saved.mode === 'manual' && /^#[0-9a-f]{6}$/i.test(hex))
        return { mode: 'manual', hex: hex.toLowerCase(), exact: saved.exact === true };
      if (saved.mode === 'wallpaper' && /^#[0-9a-f]{6}$/i.test(hex))
        return { mode: 'wallpaper', hex: hex.toLowerCase(), exact: saved.exact === true };
    } catch (e) {}
    return { mode: 'wallpaper', hex: '', exact: false };
  }
  function saveColorSource(mode, hex, exact = colorSourceConfig().exact) {
    const manualHex = /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : colorSourceConfig().hex;
    const value = mode === 'manual' && manualHex
      ? { mode: 'manual', hex: manualHex, exact: !!exact }
      : { mode: 'wallpaper', hex: manualHex, exact: !!exact };
    try { localStorage.setItem(COLOR_SOURCE_KEY, JSON.stringify(value)); }
    catch (error) { toast('主题色保存失败：' + error.message); }
    window.__liuliPaletteApplied = false;
    applyDynamicPalette();
  }
  let refreshPaletteInfo = () => {};
  let refreshDiagnosticErrors = () => {};
  let refreshInputGeometry = () => {};
  window.addEventListener('liuli-errors', () => refreshDiagnosticErrors());
  function installRouteScope() {
    if (window.__liuliRouteScope) return;
    window.__liuliRouteScope = true;
    const body = document.body;
    const sync = () => {
      const hash = location.hash || '';
      const path = location.pathname || '';
      if (body.dataset.hash !== hash) body.dataset.hash = hash;
      if (body.dataset.pathname !== path) body.dataset.pathname = path;
      if (body.style.getPropertyValue('--hash') !== hash) body.style.setProperty('--hash', hash);
      if (body.style.getPropertyValue('--pathname') !== path)
        body.style.setProperty('--pathname', path);
      /* #49 / #52：通话、屏幕共享这些窗口都带原生视频层，主题不能在上面铺
       * 壁纸 / 材质 / isolation / 入场动画。除了已知的 #/av 和带 screen/share 的路由，
       * QQ 的屏幕共享壳窗口是 about:blank（hash 为空、没有 #/av），也要一并排除。 */
      const isAv =
        /^#\/av([/?]|$)/.test(hash) || /screen|share/i.test(hash.split('?')[0]) || location.protocol === 'about:';
      if ((body.dataset.liuliAv === '1') !== isAv) {
        if (isAv) body.dataset.liuliAv = '1';
        else delete body.dataset.liuliAv;
      }
      const scope =
        hash.indexOf('#/setting') === 0
          ? 'setting'
          : /^#\/(?:search|global-search)(?:[/?]|$)/i.test(hash) || /综合搜索/.test(document.title)
            ? 'search'
          : hash.indexOf('#/main') === 0
            ? 'main'
            : hash === '' || hash === '#/blank'
              ? 'boot'
              : 'aux';
      if (body.dataset.liuliScope !== scope) {
        body.dataset.liuliScope = scope;
        window.dispatchEvent(new Event('liuli-scope'));
      }
    };
    sync();
    addEventListener('liuli-route', sync);
    const titleNode = document.querySelector('title');
    if (titleNode) new MutationObserver(sync).observe(titleNode, { childList: true, characterData: true, subtree: true });
  }
  function chromaticSourceFromCanvas(ctx, w, h) {
    let px;
    try {
      px = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      return null;
    }
    let best = {
      r: 29,
      g: 155,
      b: 240,
      score: -1
    };
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i],
        g = px[i + 1],
        b = px[i + 2],
        a = px[i + 3];
      if (a < 128) continue;
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      const chroma = max - min;
      const l = (max + min) / 2;
      if (l < 35 || l > 220) continue;
      const score = chroma - Math.abs(l - 128) * 0.4;
      if (score > best.score)
        best = {
          r,
          g,
          b,
          score
        };
    }
    const hex = v => v.toString(16).padStart(2, '0');
    return '#' + hex(best.r) + hex(best.g) + hex(best.b);
  }
  function chromaOf(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16),
      g = parseInt(h.slice(2, 4), 16),
      b = parseInt(h.slice(4, 6), 16);
    return Math.max(r, g, b) - Math.min(r, g, b);
  }
  // Keep only small metadata, sharing decode work while an image is loading.
  const imageMetadata = new Map();
  const pendingImages = new Map();
  function rememberImage(src, metadata) {
    imageMetadata.delete(src);
    imageMetadata.set(src, metadata);
    while (imageMetadata.size > 4) imageMetadata.delete(imageMetadata.keys().next().value);
    return metadata;
  }
  function readImageMetadata(src) {
    const cached = imageMetadata.get(src);
    if (cached?.source) return Promise.resolve(rememberImage(src, cached));
    if (pendingImages.has(src)) return pendingImages.get(src);
    const pending = (async () => {
      const img = new Image();
      if (img.decode) {
        img.src = src;
        await img.decode();
      } else {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = src;
        });
      }
      const ratio =
        img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null;
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      let source = DEFAULT_SOURCE;
      if (ctx) {
        ctx.drawImage(img, 0, 0, size, size);
        const picked = chromaticSourceFromCanvas(ctx, size, size);
        if (picked && chromaOf(picked) >= 24) source = picked;
      }
      return rememberImage(src, { ratio, source });
    })().finally(() => pendingImages.delete(src));
    pendingImages.set(src, pending);
    return pending;
  }
  async function extractSource() {
    const src = loadWallpaperState().src || WALLPAPER;
    return src ? (await readImageMetadata(src)).source : DEFAULT_SOURCE;
  }
  const SURFACE_TONES = {
    light: {
      appBg: 98,
      low: 96,
      mid: 94,
      high: 92,
      highest: 90
    },
    dark: {
      appBg: 6,
      low: 10,
      mid: 12,
      high: 17,
      highest: 22
    }
  };
  const SCRIM = {
    low: 0.05,
    mid: 0.08,
    high: 0.11,
    highest: 0.14
  };
  function rgbTriplet(hex) {
    const h = hex.replace('#', '');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ');
  }
  function readableOn(hex) {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const linear = rgb.map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
    const light = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    return light > 0.179 ? '#000000' : '#ffffff';
  }
  function alphaComposite(fg, bg, a) {
    const ph = fg.replace('#', ''),
      bh = bg.replace('#', '');
    const out = [0, 2, 4].map(i => {
      const p = parseInt(ph.slice(i, i + 2), 16);
      const b = parseInt(bh.slice(i, i + 2), 16);
      return Math.round(a * p + (1 - a) * b)
        .toString(16)
        .padStart(2, '0');
    });
    return '#' + out.join('');
  }
  function deriveVars(mcu, theme, isDark, roles) {
    const s = isDark ? theme.schemes.dark : theme.schemes.light;
    const acc =
      roles && (roles.accent === 'secondary' || roles.accent === 'tertiary')
        ? roles.accent
        : 'primary';
    const tp = accentPalette(theme, roles);
    const neutral = theme.palettes.neutral;
    const nv = theme.palettes.neutralVariant;
    const st = SURFACE_TONES[isDark ? 'dark' : 'light'];
    const sc = t => mcu.hexFromArgb(neutral.tone(t));
    const primary = mcu.hexFromArgb(s[acc]);
    const onPrimary = mcu.hexFromArgb(s['on' + acc.charAt(0).toUpperCase() + acc.slice(1)]);
    const cLow = sc(st.low),
      cMid = sc(st.mid),
      cHigh = sc(st.high),
      cHighest = sc(st.highest);
    const glass2 = mcu.hexFromArgb(s.onSurfaceVariant);
    return {
      '--ll-brand': primary,
      '--ll-brand-rgb': rgbTriplet(primary),
      '--ll-brand-hover': mcu.hexFromArgb(tp.tone(isDark ? 76 : 44)),
      '--ll-brand-pressed': mcu.hexFromArgb(tp.tone(isDark ? 84 : 36)),
      '--ll-brand-tint': mcu.hexFromArgb(tp.tone(isDark ? 24 : 90)),
      '--ll-brand-weak': mcu.hexFromArgb(tp.tone(isDark ? 32 : 88)),
      '--ll-brand-line': mcu.hexFromArgb(tp.tone(isDark ? 48 : 60)),
      '--ll-on-brand': onPrimary,
      '--ll-on-brand-rgb': rgbTriplet(onPrimary),
      '--ll-secondary': mcu.hexFromArgb(s.secondary),
      '--ll-role-primary': mcu.hexFromArgb(s.primary),
      '--ll-role-secondary': mcu.hexFromArgb(s.secondary),
      '--ll-role-tertiary': mcu.hexFromArgb(s.tertiary),
      '--ll-tertiary': mcu.hexFromArgb(s.tertiary),
      '--ll-tertiary-container': mcu.hexFromArgb(s.tertiaryContainer),
      '--ll-on-tertiary-container': mcu.hexFromArgb(s.onTertiaryContainer),
      '--ll-secondary-container': mcu.hexFromArgb(s.secondaryContainer),
      '--ll-on-secondary-container': mcu.hexFromArgb(s.onSecondaryContainer),
      '--ll-on-glass': mcu.hexFromArgb(s.onSurface),
      '--ll-on-glass-rgb': rgbTriplet(mcu.hexFromArgb(s.onSurface)),
      '--ll-on-glass-2': glass2,
      '--ll-on-glass-2-rgb': rgbTriplet(glass2),
      '--ll-on-glass-3': mcu.hexFromArgb(nv.tone(isDark ? 66 : 40)),
      '--ll-name': mcu.hexFromArgb(s.tertiary),
      '--ll-link': primary,
      '--ll-on-glass-4': mcu.hexFromArgb(s.outlineVariant),
      '--ll-app-bg': sc(st.appBg),
      '--ll-surface-low': cLow,
      '--ll-surface-mid': cMid,
      '--ll-surface-high': cHigh,
      '--ll-surface-highest': cHighest,
      '--ll-surface-1': alphaComposite(primary, cLow, SCRIM.low),
      '--ll-surface-2': alphaComposite(primary, cMid, SCRIM.mid),
      '--ll-surface-3': alphaComposite(primary, cHigh, SCRIM.high),
      '--ll-surface-4': alphaComposite(primary, cHighest, SCRIM.highest),
      '--ll-acrylic': rgbTriplet(alphaComposite(primary, cMid, SCRIM.mid)),
      '--ll-acrylic-low': rgbTriplet(alphaComposite(primary, cLow, SCRIM.low)),
      '--ll-acrylic-high': rgbTriplet(alphaComposite(primary, cHighest, SCRIM.highest)),
      '--ll-stroke-1': mcu.hexFromArgb(s.outline),
      '--ll-stroke-2': mcu.hexFromArgb(s.outlineVariant),
      '--ll-stroke-3': mcu.hexFromArgb(nv.tone(isDark ? 40 : 80)),
      '--ll-primary-container': mcu.hexFromArgb(s.primaryContainer),
      '--ll-on-primary-container': mcu.hexFromArgb(s.onPrimaryContainer),
      '--ll-popup-bg': isDark ? sc(st.high) : sc(st.highest),
      '--ll-veil-white-rgb': rgbTriplet(sc(98)),
      '--ll-veil-black-rgb': '0, 0, 0',
      '--ll-halo-rgb': rgbTriplet(sc(98)),
      '--ll-shadow-rgb': isDark ? '0, 0, 0' : rgbTriplet(sc(10)),
      '--ll-danger': mcu.hexFromArgb(s.error),
      '--ll-danger-rgb': rgbTriplet(mcu.hexFromArgb(s.error)),
      '--ll-danger-bg': mcu.hexFromArgb(s.errorContainer),
      '--ll-on-danger': mcu.hexFromArgb(s.onError),
      '--ll-inverse-surface': mcu.hexFromArgb(s.inverseSurface),
      '--ll-inverse-on-surface': mcu.hexFromArgb(s.inverseOnSurface),
      '--ll-success': mcu.hexFromArgb(s.tertiary),
      '--ll-warn': mcu.hexFromArgb(isDark ? s.tertiaryContainer : s.tertiary)
    };
  }
  let paletteGeneration = 0;
  async function applyDynamicPalette() {
    if (window.__liuliPaletteApplied) return;
    window.__liuliPaletteApplied = true;
    const generation = ++paletteGeneration;
    const selection = colorSourceConfig();
    let source = selection.hex || DEFAULT_SOURCE;
    if (selection.mode === 'wallpaper') {
      try { source = await extractSource(); } catch (e) { source = DEFAULT_SOURCE; }
    }
    if (generation !== paletteGeneration) return;
    const mcu = window.LiuliMCU;
    const isDark = llIsDark();
    const roles = loadRoles();
    const theme = mcu.themeFromSourceColor(mcu.argbFromHex(source));
    const vars = deriveVars(mcu, theme, isDark, roles);
    try {
      Object.assign(vars, roleVars(mcu, theme, isDark, roles));
    } catch (e) {}
    if (selection.mode === 'manual' && selection.exact) {
      const onSource = readableOn(source);
      vars['--ll-role-primary'] = source;
      if (!roles.custom?.accent) {
        vars['--ll-brand'] = source;
        vars['--ll-brand-rgb'] = rgbTriplet(source);
        vars['--ll-on-brand'] = onSource;
        vars['--ll-on-brand-rgb'] = rgbTriplet(onSource);
        vars['--ll-brand-hover'] = `color-mix(in srgb, ${source} 88%, ${onSource})`;
        vars['--ll-brand-pressed'] = `color-mix(in srgb, ${source} 78%, ${onSource})`;
      }
      if (!roles.custom?.selected) {
        vars['--ll-selected'] = source;
        vars['--ll-selected-rgb'] = rgbTriplet(source);
        vars['--ll-on-selected'] = onSource;
        vars['--ll-on-selected-rgb'] = rgbTriplet(onSource);
        vars['--ll-primary-container'] = source;
        vars['--ll-on-primary-container'] = onSource;
      }
    }
    const body = document.body;
    for (const k in vars) {
      if (vars[k] === null) body.style.removeProperty(k);
      else body.style.setProperty(k, vars[k]);
    }
    body.dataset.liuliSource = source;
    body.dataset.liuliColorMode = selection.mode;
    body.dataset.liuliColorExact = String(selection.mode === 'manual' && selection.exact);
    body.toggleAttribute('data-liuli-other-solid', vars['--ll-bubble-other'] != null);
    llApplyModeSettings();
    refreshPaletteInfo();
    window.LiuliRoles.refreshControls();
    console.log(
      '[theme] wallpaper source = ' + source + ' (accent ' + vars['--ll-brand'] + ')'
    );
  }
  const elementsWithin = (root, selector) => window.LiuliDOM.within(root, selector);
  const topLevelRoots = nodes => window.LiuliDOM.roots(nodes);
  async function loadText(name) {
    const asset = await window.LiuliHost.readAsset(name);
    if (!asset.fetchOk) throw new Error('Missing theme asset: ' + name);
    return asset.text;
  }
  function ensureStyle() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    return el;
  }
  const DEFAULT_SETTINGS = {
    blur: 18,
    opacity: 0.5,
    glow: 0.15,
    shadow: 0.6,
    dimLight: 0.18,
    dimDark: 0.18,
    veilLight: 'light',
    veilDark: 'dark',
    // 置顶会话分组（#55）
    pinGroup: true,
    pinColor: false,
    pinCollapsed: false, // Legacy setting, no longer used by the list.
    hideImageNames: false,
    hideEmptyLogo: true,
    hideFileTip: true,
    stickerSend: true,
    blockUpdate: true,
    chatStyle: 'tg',
    avatarPosition: 'bottom',
    messageFontSize: 14,
    nameFontSize: 12,
    titleFontSize: 10
  };
  const DIM_MAX = 0.8;
  const DIM_FALLBACK = 0.18;
  function llNormalizeSettings(raw) {
    const cfg = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    cfg.chatStyle = ['tg', 'classic', 'tim'].includes(cfg.chatStyle) ? cfg.chatStyle : 'tg';
    cfg.avatarPosition = cfg.avatarPosition === 'top' ? 'top' : 'bottom';
    for (const [key, min, max] of [['blur', 0, 40], ['opacity', 0.1, 0.9], ['glow', 0, 1], ['shadow', 0, 1]]) {
      const n = Number(cfg[key]);
      cfg[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULT_SETTINGS[key];
    }
    for (const [key, min, max] of [['messageFontSize', 12, 24], ['nameFontSize', 10, 18], ['titleFontSize', 9, 14]]) {
      const n = Number(cfg[key]);
      cfg[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULT_SETTINGS[key];
    }
    cfg.nameFontSize = Math.min(cfg.nameFontSize, cfg.messageFontSize);
    cfg.titleFontSize = Math.min(cfg.titleFontSize, cfg.nameFontSize);
    return cfg;
  }
  async function loadSettings() {
    try {
      return llNormalizeSettings(JSON.parse(localStorage.getItem(LL_STORAGE_KEY) || '{}'));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function saveSettings(cfg) {
    try {
      localStorage.setItem(LL_STORAGE_KEY, JSON.stringify(cfg));
    } catch (error) {
      toast('保存失败：' + error.message);
    }
  }
  /* Only the main window owns the conversation list. */
  function llApplyPinGroups() {
    const api = window.__liuliPinGroups;
    if (!api || !document.body) return;
    try {
      if (document.body.dataset.liuliScope !== 'main') {
        api.clear();
        return;
      }
      const cfg = llNormalizeSettings(llModeCfg || {});
      api.apply({
        group: cfg.pinGroup !== false,
        color: cfg.pinColor === true
      });
    } catch (e) {}
  }
  async function llResetAll() {
    try {
      if (window.LiuliVideoWallpaper) await window.LiuliVideoWallpaper.clearAll();
      for (const key of Object.keys(localStorage)) {
        if (/^liuli[-_]/i.test(key)) localStorage.removeItem(key);
      }
      return true;
    } catch (error) {
      console.warn('[theme] reset failed', error);
      return false;
    }
  }
  const LL_STORAGE_KEY = 'liuli-dsh-settings';
  let llSuppressBroadcast = false;
  let llModeCfg = Object.assign({}, DEFAULT_SETTINGS);
  // 打开的面板持有同一份配置；跨窗口修改时原位更新，避免旧面板把新值覆盖回去。
  const llPanelSettings = new Set();
  let llSettingsApplied = false;
  function llDimFor(cfg, dark) {
    const v = dark ? cfg.dimDark : cfg.dimLight;
    const n = Number(v);
    return isFinite(n) && v !== null && v !== undefined ? n : DIM_FALLBACK;
  }
  function llVeilFor(cfg, dark) {
    return (dark ? cfg.veilDark : cfg.veilLight) === 'light' ? 'light' : 'dark';
  }
  const LL_VEIL_RGB = {
    light: 'var(--ll-veil-white-rgb, 255, 255, 255)',
    dark: 'var(--ll-veil-black-rgb, 0, 0, 0)'
  };
  function llApplyModeSettings() {
    const b = document.body;
    const cfg = llModeCfg || DEFAULT_SETTINGS;
    const dark = llIsDark();
    const shadow = Number(cfg.shadow);
    const s = isFinite(shadow) ? shadow : DEFAULT_SETTINGS.shadow;
    const k = dark ? 1 : 0.6;
    b.style.setProperty('--ll-wallpaper-dim', String(llDimFor(cfg, dark)));
    b.style.setProperty('--ll-veil-rgb', LL_VEIL_RGB[llVeilFor(cfg, dark)]);
    b.style.setProperty(
      '--ll-shadow',
      '0 2px 10px rgba(var(--ll-shadow-rgb), ' + (s * 0.4 * k).toFixed(2) + ')'
    );
    b.style.setProperty(
      '--ll-shadow-float',
      '0 6px 20px -6px rgba(var(--ll-shadow-rgb), ' + (s * 0.35 * k).toFixed(2) + ')'
    );
  }
  function applySettings(cfg, broadcast) {
    const b = document.body;
    const previous = llModeCfg;
    llModeCfg = llNormalizeSettings(cfg);
    const reflowMessages = !llSettingsApplied || ['chatStyle', 'avatarPosition', 'hideImageNames']
      .some(key => previous[key] !== llModeCfg[key]);
    llSettingsApplied = true;
    window.__liuliSettingsCache = llModeCfg;
    for (const panelSettings of llPanelSettings) Object.assign(panelSettings, llModeCfg);
    b.style.setProperty('--ll-material-blur', llModeCfg.blur > 0
      ? 'blur(' + llModeCfg.blur + 'px) saturate(1.8)' : 'none');
    b.style.setProperty('--ll-bubble-blur', llModeCfg.blur > 0
      ? 'blur(' + Math.min(12, llModeCfg.blur) + 'px)' : 'none');
    b.style.setProperty('--ll-material-opacity', String(llModeCfg.opacity));
    b.style.setProperty('--ll-glow-strength', String(llModeCfg.glow));
    b.toggleAttribute('data-liuli-hide-image-names', llModeCfg.hideImageNames === true);
    llSyncUpdateGuard();
    window.LiuliChatExtras?.configure({
      hideFileTip: llModeCfg.hideFileTip !== false,
      stickerSend: llModeCfg.stickerSend !== false
    });
    b.toggleAttribute('data-liuli-hide-empty-logo', llModeCfg.hideEmptyLogo !== false);
    b.dataset.liuliChatStyle = llModeCfg.chatStyle;
    b.dataset.liuliAvatarPosition = llModeCfg.avatarPosition;
    b.style.setProperty('--ll-message-font-size', llModeCfg.messageFontSize + 'px');
    b.style.setProperty('--ll-name-font-size', llModeCfg.nameFontSize + 'px');
    b.style.setProperty('--ll-title-font-size', llModeCfg.titleFontSize + 'px');
    llApplyModeSettings();
    if (reflowMessages) {
      moveSenderIntoBubble(document);
      groupMessages();
      scheduleStick();
    }
    if (broadcast !== false && !llSuppressBroadcast) {
      try {
        localStorage.setItem(LL_STORAGE_KEY, JSON.stringify(llModeCfg));
      } catch (e) {}
    }
    llApplyPinGroups();
    // 只刷新显示，不触发 input/change，避免收到跨窗口更新后再次广播旧配置。
    for (const control of document.querySelectorAll('[data-liuli-setting]')) {
      const value = llModeCfg[control.dataset.liuliSetting];
      if (control.matches('input[type="range"]')) {
        control.value = value;
        const ratio = (Number(value) - Number(control.min)) / (Number(control.max) - Number(control.min));
        control.style.setProperty('--liuli-pct', Math.max(0, Math.min(100, ratio * 100)) + '%');
        const output = control.parentElement.querySelector('.liuli-field__value');
        if (output) output.textContent = value + 'px';
      } else {
        for (const button of control.querySelectorAll('button[data-setting-value]')) {
          button.classList.toggle('is-active', button.dataset.settingValue === String(value));
        }
      }
    }
  }
  try {
    window.addEventListener('storage', function (e) {
      if (e.key !== LL_STORAGE_KEY || !e.newValue) return;
      try {
        const incoming = llNormalizeSettings(JSON.parse(e.newValue));
        llSuppressBroadcast = true;
        applySettings(incoming, false);
        const sliders = document.querySelectorAll('.liuli-slider:not(.liuli-type-slider)');
        if (sliders.length === FIELDS.length) {
          FIELDS.forEach(function (f, i) {
            const el = sliders[i];
            if (el && Number(el.value) !== Number(incoming[f.key])) {
              el.value = incoming[f.key];
              el.dispatchEvent(new Event('input'));
            }
          });
        }
        llRefreshVeilSegs(incoming);
      } catch (err) {
      } finally {
        llSuppressBroadcast = false;
      }
    });
  } catch (e) {}
  let llVeilSegRefreshers = [];
  function llRefreshVeilSegs(cfg) {
    const c = cfg || llModeCfg;
    for (const fn of llVeilSegRefreshers) {
      try {
        fn(c);
      } catch (e) {}
    }
  }
  const FIELDS = [
    {
      key: 'blur',
      label: '材质模糊',
      min: 0,
      max: 40,
      step: 1,
      unit: 'px',
      hint: '玻璃层的 backdrop-filter 半径'
    },
    {
      key: 'opacity',
      label: '不透明度',
      min: 0.1,
      max: 0.9,
      step: 0.01,
      unit: '',
      hint: '玻璃底有多实。过低会影响可读性',
      pct: v => ((v - 0.1) / 0.8) * 100
    },
    {
      key: 'glow',
      label: '泛光强度',
      min: 0,
      max: 1,
      step: 0.01,
      unit: '',
      hint: '主题色在边缘的发光量',
      pct: v => v * 100
    },
    {
      key: 'shadow',
      label: '阴影强度',
      min: 0,
      max: 1,
      step: 0.01,
      unit: '',
      hint: '玻璃卡片的投影浓度',
      pct: v => v * 100
    },
    {
      key: 'dimLight',
      veilKey: 'veilLight',
      label: '亮色主题遮罩',
      min: 0,
      max: DIM_MAX,
      step: 0.01,
      unit: '',
      hint: '亮色主题下盖在壁纸上的遮罩。过低会影响可读性',
      pct: v => (v / DIM_MAX) * 100
    },
    {
      key: 'dimDark',
      veilKey: 'veilDark',
      label: '暗色主题遮罩',
      min: 0,
      max: DIM_MAX,
      step: 0.01,
      unit: '',
      hint: '暗色主题下盖在壁纸上的遮罩。过低会影响可读性',
      pct: v => (v / DIM_MAX) * 100
    }
  ];
  function toast(text) {
    let el = document.getElementById('liuli-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'liuli-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 1600);
  }
  function moveSenderIntoBubble(root) {
    try {
      var containers = elementsWithin(root, '.message-container');
      for (var i = 0; i < containers.length; i++) {
        var mc = containers[i];
        var bubble = mc.querySelector('.msg-content-container');
        if (!bubble) continue;
        // #47：按正文结构识别纯图片，不能只认 QQ 偶尔才添加的 --pic 类。
        // 混合文字、引用或卡片消息仍保留昵称，避免隐藏发送者上下文。
        var content = bubble.querySelector('.message-content');
        var imageOnly = !!(content && content.querySelector('.pic-element') &&
          !content.querySelector('.text-element, .reply-element, .ark-view-message, .forward-msg, .video-element'));
        if (imageOnly !== bubble.hasAttribute('data-liuli-image-only')) {
          bubble.toggleAttribute('data-liuli-image-only', imageOnly);
        }
        mc.toggleAttribute('data-liuli-image-only', imageOnly);
        var name = mc.querySelector('.user-name');
        if (!name) continue;
        if (llModeCfg.chatStyle !== 'tg') {
          // 经典 / TIM 使用 QQ 原生 nickname 网格区，保留原节点与事件。
          if (name.parentElement !== mc) mc.appendChild(name);
          delete bubble.dataset.liuliNamed;
        } else if (!bubble.contains(name)) {
          bubble.insertBefore(name, bubble.firstChild);
          bubble.dataset.liuliNamed = '1';
        }
      }
    } catch (e) {}
  }
  function activeChatRoot() { return window.LiuliComposer.viewport() || window.LiuliDOM.visibleQuery('.chat-msg-area') || document; }
  function groupMessages() {
    try {
      var list = activeChatRoot().querySelectorAll('.message-container');
      if (list.length === 0) return;
      var records = new WeakMap();
      function recordOf(mc) {
        if (records.has(mc)) return records.get(mc);
        var record = null;
        try { record = window.LiuliQQ?.messageRecord(mc) || null; } catch (e) {}
        records.set(mc, record);
        return record;
      }
      function keyOf(mc) {
        var record = recordOf(mc);
        var sender = record && (record.senderUid || record.senderUin);
        if (sender) return [record.chatType, record.peerUid || record.peerUin, sender].join(':');
        var av = mc.querySelector(':scope > .avatar-span');
        var lbl = av && av.getAttribute('aria-label');
        if (lbl) return lbl;
        var nick = mc.querySelector('.user-name > .text-ellipsis');
        if (nick) {
          var t = (nick.textContent || '').trim();
          if (t) return t;
        }
        var img = mc.querySelector('[class*="avatar"] img');
        if (img && img.src) return img.src;
        return '';
      }
      function adjacent(a, b) {
        if (!a || !b || a.closest('.chat-msg-area') !== b.closest('.chat-msg-area')) return false;
        var ra = recordOf(a), rb = recordOf(b);
        if (rb && rb.showTimestamp) return false;
        var ta = Number(ra && ra.msgTime), tb = Number(rb && rb.msgTime);
        if (ta > 0 && tb > 0 && (tb < ta || tb - ta > 300)) return false;
        var rowA = a.closest('.ml-item'), rowB = b.closest('.ml-item');
        // 原生列表中的系统提示、撤回行和时间分隔不能被同一发送者的分组合并跨过。
        if (rowA && rowB && rowA !== rowB && rowA.nextElementSibling !== rowB) return false;
        return true;
      }
      var keys = [];
      for (var i = 0; i < list.length; i++) keys.push(keyOf(list[i]));
      for (var j = 0; j < list.length; j++) {
        var mc = list[j];
        var key = keys[j];
        if (!key) {
          mc.dataset.liuliG = '';
          continue;
        }
        var grouped = llModeCfg.chatStyle !== 'classic';
        var prevSame = grouped && j > 0 && keys[j - 1] === key && adjacent(list[j - 1], mc);
        var nextSame = grouped && j < list.length - 1 && keys[j + 1] === key && adjacent(mc, list[j + 1]);
        var g;
        if (!prevSame && !nextSame) g = 'single';
        else if (!prevSame && nextSame) g = 'first';
        else if (prevSame && nextSame) g = 'mid';
        else g = 'last';
        if (mc.dataset.liuliG !== g) mc.dataset.liuliG = g;
        // bubbles.css: grouped rows lose the native bottom padding of .message
        var native = mc.parentElement;
        var message = native && native.classList.contains('message-native') ? native.parentElement : null;
        if (message && !message.hasAttribute('data-liuli-grouped')) message.setAttribute('data-liuli-grouped', '');
      }
    } catch (e) {}
  }
  /* 吸底头像：一组连续消息的头像贴在这一组的最后一条旁边；这一组跨过视口底边时，
   * 头像跟着停在底边上方。只有跨过底边的那一组需要位移，其余一律为 0。
   * 以前每一帧都对视口里每个气泡取 getBoundingClientRect；现在二分找到跨底边的那一行，
   * 只读这一组，每帧十几次读取，与消息数量无关。 */
  var llShiftedAvatars = new Set();
  function llSetAvatar(av, ty) {
    var t = String(ty);
    if (ty) llShiftedAvatars.add(av);
    else llShiftedAvatars.delete(av);
    if ((av.dataset.liuliTy || '0') === t) return;
    if (ty) {
      av.dataset.liuliTy = t;
      av.style.transform = 'translateY(' + t + 'px)';
    } else {
      delete av.dataset.liuliTy;
      av.style.transform = '';
    }
  }
  function stickAvatars() {
    try {
      var vp =
        window.LiuliComposer.viewport() || window.LiuliDOM.visibleQuery('.chat-msg-area');
      if (!vp) return;
      if (llModeCfg.avatarPosition === 'top' || llModeCfg.chatStyle === 'classic') {
        for (const avatar of vp.querySelectorAll('.avatar-span[data-liuli-ty]')) llSetAvatar(avatar, 0);
        return;
      }
      var list = vp.getElementsByClassName('message-container');
      var n = list.length;
      var keep = null;
      if (n) {
        var vr = vp.getBoundingClientRect();
        /* 输入框浮在消息视口上面：吸底的头像以输入框上沿为底，而不是被它盖住的视口底边。 */
        var vBottom = vr.bottom;
        var composer = window.LiuliComposer.area();
        if (composer) {
          var cr = composer.getBoundingClientRect();
          if (cr.height > 0 && cr.top < vr.bottom && cr.bottom > vr.top) vBottom = cr.top - 4;
        }
        var bubbleOf = function (mc) {
          return mc.querySelector(':scope > .message-content__wrapper') || mc.querySelector('.msg-content-container');
        };
        var cache = new Map();
        var rectAt = function (d) {
          if (cache.has(d)) return cache.get(d);
          var b = bubbleOf(list[d]);
          var r = b ? b.getBoundingClientRect() : null;
          if (r && r.height < 1) r = null;
          cache.set(d, r);
          return r;
        };
        var first = rectAt(0),
          last = rectAt(n - 1);
        var reversedDom = !!(first && last && first.top > last.top);
        var dom = function (k) { return reversedDom ? n - 1 - k : k; };
        // first row (visual order, top to bottom) whose bubble reaches the line
        var lo = 0, hi = n;
        while (lo < hi) {
          var mid = (lo + hi) >> 1;
          var r = rectAt(dom(mid));
          if (!r || r.bottom > vBottom - 4) hi = mid;
          else lo = mid + 1;
        }
        if (lo < n) {
          var d = dom(lo);
          var g = function (i) { return list[i] && list[i].dataset.liuliG; };
          var start = d, end = d;
          while (start > 0 && (g(start) === 'mid' || g(start) === 'last')) start--;
          while (end < n - 1 && (g(end) === 'first' || g(end) === 'mid')) end++;
          var mc = list[end];
          var av = mc && mc.querySelector(':scope > .avatar-span');
          var br = rectAt(end), gr = rectAt(start);
          if (av && br && gr && (g(end) === 'last' || g(end) === 'single')) {
            var h = av.offsetHeight || 32;
            var natBottom = br.bottom,
              natTop = natBottom - h;
            var ty = natBottom > vBottom - 4 ? vBottom - 4 - natBottom : 0;
            var minTy = gr.top - natTop;
            if (ty < minTy) ty = minTy;
            if (ty > 0) ty = 0;
            ty = Math.round(ty);
            if (ty) keep = av;
            llSetAvatar(av, ty);
          }
        }
      }
      for (const av of [...llShiftedAvatars]) if (av !== keep) llSetAvatar(av, 0);
    } catch (e) {}
  }
  var liuliStickRaf = 0;
  function scheduleStick() {
    if (liuliStickRaf || document.hidden) return;
    liuliStickRaf = requestAnimationFrame(function () {
      liuliStickRaf = 0;
      stickAvatars();
    });
  }
  function installAvatarStick() {
    if (window.__liuliStickInstalled) return;
    window.__liuliStickInstalled = true;
    document.addEventListener(
      'scroll',
      function (e) {
        var t = e.target;
        if (t && t.closest && !t.closest('.chat-msg-area')) return;
        if (t && t.closest) motion.moving(t.closest('.aio') || t);
        scheduleStick();
      },
      {
        capture: true,
        passive: true
      }
    );
    window.addEventListener('resize', scheduleStick);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(liuliStickRaf);
        liuliStickRaf = 0;
      } else {
        scheduleStick();
      }
    });
  }
  var LL_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  function llNorm(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }
  function llRecentSpeakers() {
    var list = activeChatRoot().querySelectorAll('.message-container');
    var out = {},
      rank = 0;
    for (var i = list.length - 1; i >= 0 && rank < 12 && i >= list.length - 60; i--) {
      var mc = list[i];
      if (mc.classList.contains('message-container--self') || mc.querySelector('.container--self'))
        continue;
      var av = mc.querySelector(':scope > .avatar-span');
      var n = llNorm(av && av.getAttribute('aria-label'));
      if (!n || Object.prototype.hasOwnProperty.call(out, n)) continue;
      out[n] = rank++;
    }
    return out;
  }
  /* #32.1b：当前群的稳定标识，给「管理人数」缓存当桶名。
   * 旧版直接取 `.chat-header .panel-header__title` 的整段文本，两个问题：
   *   1) 取不到时 llNorm() 返回 ""，所有群共用 llGM.staff[""] 同一个桶 → 人数串号；
   *   2) 标题里带着成员数「(260)」，有人进群 key 就变，缓存白丢。
   * 现在优先用会话列表选中项的 data-contact-id（切群才变）；
   * 但选中项可能比聊天标题晚一拍更新，名字对不上就不用，免得把人数写进别的群。
   * 退一级用标题里的群名（.chat-header__contact-name，不含成员数）。
   * 都取不到返回 ""——调用方据此跳过缓存（只按本次渲染结果展示）。 */
  function llGroupKey() {
    var name = '';
    try {
      var h = document.querySelector('.chat-header .chat-header__contact-name');
      name = llNorm((h && (h.getAttribute('aria-label') || h.textContent)) || '').replace(
        /\(\s*\d+\s*\)\s*$/,
        ''
      );
    } catch (e) {}
    try {
      var items = document.querySelectorAll('.recent-contact-item--selected[data-contact-id]');
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        if (el.closest && el.closest('.viewport-list__measure')) continue;
        var id = el.getAttribute('data-contact-id');
        if (!id) continue;
        if (name && llNorm(el.textContent).indexOf(name) < 0) continue; // 名字对不上：多半还没切过去
        return 'c:' + id;
      }
    } catch (e) {}
    return name ? 'n:' + name : '';
  }
  var llGM = { key: null, staff: {} }; // staff: key -> { n: 人数, exact: 是否确定完整 }
  function llGroupMembersPass() {
    try {
      var gm = window.LiuliDOM.visibleQuery('.group-member');
      if (!gm) {
        llGM.key = null;
        return;
      }
      var rows = gm.querySelectorAll('.group-user');
      if (!rows.length) return;
      // #32.1b：换群判据换成稳定 key（会话 id / 群名）。以前用整段标题文本，
      // 标题里带着成员数「(260)」——人数一变化就被误判成"换群"。
      var key = llGroupKey();
      var host = gm.querySelector('.group-member-list') || gm;
      var sig = function () {
        return Array.prototype.slice
          .call(host.querySelectorAll('.group-user__name'), 0, 6)
          .map(function (n) {
            return n.textContent;
          })
          .join('|');
      };
      if (key && key !== llGM.key) {
        var first = !llGM.seen;
        llGM.seen = true;
        llGM.key = key;
        if (first) {

        } else {
          llGM.pendingSig = sig();
          llGM.pendingAt = Date.now();
        }
      } else if (llGM.pendingSig != null) {
        var now = sig();
        if (now !== llGM.pendingSig) {
          llGM.pendingSig = null;

        } else if (Date.now() - llGM.pendingAt > 1500) {
          llGM.pendingSig = null;
        }
      }
      // 标题「群聊成员 N」里的 N，用来判断整张列表是否都渲染出来了
      var totalM = /(\d+)/.exec((gm.querySelector('.group-member-title') || {}).textContent || '');
      var total = totalM ? Number(totalM[1]) : 0;
      var byIdx = {};
      rows.forEach(function (r) {
        var i = Number(r.getAttribute('data-index'));
        if (!isNaN(i)) byIdx[i] = r;
      });
      var isStaff = function (r) {
        return !!(r && r.querySelector('.group-member-label'));
      };
      var inBlock = {};
      var blockEnd = -1; // 管理团队之后第一个普通成员的 index；-1 表示还没渲染到
      var started = !!byIdx[0]; // 第 0 行在不在：在才谈得上"从头数管理块"
      var j = 0;
      if (started) {
        while (byIdx[j]) {
          if (isStaff(byIdx[j])) {
            inBlock[j] = true;
            j++;
            continue;
          }
          var more = false;
          for (var k = 1; k <= 3 && byIdx[j + k]; k++)
            if (isStaff(byIdx[j + k])) {
              more = true;
              break;
            }
          if (j > 0 && more) {
            inBlock[j] = true;
            j++;
            continue;
          }
          break;
        }
        if (byIdx[j]) blockEnd = j;
        // #63：小群里所有人都是群主 / 管理员时，管理块后面没有普通成员，上面永远找不到块尾，
        // 计数一直只是「至少 N」。整张列表都渲染出来了（行数 = 标题里的群人数）就是精确值。
        else if (total > 0 && j >= total) blockEnd = j;
      }
      // 第 0 行没渲染（列表滚下去了）时没法确定整块范围，退回只看自己有没有管理员标签
      var staffAt = function (i) {
        return started ? !!inBlock[i] : isStaff(byIdx[i]);
      };
      Object.keys(byIdx).forEach(function (key2) {
        var i = Number(key2),
          r = byIdx[i];
        var g = '';
        if (staffAt(i)) {
          var prev = i > 0 && (byIdx[i - 1] ? staffAt(i - 1) : true);
          var next = byIdx[i + 1] ? staffAt(i + 1) : true;
          g = !prev && !next ? 'single' : !prev ? 'first' : !next ? 'last' : 'mid';
        }
        if ((r.dataset.liuliStaff || '') !== g) {
          if (g) r.dataset.liuliStaff = g;
          else delete r.dataset.liuliStaff;
        }
      });
      /* 管理人数（#32.1b）：只数带管理员标签的行。
       *  - blockEnd >= 0：管理块整块都渲染出来了 → 精确值，写缓存；
       *  - 只渲染到块中间（大群分批/虚拟渲染）：这只能算「至少 N」，显示成 "N+"，
       *    绝不写死成精确值——v1.3.2 对 #22 的修补就回归在这里：首屏只看到一个
       *    管理员就把 1 缓存下来，之后很难再被覆盖，于是「22 人只显示 1 人」；
       *  - 第 0 行都没渲染（列表滚下去了）→ 什么都别猜：有缓存用缓存，没有就空着。
       * key 为空（拿不到会话 id / 群名）时既不读也不写缓存，避免所有群共用
       * llGM.staff[""] 一个桶导致人数串号。 */
      // #63：刚切群时 QQ 先换标题、过一会儿才换成员行，这段时间里的行还是上一个群的
      // （pendingSig 就是在等这件事）。这时不写缓存，只显示新群自己的缓存，
      // 否则上一个群的人数会以「精确值」写进新群，小群里再也覆盖不掉。
      var stale = llGM.pendingSig != null || (total > 0 && j > total);
      var exact = blockEnd >= 0 && !stale;
      var counted = 0;
      for (var m = 0; m < (exact ? blockEnd : j); m++)
        if (byIdx[m] && isStaff(byIdx[m])) counted++;
      var rec = key ? llGM.staff[key] : null;
      if (key && started && !stale) {
        if (exact) {
          rec = { n: counted, exact: true };
          llGM.staff[key] = rec;
        } else if (counted > 0 && (!rec || (!rec.exact && counted > rec.n))) {
          rec = { n: counted, exact: false }; // 只是"至少 N"，不能盖掉已知的精确值
          llGM.staff[key] = rec;
        }
      }
      var span = gm.querySelector('.group-member-title > span');
      var showN = 0,
        showExact = false;
      if (stale) {
        if (rec && rec.n > 0) {
          showN = rec.n;
          showExact = !!rec.exact;
        }
      } else if (started && exact) {
        showN = counted;
        showExact = true;
      } else if (rec && rec.n > 0) {
        showN = rec.n;
        showExact = !!rec.exact;
      } else if (started && counted > 0) {
        showN = counted;
        showExact = false;
      }
      if (total > 0 && showN > total) {
        showN = 0;
        if (key) delete llGM.staff[key];
      }
      if (span) {
        var want = showN > 0 ? (showExact ? String(showN) : showN + '+') : '';
        if ((span.dataset.liuliStaff || '') !== want) {
          if (want) span.dataset.liuliStaff = want;
          else delete span.dataset.liuliStaff;
        }
        var title = span.parentElement;
        var countNode = title.querySelector(':scope > .liuli-staff-count');
        if (!countNode) {
          countNode = document.createElement('span');
          countNode.className = 'liuli-staff-count';
          title.appendChild(countNode);
        }
        var label = want ? '管理 ' + want : '';
        if (countNode.textContent !== label) countNode.textContent = label;
      }
      var recent = llRecentSpeakers();
      rows.forEach(function (r) {
        var nm = r.querySelector('.group-user__name');
        var name = llNorm(nm && nm.textContent);
        var rank = Object.prototype.hasOwnProperty.call(recent, name) ? recent[name] : -1;
        var v = rank < 0 ? '' : rank < 3 ? 'hot' : '1';
        if ((r.dataset.liuliActive || '') !== v) {
          if (v) r.dataset.liuliActive = v;
          else delete r.dataset.liuliActive;
        }
      });
    } catch (e) {}
  }
  function liuliMessagePass(roots) {
    for (const root of roots) {
      moveSenderIntoBubble(root);
      markQuoteRoots(root);
      llMarkdownPass(root);
      llAtPass(root);
      window.LiuliCards.adapt(root);
    }
    groupMessages();
    scheduleStick();
  }
  var llMsgSeen = {
    chat: null,
    max: null
  };
  /* 会话标识只读节点与文字，不读几何：这里每批新消息行都会调用，
   * 以前用 visibleQuery 取标题位置，每次都逼浏览器在消息插入后同步重排整页。 */
  function llChatKey() {
    var pane = window.LiuliComposer.area()?.closest('.aio,.chat-container,.two-col-layout__main');
    if (!pane) return '';
    var t = pane.querySelector('.chat-header .panel-header__title');
    if (!llPaneIds.has(pane)) llPaneIds.set(pane, ++llPaneSeq);
    return llPaneIds.get(pane) + '|' + (t ? (t.textContent || '').replace(/\s+/g, ' ').trim() : '');
  }
  var llUpdateGuardSent = null;
  // 只由主窗口告诉主进程，避免每个独立窗口重复写同一个文件。
  function llSyncUpdateGuard() {
    if (document.body.dataset.liuliScope !== 'main' || !window.LiuliHost?.updateGuard) return;
    const want = llModeCfg.blockUpdate !== false;
    if (llUpdateGuardSent === want) return;
    llUpdateGuardSent = want;
    window.LiuliHost.updateGuard(want)
      .then(report => { window.__liuliUpdateGuard = report; })
      .catch(() => { llUpdateGuardSent = null; });
  }
  window.addEventListener('liuli-scope', () => llSyncUpdateGuard());
  var llPaneIds = new WeakMap(),
    llPaneSeq = 0;
  function llMsgId(el) {
    try {
      return el && /^\d+$/.test(el.id) ? BigInt(el.id) : null;
    } catch (e) {
      return null;
    }
  }
  /* 新消息（收到或自己发出）：TG 式整列上推 + 气泡淡入。
   * 打开会话、翻历史加载出来的旧消息不做任何动画，原样立刻显示。 */
  function llMotionPass(added) {
    try {
      const key = llChatKey();
      if (key !== llMsgSeen.chat) {
        llMsgSeen.chat = key;
        let max = null;
        for (const item of activeChatRoot().querySelectorAll('.ml-item[id]')) {
          const id = llMsgId(item);
          if (id !== null && (max === null || id > max)) max = id;
        }
        llMsgSeen.max = max;
        return;
      }
      if (!added || !added.length) return;
      const fresh = [];
      for (const item of added) {
        const id = llMsgId(item);
        if (id === null || (llMsgSeen.max !== null && id <= llMsgSeen.max)) continue;
        if (!item.isConnected) continue;
        llMsgSeen.max = id;
        fresh.push(item);
      }
      if (fresh.length && motion.arrive(fresh, window.LiuliComposer.scroller()))
        setTimeout(scheduleStick, 340);
    } catch (e) {}
  }

  function installPageObserver() {
    const runtime = window.LiuliRuntime.install({
      root: root => window.LiuliSurfaces.apply(root),
      structure: () => llApplyPinGroups(),
      layout: () => { mountSettingsEntry(); llLayoutPass(); },
      geometry: () => {
        const nodes = window.LiuliComposer.refresh();
        window.LiuliDock.refresh();
        scheduleStick();
        return nodes;
      },
      messages: (changed, added) => {
        liuliMessagePass(topLevelRoots(changed.map(root => root.closest('.ml-item') || root)));
        llMotionPass(added);
      },
      side: () => { llGroupMembersPass(); window.__liuliPinGroups.sync(); },
      records: records => window.LiuliComposer.records(records),
      hidden: () => { llMsgSeen.chat = null; }
    });
    refreshInputGeometry = () => runtime.invalidate();
  }
  function markQuoteRoots(root) {
    try {
      var all = elementsWithin(
        root,
        '.chat-msg-area :is([class*="reply"], [class*="quote"]):not([data-liuli-quote-root])'
      );
      for (var i = 0; i < all.length; i++) {
        if (all[i].dataset.liuliQuoteRoot !== '0') all[i].dataset.liuliQuoteRoot = '0';
      }
      var roots = elementsWithin(root, '.reply-element');
      var stale = elementsWithin(root, '[data-liuli-quote-root="1"]:not(.reply-element)');
      for (var s = 0; s < stale.length; s++) stale[s].dataset.liuliQuoteRoot = '0';
      for (var j = 0; j < roots.length; j++) {
        if (roots[j].dataset.liuliQuoteRoot !== '1') roots[j].dataset.liuliQuoteRoot = '1';
      }
    } catch (e) {}
  }
  const LL_WALLPAPER_KEY = 'liuli-dsh-wallpaper';
  const LL_WALLPAPER_REV_KEY = 'liuli-dsh-wallpaper-rev';
  function llErrText(e) {
    if (!e) return '';
    try {
      const name = e.name ? String(e.name) : '';
      const msg = e.message != null ? String(e.message) : String(e);
      return name && name !== 'Error' && msg.indexOf(name) !== 0 ? name + ': ' + msg : msg;
    } catch (err) {
      return '[unprintable error]';
    }
  }
  function llScopeName() {
    try {
      return (
        (document.body && document.body.dataset && document.body.dataset.liuliScope) || 'unknown'
      );
    } catch (e) {
      return 'unknown';
    }
  }
  function llWallpaperRev() {
    try {
      return localStorage.getItem(LL_WALLPAPER_REV_KEY) || '';
    } catch (e) {
      return '';
    }
  }
  function llFmtBytes(n) {
    const v = Number(n) || 0;
    if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(2) + 'MB';
    if (v >= 1024) return (v / 1024).toFixed(1) + 'KB';
    return v + 'B';
  }
  const LL_WP_DEFAULTS = {
    src: null,
    area: null,
    fit: 'cover'
  };
  function loadWallpaperState() {
    try {
      const raw = localStorage.getItem(LL_WALLPAPER_KEY);
      if (!raw) return Object.assign({}, LL_WP_DEFAULTS);
      const parsed =
        raw.charAt(0) === '{'
          ? JSON.parse(raw)
          : {
              src: raw
            };
      const st = Object.assign({}, LL_WP_DEFAULTS, parsed);
      if (!st.area || typeof st.area.w !== 'number') st.area = null;
      return st;
    } catch (e) {
      return Object.assign({}, LL_WP_DEFAULTS);
    }
  }
  function saveWallpaperState(state, broadcast) {
    let ok = false;
    let error = '';
    let valueLen = 0;
    let revOk = false;
    let revError = '';
    try {
      const raw = JSON.stringify(state);
      valueLen = raw.length;
      localStorage.setItem(LL_WALLPAPER_KEY, raw);
      ok = true;
    } catch (e) {
      error = llErrText(e);
    }
    if (ok) {
      try {
        localStorage.setItem(LL_WALLPAPER_REV_KEY, String(Date.now()));
        revOk = true;
      } catch (e) {
        revError = llErrText(e);
      }
    }
    auditWallpaper('persist', {
      ok: ok,
      error: error,
      key: LL_WALLPAPER_KEY,
      valueLen: valueLen,
      revOk: revOk,
      revError: revError
    });
    if (broadcast !== false) {
      window.__liuliPaletteApplied = false;
      applyDynamicPalette();
    }
    return {
      ok: ok,
      error: error
    };
  }
  function getImageRatio(src) {
    return imageMetadata.get(src)?.ratio || null;
  }
  setImageRatioReader(getImageRatio);
  async function primeImageRatio(src) {
    if (getImageRatio(src)) return getImageRatio(src);
    try {
      return (await readImageMetadata(src)).ratio;
    } catch {
      return null;
    }
  }
  function normalizeAreaToRatio(area, ratio) {
    const safeRatio = Math.max(0.05, Math.min(20, ratio));
    const areaSize = Math.max(area.w * area.h, 0.04 * 0.04);
    let w = Math.sqrt(areaSize * safeRatio);
    let h = Math.sqrt(areaSize / safeRatio);
    const scale = Math.min(1, 1 / w, 1 / h);
    w *= scale;
    h *= scale;
    const maxDim = Math.max(w, h);
    if (maxDim > 0.998) {
      const shrink = 0.998 / maxDim;
      w *= shrink;
      h *= shrink;
    }
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    return {
      x: Math.min(1 - w, Math.max(0, cx - w / 2)),
      y: Math.min(1 - h, Math.max(0, cy - h / 2)),
      w: w,
      h: h
    };
  }
  function bgGeometry(area, imageRatio, viewportRatio) {
    if (arguments[3] === 'contain')
      return {
        size: 'contain',
        position: 'center'
      };
    if (arguments[3] === 'stretch')
      return {
        size: '100% 100%',
        position: 'center'
      };
    if (!area || area.w <= 0.04 || area.h <= 0.04) {
      return {
        size: 'cover',
        position: 'center'
      };
    }
    const vRatio =
      viewportRatio && viewportRatio > 0 ? viewportRatio : window.innerWidth / window.innerHeight;
    const iRatio = imageRatio && imageRatio > 0 ? imageRatio : vRatio;
    const n = normalizeAreaToRatio(area, vRatio / iRatio);
    if (n.w >= 0.999 || n.h >= 0.999) {
      return {
        size: 'cover',
        position: 'center'
      };
    }
    const px = Math.min(1, Math.max(0, n.x / (1 - n.w)));
    const py = Math.min(1, Math.max(0, n.y / (1 - n.h)));
    return {
      size: 'calc(100% / ' + n.w + ') calc(100% / ' + n.h + ')',
      position: (px * 100).toFixed(2) + '% ' + (py * 100).toFixed(2) + '%'
    };
  }
  function ensureWallpaperStyle() {
    let el = document.getElementById('liuli-wallpaper-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'liuli-wallpaper-style';
      document.head.appendChild(el);
    }
    return el;
  }
  function renderWallpaper(state, reason) {
    const el = ensureWallpaperStyle();
    llWpLast = state;
    if (window.LiuliVideoWallpaper) {
      window.LiuliVideoWallpaper.apply(state).catch(error => {
        console.warn('[theme] video wallpaper:', error && error.message);
        toast('视频壁纸无法播放，暂时显示首帧：' + llErrText(error));
      });
    }
    /* #49 / #52：通话、屏幕共享窗口是原生视频层，迷你窗是透明窗口，
     * 铺壁纸会把原生画面盖住；CSS 侧还有 content:none 双保险。 */
    if (
      document.body.dataset.liuliAv === '1' ||
      (location.hash || '').indexOf('#/mini-fishing') === 0
    ) {
      el.textContent = '';
      return;
    }
    if (!state || !state.src) {
      el.textContent = '';
      if (reason) {
        auditWallpaper('apply', {
          scope: llScopeName(),
          styleLen: 0,
          ratioKnown: false,
          fit: (state && state.fit) || 'cover',
          area: null,
          cleared: true,
          reason: reason,
          rev: llWallpaperRev()
        });
      }
      return;
    }
    const g = bgGeometry(
      state.area,
      getImageRatio(state.src),
      window.innerWidth / window.innerHeight,
      state.fit || 'cover'
    );
    el.textContent =
      '#app::before {' +
      '  content: "" !important; position: absolute !important; inset: 0 !important;' +
      '  z-index: 0 !important; pointer-events: none !important;' +
      '  background-image: linear-gradient(rgba(var(--ll-veil-rgb, var(--ll-scrim-rgb)), var(--ll-wallpaper-dim, 0.18)),' +
      '    rgba(var(--ll-veil-rgb, var(--ll-scrim-rgb)), var(--ll-wallpaper-dim, 0.18))),\n' +
      '    url("' +
      state.src +
      '") !important;' +
      '  background-position: ' +
      g.position +
      ' !important;' +
      '  background-size: ' +
      g.size +
      ' !important;' +
      '  background-repeat: no-repeat !important;' +
      '}';
    if (reason) {
      auditWallpaper('apply', {
        scope: llScopeName(),
        styleLen: el.textContent.length,
        ratioKnown: !!getImageRatio(state.src),
        fit: state.fit || 'cover',
        area: state.area || null,
        reason: reason,
        rev: llWallpaperRev()
      });
    }
  }
  let llWpLast = null;
  let llWpResizeRaf = 0;
  try {
    window.addEventListener('resize', function () {
      if (llWpResizeRaf || !llWpLast || !llWpLast.src) return;
      llWpResizeRaf = requestAnimationFrame(function () {
        llWpResizeRaf = 0;
        renderWallpaper(llWpLast);
      });
    });
  } catch (e) {}
  try {
    window.addEventListener('storage', function (e) {
      if (e.key !== LL_WALLPAPER_KEY) return;
      const st = loadWallpaperState();
      auditWallpaper('storage', {
        scope: llScopeName(),
        key: LL_WALLPAPER_KEY,
        hasSrc: !!(st && st.src)
      });
      if (st.src && !getImageRatio(st.src)) {
        primeImageRatio(st.src).then(function (ratio) {
          if (!ratio || loadWallpaperState().src !== st.src) return;
          renderWallpaper(loadWallpaperState(), 'storage');
          refreshWallpaperPreview();
        });
      }
      renderWallpaper(st, 'storage');
      window.__liuliPaletteApplied = false;
      applyDynamicPalette();
      if (typeof refreshWallpaperPreview === 'function') refreshWallpaperPreview();
    });
  } catch (e) {}
  const LL_WP_DATAURL_BUDGET = 3.5 * 1024 * 1024;
  const LL_WP_ENCODE_WIDTHS = [2560, 1920, 1440, 1080];
  const LL_WP_ENCODE_QUALITIES = [0.86, 0.8];
  function llReadFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () {
        reject(new Error('读取文件失败'));
      };
      reader.onload = function () {
        resolve(String(reader.result || ''));
      };
      reader.readAsDataURL(file);
    });
  }
  function llDecodeImage(src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onerror = function () {
        reject(new Error('图片解码失败'));
      };
      img.onload = function () {
        resolve(img);
      };
      img.src = src;
    });
  }
  async function readImageFile(file, maxW) {
    const started = Date.now();
    try {
      const raw = await llReadFileAsDataUrl(file);
      const img = await llDecodeImage(raw);
      const cap = Number(maxW) > 0 ? Number(maxW) : LL_WP_ENCODE_WIDTHS[0];
      const widths = [];
      if (img.naturalWidth > 0 && img.naturalWidth <= cap) widths.push(img.naturalWidth);
      for (const w of LL_WP_ENCODE_WIDTHS) {
        if (w <= cap && widths.indexOf(w) < 0) widths.push(w);
      }
      if (!widths.length) widths.push(cap);
      const tries = [];
      let last = null;
      let prevDims = '';
      for (const targetW of widths) {
        const sc = Math.min(1, targetW / img.naturalWidth);
        const w = Math.max(1, Math.round(img.naturalWidth * sc));
        const h = Math.max(1, Math.round(img.naturalHeight * sc));
        const dims = w + 'x' + h;
        if (dims === prevDims) continue;
        prevDims = dims;
        const cvs = document.createElement('canvas');
        cvs.width = w;
        cvs.height = h;
        const ctx = cvs.getContext('2d');
        if (!ctx) throw new Error('canvas 2d 不可用');
        ctx.drawImage(img, 0, 0, w, h);
        for (const q of LL_WP_ENCODE_QUALITIES) {
          const dataUrl = cvs.toDataURL('image/jpeg', q);
          tries.push({
            w: w,
            q: q,
            len: dataUrl.length
          });
          last = {
            dataUrl: dataUrl,
            ratio: w / h,
            width: w,
            height: h,
            quality: q
          };
          if (dataUrl.length <= LL_WP_DATAURL_BUDGET) {
            auditWallpaper('encode', {
              ok: true,
              dataUrlLen: dataUrl.length,
              width: w,
              height: h,
              quality: q,
              ms: Date.now() - started,
              tries: tries
            });
            return last;
          }
        }
      }
      if (!last) throw new Error('没有可用的编码结果');
      const over = last.dataUrl.length > LL_WP_DATAURL_BUDGET;
      auditWallpaper('encode', {
        ok: true,
        dataUrlLen: last.dataUrl.length,
        width: last.width,
        height: last.height,
        quality: last.quality,
        ms: Date.now() - started,
        over: over,
        tries: tries
      });
      return Object.assign(
        {
          over: over
        },
        last
      );
    } catch (e) {
      auditWallpaper('encode', {
        ok: false,
        error: llErrText(e),
        ms: Date.now() - started
      });
      throw e;
    }
  }
  let llWpRefresh = null;
  function refreshWallpaperPreview() {
    if (llWpRefresh) llWpRefresh();
  }
  const LL_WP_FITS = [
    ['cover', '填充（Cover）'],
    ['contain', '适应（Contain）'],
    ['stretch', '拉伸（Stretch）']
  ];
  function llBtn(text, variant) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'liuli-btn liuli-btn--' + (variant || 'ghost');
    b.textContent = text;
    return b;
  }
  function llApplyWallpaper(st) {
    const saved = saveWallpaperState(st, true);
    if (st && st.src && !getImageRatio(st.src)) {
      primeImageRatio(st.src).then(function (ratio) {
        if (!ratio || loadWallpaperState().src !== st.src) return;
        renderWallpaper(loadWallpaperState(), 'user');
        refreshWallpaperPreview();
      });
    }
    renderWallpaper(st, 'user');
    refreshWallpaperPreview();
    if (!saved.ok) {
      toast('壁纸保存失败：' + saved.error + '（仅本次生效，重启后可能丢失）');
    }
    return saved;
  }
  const LL_MAIN_VP_KEY = 'liuli-dsh-main-viewport';
  function llMainViewportRatio() {
    if (document.body && document.body.dataset.liuliScope === 'main')
      return window.innerWidth / window.innerHeight;
    try {
      const v = JSON.parse(localStorage.getItem(LL_MAIN_VP_KEY) || 'null');
      if (v && v.w > 0 && v.h > 0) return v.w / v.h;
    } catch (e) {}
    return window.innerWidth / window.innerHeight;
  }
  (function publishMainViewport() {
    let frame = 0;
    function publish() {
      frame = 0;
      if (document.body.dataset.liuliScope !== 'main') return;
      try {
        const current = JSON.parse(localStorage.getItem(LL_MAIN_VP_KEY) || 'null');
        if (current?.w === innerWidth && current?.h === innerHeight) return;
        localStorage.setItem(LL_MAIN_VP_KEY, JSON.stringify({ w: innerWidth, h: innerHeight }));
        refreshWallpaperPreview();
      } catch (error) {
        console.warn('[theme] viewport save failed', error);
      }
    }
    window.addEventListener('resize', () => {
      if (!frame) frame = requestAnimationFrame(publish);
    });
    window.addEventListener('liuli-scope', publish);
    window.addEventListener('storage', event => {
      if (event.key === LL_MAIN_VP_KEY) refreshWallpaperPreview();
    });
    publish();
  })();
  function buildWallpaperControls(host) {
    const block = document.createElement('div');
    block.className = 'liuli-wp-block';
    host.appendChild(block);
    const title = document.createElement('div');
    title.className = 'liuli-wp-title';
    title.textContent = '壁纸设置';
    block.appendChild(title);
    const row = document.createElement('div');
    row.className = 'liuli-wp-actions';
    const pick = document.createElement('input');
    pick.type = 'file';
    pick.accept = 'image/*,video/mp4,video/webm,.mp4,.webm';
    pick.style.display = 'none';
    const chooseBtn = llBtn('选择图片或视频', 'primary');
    chooseBtn.addEventListener('click', function () {
      pick.click();
    });
    const fileName = document.createElement('span');
    fileName.className = 'liuli-wp-filename';
    const removeBtn = llBtn('移除', 'ghost');
    removeBtn.addEventListener('click', function () {
      let ok = true;
      let error = '';
      const oldVideo = loadWallpaperState().videoId;
      try {
        localStorage.removeItem(LL_WALLPAPER_KEY);
        localStorage.setItem(LL_WALLPAPER_REV_KEY, String(Date.now()));
      } catch (e) {
        ok = false;
        error = llErrText(e);
      }
      auditWallpaper('remove', {
        ok: ok,
        error: error
      });
      if (ok && oldVideo && window.LiuliVideoWallpaper) {
        window.LiuliVideoWallpaper.remove(oldVideo).catch(console.warn);
      }
      renderWallpaper(null, 'remove');
      window.__liuliPaletteApplied = false;
      applyDynamicPalette();
      fileName.textContent = '';
      refreshWallpaperPreview();
      toast(ok ? '已恢复默认壁纸' : '移除壁纸失败：' + error);
    });
    pick.addEventListener('change', function () {
      const f = pick.files && pick.files[0];
      if (!f) return;
      auditWallpaper('pick', {
        file: {
          name: String(f.name || ''),
          size: Number(f.size) || 0,
          type: String(f.type || '')
        },
        maxW: 2560
      });
      chooseBtn.disabled = true;
      chooseBtn.textContent = '读取中…';
      const videoFile = /^video\//i.test(f.type) || /\.(mp4|webm)$/i.test(f.name);
      const previousVideo = loadWallpaperState().videoId;
      const reading = videoFile
        ? window.LiuliVideoWallpaper.importFile(f).then(result => ({
            dataUrl: result.poster, ratio: result.width / result.height,
            videoId: result.id, name: result.name, kind: 'video'
          }))
        : readImageFile(f, 2560);
      reading
        .then(function (r) {
          rememberImage(r.dataUrl, { ratio: r.ratio });
          const prev = loadWallpaperState();
          const saved = llApplyWallpaper({
            src: r.dataUrl,
            area: null,
            fit: prev.fit || 'cover',
            kind: r.kind || 'image',
            videoId: r.videoId || null,
            name: String(f.name || '')
          });
          if (saved.ok && previousVideo && previousVideo !== r.videoId) {
            window.LiuliVideoWallpaper.remove(previousVideo).catch(console.warn);
          } else if (!saved.ok && r.videoId) {
            window.LiuliVideoWallpaper.remove(r.videoId).catch(console.warn);
            renderWallpaper(prev, 'video-save-failed');
            return;
          }
          fileName.textContent = f.name;
          if (r.over) {
            toast(
              '壁纸已更新，但压到最小仍约 ' +
                llFmtBytes(r.dataUrl.length) +
                '，若显示异常请换一张更小的图'
            );
          } else {
            toast('壁纸已更新，主题色已按新壁纸取色');
          }
          if (llModeAdviceRefresh) llModeAdviceRefresh();
        })
        .catch(function (e) {
          toast('读取失败：' + llErrText(e));
        })
        .finally(function () {
          chooseBtn.disabled = false;
          chooseBtn.textContent = '选择图片或视频';
          pick.value = '';
        });
    });
    row.appendChild(chooseBtn);
    row.appendChild(removeBtn);
    row.appendChild(fileName);
    row.appendChild(pick);
    block.appendChild(row);
    const advice = document.createElement('div');
    advice.className = 'liuli-wp-advice';
    advice.hidden = true;
    block.appendChild(advice);
    llModeAdviceRefresh = function () {
      return llCheckModeAdvice(advice);
    };
    llModeAdviceRefresh();
    const fitRow = document.createElement('div');
    fitRow.className = 'liuli-wp-fit';
    const fitLabel = document.createElement('span');
    fitLabel.textContent = '适应模式';
    const fitSeg = document.createElement('div');
    fitSeg.className = 'liuli-seg';
    fitRow.appendChild(fitLabel);
    fitRow.appendChild(fitSeg);
    block.appendChild(fitRow);
    const fitBtns = {};
    LL_WP_FITS.forEach(function (p) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'liuli-seg__item';
      b.textContent = p[1];
      b.addEventListener('click', function () {
        const st = loadWallpaperState();
        st.fit = p[0];
        llApplyWallpaper(st);
      });
      fitSeg.appendChild(b);
      fitBtns[p[0]] = b;
    });
    const previewActions = document.createElement('div');
    previewActions.className = 'liuli-wp-actions';
    const previewHost = document.createElement('div');
    previewHost.className = 'liuli-wp-preview-host';
    const note = document.createElement('div');
    note.className = 'liuli-wp-note';
    note.textContent = '选区仅 Cover 模式生效';
    block.appendChild(previewActions);
    block.appendChild(previewHost);
    block.appendChild(note);
    let selectMode = false;
    let selBox = null;
    let drag = null;
    let stage = null;
    const winRatio = llMainViewportRatio;
    const clamp = function (v, a, b) {
      return Math.min(b, Math.max(a, v));
    };
    const cropRatioOf = function (ir) {
      return ir && ir > 0 ? winRatio() / ir : 1;
    };
    function windowArea(ir) {
      if (!ir || ir <= 0) return null;
      const wr = winRatio();
      const maxW = Math.min(0.998, ir > wr ? wr / ir : 1);
      const maxH = Math.min(0.998, ir > wr ? 1 : ir / wr);
      return {
        x: (1 - maxW) / 2,
        y: (1 - maxH) / 2,
        w: maxW,
        h: maxH
      };
    }
    function createArea(start, p, ratio) {
      const r = Math.max(0.05, Math.min(20, ratio));
      const dx = p.x - start.x,
        dy = p.y - start.y;
      const dirX = dx >= 0 ? 1 : -1,
        dirY = dy >= 0 ? 1 : -1;
      const maxW = dirX > 0 ? 1 - start.x : start.x;
      const maxH = dirY > 0 ? 1 - start.y : start.y;
      const w = Math.min(Math.max(Math.abs(dx), Math.abs(dy) * r), maxW, maxH * r);
      const h = w / r;
      return {
        x: dirX > 0 ? start.x : start.x - w,
        y: dirY > 0 ? start.y : start.y - h,
        w: w,
        h: h
      };
    }
    function resizeArea(box, corner, p, ratio) {
      const r = Math.max(0.05, Math.min(20, ratio));
      const fx = corner === 'tl' || corner === 'bl' ? box.x + box.w : box.x;
      const fy = corner === 'tl' || corner === 'tr' ? box.y + box.h : box.y;
      const dirX = corner === 'tr' || corner === 'br' ? 1 : -1;
      const dirY = corner === 'bl' || corner === 'br' ? 1 : -1;
      const maxW = dirX > 0 ? 1 - fx : fx;
      const maxH = dirY > 0 ? 1 - fy : fy;
      const w = Math.min(Math.max(Math.abs(p.x - fx), Math.abs(p.y - fy) * r), maxW, maxH * r);
      const h = w / r;
      return {
        x: dirX > 0 ? fx : fx - w,
        y: dirY > 0 ? fy : fy - h,
        w: w,
        h: h
      };
    }
    function norm(e) {
      if (!stage) return null;
      const r = stage.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      return {
        x: clamp((e.clientX - r.left) / r.width, 0, 1),
        y: clamp((e.clientY - r.top) / r.height, 0, 1)
      };
    }
    function cropBoxEl(box, interactive) {
      const el = document.createElement('div');
      el.className = 'liuli-wp-crop' + (interactive ? '' : ' liuli-wp-crop--static');
      el.style.left = box.x * 100 + '%';
      el.style.top = box.y * 100 + '%';
      el.style.width = box.w * 100 + '%';
      el.style.height = box.h * 100 + '%';
      if (interactive) {
        ['tl', 'tr', 'bl', 'br'].forEach(function (c) {
          const h = document.createElement('span');
          h.className = 'liuli-wp-handle liuli-wp-handle--' + c;
          el.appendChild(h);
        });
      }
      return el;
    }
    function paintSelection() {
      if (!stage) return;
      const old = stage.querySelector('.liuli-wp-crop');
      if (old) old.remove();
      if (selBox && selBox.w > 0) stage.appendChild(cropBoxEl(selBox, true));
    }
    function render() {
      const st = loadWallpaperState();
      const fit = st.fit || 'cover';
      Object.keys(fitBtns).forEach(function (k) {
        fitBtns[k].classList.toggle('is-active', k === fit);
      });
      removeBtn.disabled = !st.src;
      fileName.textContent = st.name || '';
      previewActions.innerHTML = '';
      previewHost.innerHTML = '';
      stage = null;
      note.style.display = st.src && fit !== 'cover' ? '' : 'none';
      if (!st.src) {
        previewHost.style.display = 'none';
        previewActions.style.display = 'none';
        return;
      }
      previewHost.style.display = '';
      previewActions.style.display = '';
      const ir = getImageRatio(st.src);
      if (!ir) {
        primeImageRatio(st.src).then(ratio => {
          if (ratio && loadWallpaperState().src === st.src) render();
        });
      }
      const wr = winRatio();
      const width = 'min(100%, calc(220px * ' + wr + '))';
      const cr = cropRatioOf(ir);
      if (selectMode) {
        const reselect = llBtn('重新选择', 'ghost');
        reselect.addEventListener('click', function () {
          selBox = windowArea(ir);
          paintSelection();
        });
        const done = llBtn('完成选区', 'primary');
        done.addEventListener('click', function () {
          if (selBox && selBox.w > 0.04 && selBox.h > 0.04) {
            const cur = loadWallpaperState();
            cur.area = normalizeAreaToRatio(selBox, cr);
            llApplyWallpaper(cur);
          }
          selectMode = false;
          selBox = null;
          render();
        });
        previewActions.appendChild(reselect);
        previewActions.appendChild(done);
      } else {
        const edit = llBtn(st.area ? '编辑选区' : '重新选择', 'ghost');
        edit.disabled = st.kind === 'video' || fit !== 'cover' || !ir;
        edit.addEventListener('click', function () {
          const saved =
            st.area && st.area.w > 0.04 && st.area.h > 0.04
              ? normalizeAreaToRatio(st.area, cr)
              : null;
          selBox = saved || windowArea(ir);
          selectMode = true;
          render();
        });
        previewActions.appendChild(edit);
        if (st.area) {
          const clear = llBtn('清除选区', 'ghost');
          clear.addEventListener('click', function () {
            const cur = loadWallpaperState();
            cur.area = null;
            llApplyWallpaper(cur);
          });
          previewActions.appendChild(clear);
        }
      }
      const full = document.createElement('div');
      full.className = 'liuli-wp-full';
      full.style.backgroundImage = 'url("' + st.src + '")';
      if (selectMode && ir) {
        stage = document.createElement('div');
        stage.className = 'liuli-wp-context is-selecting';
        stage.style.width = width;
        stage.style.aspectRatio = String(ir);
        stage.appendChild(full);
        previewHost.appendChild(stage);
        paintSelection();
        stage.addEventListener('pointerdown', function (e) {
          e.preventDefault();
          const r = stage.getBoundingClientRect();
          const p0 = norm(e);
          if (!p0) return;
          const box = selBox;
          if (box && box.w > 0) {
            const L = box.x * r.width,
              T = box.y * r.height;
            const R = (box.x + box.w) * r.width,
              B = (box.y + box.h) * r.height;
            const lx = e.clientX - r.left,
              ly = e.clientY - r.top;
            const dL = Math.abs(lx - L),
              dR = Math.abs(lx - R),
              dT = Math.abs(ly - T),
              dB = Math.abs(ly - B);
            const nearCorner = (dL < 12 || dR < 12) && (dT < 12 || dB < 12);
            const nearBox = lx >= L - 6 && lx <= R + 6 && ly >= T - 6 && ly <= B + 6;
            if (nearCorner) {
              drag = {
                mode: 'resize',
                box: box,
                corner: (dT <= dB ? 't' : 'b') + (dL <= dR ? 'l' : 'r')
              };
            } else if (nearBox) {
              drag = {
                mode: 'move',
                box: box,
                ox: clamp(p0.x - box.x, 0, box.w),
                oy: clamp(p0.y - box.y, 0, box.h)
              };
            } else {
              drag = {
                mode: 'create',
                start: p0,
                prev: box
              };
              selBox = {
                x: p0.x,
                y: p0.y,
                w: 0,
                h: 0
              };
            }
          } else {
            drag = {
              mode: 'create',
              start: p0,
              prev: box
            };
            selBox = {
              x: p0.x,
              y: p0.y,
              w: 0,
              h: 0
            };
          }
          stage.setPointerCapture(e.pointerId);
          paintSelection();
        });
        stage.addEventListener('pointermove', function (e) {
          if (!drag) return;
          const p = norm(e);
          if (!p) return;
          if (drag.mode === 'create') selBox = createArea(drag.start, p, cr);
          else if (drag.mode === 'resize') selBox = resizeArea(drag.box, drag.corner, p, cr);
          else
            selBox = {
              x: clamp(p.x - drag.ox, 0, 1 - drag.box.w),
              y: clamp(p.y - drag.oy, 0, 1 - drag.box.h),
              w: drag.box.w,
              h: drag.box.h
            };
          paintSelection();
        });
        const up = function () {
          const d = drag;
          drag = null;
          if (d && d.mode === 'create' && !(selBox && selBox.w > 0.04 && selBox.h > 0.04)) {
            selBox = d.prev;
            paintSelection();
          }
        };
        stage.addEventListener('pointerup', up);
        stage.addEventListener('pointercancel', up);
      } else if (st.area && fit === 'cover' && ir) {
        stage = document.createElement('div');
        stage.className = 'liuli-wp-context';
        stage.style.width = width;
        stage.style.aspectRatio = String(ir);
        stage.appendChild(full);
        stage.appendChild(cropBoxEl(normalizeAreaToRatio(st.area, cr), false));
        previewHost.appendChild(stage);
      } else {
        stage = document.createElement('div');
        stage.className = 'liuli-wp-stage2';
        stage.style.width = width;
        stage.style.aspectRatio = String(wr);
        const fx = document.createElement('div');
        fx.className = 'liuli-wp-effect';
        const g = bgGeometry(st.area, ir, wr, fit);
        fx.style.backgroundImage = 'url("' + st.src + '")';
        fx.style.backgroundSize = g.size;
        fx.style.backgroundPosition = g.position;
        stage.appendChild(fx);
        previewHost.appendChild(stage);
      }
    }
    llWpRefresh = render;
    render();
  }
  const LL_MODE_KEY = 'liuli-dsh-mode';
  function llThemeMode() {
    try {
      const v = localStorage.getItem(LL_MODE_KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }
  function llIsDark() {
    const m = llThemeMode();
    if (m === 'light') return false;
    if (m === 'dark') return true;
    return (
      document.body.classList.contains('q-theme-tokens-dark') ||
      document.body.getAttribute('q-theme') === 'dark'
    );
  }
  function llApplyMode(withTransition, x, y) {
    const run = function () {
      const m = llThemeMode();
      if (m === 'auto') delete document.body.dataset.liuliMode;
      else document.body.dataset.liuliMode = m;
      document.body.dataset.liuliDark = llIsDark() ? '1' : '0';
      window.__liuliPaletteApplied = false;
      return applyDynamicPalette();
    };
    if (
      withTransition &&
      !motion.reduced &&
      !document.hidden &&
      typeof document.startViewTransition === 'function'
    ) {
      const root = document.documentElement;
      root.style.setProperty('--vt-x', (x || innerWidth / 2) + 'px');
      root.style.setProperty('--vt-y', (y || innerHeight / 2) + 'px');
      root.style.setProperty('--vt-r', Math.hypot(innerWidth, innerHeight) + 'px');
      document.startViewTransition(run);
    } else {
      run();
    }
  }
  try {
    window.addEventListener('storage', function (e) {
      if (e.key === LL_MODE_KEY) {
        llApplyMode(false);
        if (typeof llModeRefresh === 'function') llModeRefresh();
      }
      if (e.key === ROLE_KEY || e.key === COLOR_SOURCE_KEY) {
        window.__liuliPaletteApplied = false;
        applyDynamicPalette();
      }
    });
  } catch (e) {}
  let llModeRefresh = null;
  try {
    new MutationObserver(function () {
      if (llThemeMode() !== 'auto') return;
      const d = llIsDark() ? '1' : '0';
      if (document.body.dataset.liuliDark !== d) llApplyMode(false);
    }).observe(document.body, {
      attributes: true,
      attributeFilter: ['q-theme', 'class']
    });
  } catch (e) {}
  const LL_WP_ADVICE_KEY = 'liuli-wp-advice-dismissed';
  let llModeAdviceRefresh = null;
  const llSrgbToY = s => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
  const llYToSrgb = y => (y <= 0.0031308 ? y * 12.92 : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
  const llLstarToY = l => (l > 8 ? Math.pow((l + 16) / 116, 3) : l / 903.3);
  function llWallpaperFingerprint(src) {
    return src ? src.length + ':' + src.slice(-48) : '';
  }
  async function llWallpaperLuma(src) {
    const img = await llDecodeImage(src);
    const n = 48;
    const c = document.createElement('canvas');
    c.width = n;
    c.height = n;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, n, n);
    const px = ctx.getImageData(0, 0, n, n).data;
    let sum = 0,
      cnt = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      sum +=
        0.2126 * llSrgbToY(px[i] / 255) +
        0.7152 * llSrgbToY(px[i + 1] / 255) +
        0.0722 * llSrgbToY(px[i + 2] / 255);
      cnt++;
    }
    return cnt ? sum / cnt : 0.5;
  }
  function llModeContrast(wallY, dim, opacity, dark, veil) {
    const veilSrgb = veil === 'light' ? llYToSrgb(llLstarToY(98)) : 0;
    const wall = llYToSrgb(wallY) * (1 - dim) + veilSrgb * dim;
    const glass = llYToSrgb(llLstarToY(dark ? 12 : 94));
    const bgY = llSrgbToY(glass * opacity + wall * (1 - opacity));
    const textY = llLstarToY(dark ? 90 : 10);
    return (Math.max(bgY, textY) + 0.05) / (Math.min(bgY, textY) + 0.05);
  }
  async function llCheckModeAdvice(box) {
    box.hidden = true;
    box.textContent = '';
    let src = null;
    try {
      const st = loadWallpaperState();
      src = st && st.src;
    } catch (e) {}
    if (!src) return null;
    const fp = llWallpaperFingerprint(src);
    const dark = llIsDark();
    try {
      if (localStorage.getItem(LL_WP_ADVICE_KEY) === fp + '|' + (dark ? 'dark' : 'light'))
        return null;
    } catch (e) {}
    let y;
    try {
      y = await llWallpaperLuma(src);
    } catch (e) {
      return null;
    }
    const cfg = llModeCfg || DEFAULT_SETTINGS;
    const op = Number(cfg.opacity);
    const o = isFinite(op) ? op : 0.5;
    const cur = llModeContrast(y, llDimFor(cfg, dark), o, dark, llVeilFor(cfg, dark));
    const alt = llModeContrast(y, llDimFor(cfg, !dark), o, !dark, llVeilFor(cfg, !dark));
    const result = {
      luma: y,
      current: cur,
      other: alt,
      advise: cur < 4.5 && alt >= cur * 1.5
    };
    if (!result.advise) return result;
    const target = dark ? 'light' : 'dark';
    const msg = document.createElement('div');
    msg.className = 'liuli-wp-advice__text';
    msg.textContent =
      (dark
        ? '这张壁纸偏亮，暗色主题下的浅色文字不够清楚'
        : '这张壁纸偏暗，亮色主题下的深色文字不够清楚') +
      '（估算对比度 ' +
      cur.toFixed(1) +
      ':1）。换成' +
      (dark ? '亮色' : '暗色') +
      '主题约 ' +
      alt.toFixed(1) +
      ':1。';
    const acts = document.createElement('div');
    acts.className = 'liuli-wp-actions';
    const go = llBtn('切换为' + (dark ? '亮色' : '暗色'), 'primary');
    go.addEventListener('click', function (e) {
      try {
        localStorage.setItem(LL_MODE_KEY, target);
      } catch (err) {}
      llApplyMode(true, e.clientX, e.clientY);
      if (typeof llModeRefresh === 'function') llModeRefresh();
      box.hidden = true;
    });
    const keep = llBtn('保持现状', 'ghost');
    keep.addEventListener('click', function () {
      try {
        localStorage.setItem(LL_WP_ADVICE_KEY, fp + '|' + (dark ? 'dark' : 'light'));
      } catch (err) {}
      box.hidden = true;
    });
    acts.appendChild(go);
    acts.appendChild(keep);
    box.appendChild(msg);
    box.appendChild(acts);
    box.hidden = false;
    return result;
  }
  window.__liuliModeAdvice = function () {
    const box = document.createElement('div');
    return llCheckModeAdvice(box).then(function (r) {
      return (
        r && {
          luma: +r.luma.toFixed(3),
          current: +r.current.toFixed(2),
          other: +r.other.toFixed(2),
          advise: r.advise
        }
      );
    });
  };
  function buildModeControls(host) {
    const row = document.createElement('div');
    row.className = 'liuli-wp-fit liuli-mode-row';
    const label = document.createElement('span');
    label.textContent = '明暗主题';
    const seg = document.createElement('div');
    seg.className = 'liuli-seg';
    row.appendChild(label);
    row.appendChild(seg);
    host.appendChild(row);
    const btns = {};
    [
      ['auto', '跟随 QQ'],
      ['light', '亮色'],
      ['dark', '暗色']
    ].forEach(function (p) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'liuli-seg__item';
      b.textContent = p[1];
      b.addEventListener('click', function (e) {
        try {
          if (p[0] === 'auto') localStorage.removeItem(LL_MODE_KEY);
          else localStorage.setItem(LL_MODE_KEY, p[0]);
        } catch (err) {}
        llApplyMode(true, e.clientX, e.clientY);
        refresh();
        if (llModeAdviceRefresh) llModeAdviceRefresh();
      });
      seg.appendChild(b);
      btns[p[0]] = b;
    });
    function refresh() {
      const m = llThemeMode();
      Object.keys(btns).forEach(function (k) {
        btns[k].classList.toggle('is-active', k === m);
      });
    }
    llModeRefresh = refresh;
    refresh();
  }
  function buildDiagSection(host) {
    const block = document.createElement('div');
    block.className = 'liuli-wp-block liuli-diag';
    host.appendChild(block);
    const title = document.createElement('div');
    title.className = 'liuli-wp-title';
    title.textContent = '诊断';
    block.appendChild(title);
    const desc = document.createElement('div');
    desc.className = 'liuli-diag-desc';
    desc.textContent =
      '把运行环境、主题资源、日志、UI/壁纸状态打成 zip（不含聊天记录；设置层截图默认包含）。遇到启动报错、壁纸不显示或设置样式异常时，可导出后检查。';
    block.appendChild(desc);
    const checkRow = document.createElement('label');
    checkRow.className = 'liuli-diag-check';
    const shots = document.createElement('input');
    shots.type = 'checkbox';
    shots.checked = false;
    const shotsText = document.createElement('span');
    shotsText.textContent = '包含聊天窗口截图（可能包含当前聊天画面）';
    checkRow.appendChild(shots);
    checkRow.appendChild(shotsText);
    block.appendChild(checkRow);
    const shotsHint = document.createElement('div');
    shotsHint.className = 'liuli-diag-hint';
    shotsHint.textContent =
      '设置页截图默认包含（不含聊天内容）；聊天窗口与壁纸缩略图只在勾选后采集。';
    block.appendChild(shotsHint);
    const actions = document.createElement('div');
    actions.className = 'liuli-wp-actions';
    const exportBtn = llBtn('导出诊断包', 'primary');
    const openBtn = llBtn('打开文件夹', 'ghost');
    openBtn.disabled = true;
    actions.appendChild(exportBtn);
    actions.appendChild(openBtn);
    block.appendChild(actions);
    const status = document.createElement('div');
    status.className = 'liuli-diag-status';
    status.textContent = '状态：就绪';
    block.appendChild(status);
    const errRow = document.createElement('div');
    errRow.className = 'liuli-diag-errors';
    const errCount = document.createElement('span');
    errCount.textContent = '最近错误：0 条';
    const errToggle = document.createElement('button');
    errToggle.type = 'button';
    errToggle.className = 'liuli-diag-link';
    errToggle.textContent = '查看';
    errRow.appendChild(errCount);
    errRow.appendChild(errToggle);
    block.appendChild(errRow);
    const errList = document.createElement('div');
    errList.className = 'liuli-diag-errlist';
    block.appendChild(errList);
    let lastPath = '';
    let busy = false;
    const setStatus = function (text, level) {
      status.textContent = '状态：' + text;
      status.classList.toggle('is-ok', level === 'ok');
      status.classList.toggle('is-bad', level === 'bad');
    };
    const renderErrorList = function () {
      errList.innerHTML = '';
      const list = getErrors().slice(-10).reverse();
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'liuli-diag-err';
        empty.textContent = '本次启动没有捕获到错误。';
        errList.appendChild(empty);
        return;
      }
      list.forEach(function (e) {
        const item = document.createElement('div');
        item.className = 'liuli-diag-err';
        const head = document.createElement('div');
        head.className = 'liuli-diag-err__head';
        head.textContent = (e.t || '') + ' · ' + (e.level || 'error') + ' · ' + (e.scope || '');
        const msg = document.createElement('div');
        msg.className = 'liuli-diag-err__msg';
        msg.textContent = String(e.msg || '');
        item.appendChild(head);
        item.appendChild(msg);
        errList.appendChild(item);
      });
    };
    const refreshErrors = function () {
      errCount.textContent = '最近错误：' + getErrorCount() + ' 条';
      if (errList.classList.contains('is-open')) renderErrorList();
    };
    refreshErrors();
    refreshDiagnosticErrors = refreshErrors;
    errToggle.addEventListener('click', function () {
      const open = errList.classList.toggle('is-open');
      errToggle.textContent = open ? '收起' : '查看';
      if (open) renderErrorList();
    });
    exportBtn.addEventListener('click', async function () {
      if (busy) return;
      busy = true;
      exportBtn.disabled = true;
      openBtn.disabled = true;
      const oldLabel = exportBtn.textContent;
      exportBtn.textContent = '正在收集…';
      setStatus('正在收集…');
      const started = Date.now();
      const opts = {
        screenshots: !!shots.checked
      };
      try {
        const snap = await collectDiagnostics({
          files: true,
          quota: true,
          wallpaperDecode: true,
          defaultWallpaper: true
        });
        const payload = buildExportPayload(opts, snap);
        const api = window.LiuliHost;
        if (!api || typeof api.diagExport !== 'function') {
          throw new Error('主进程接口不可用：window.LiuliHost.diagExport 不存在');
        }
        const res = await api.diagExport(payload);
        if (!res || !res.ok) throw new Error((res && res.error) || '主进程返回失败');
        lastPath = res.path || '';
        setStatus(
          '已导出到 ' +
            (lastPath || '(未返回路径)') +
            (res.copiedTo ? '，已复制到 ' + res.copiedTo : '') +
            (res.size ? '（' + llFmtBytes(res.size) + '）' : ''),
          'ok'
        );
        openBtn.disabled = !lastPath;
        toast('诊断包已导出：' + (lastPath || ''));
        auditWallpaper('diag-export', {
          ok: true,
          path: lastPath,
          copiedTo: res.copiedTo || '',
          size: Number(res.size) || 0,
          ms: Date.now() - started,
          screenshots: opts.screenshots
        });
      } catch (e) {
        const msg = llErrText(e);
        setStatus('失败：' + msg, 'bad');
        toast('导出失败：' + msg);
        auditWallpaper('diag-export', {
          ok: false,
          error: msg,
          ms: Date.now() - started,
          screenshots: opts.screenshots
        });
      } finally {
        busy = false;
        exportBtn.disabled = false;
        exportBtn.textContent = oldLabel;
      }
    });
    openBtn.addEventListener('click', async function () {
      if (!lastPath) return;
      try {
        const api = window.LiuliHost;
        if (!api || typeof api.diagOpenPath !== 'function') {
          throw new Error('主进程接口不可用：window.LiuliHost.diagOpenPath 不存在');
        }
        const ok = await api.diagOpenPath(lastPath);
        if (!ok) throw new Error('系统没有打开该路径');
      } catch (e) {
        toast('打开文件夹失败：' + llErrText(e));
      }
    });
  }
  function buildVeilRow(veilKey, settings) {
    const row = document.createElement('div');
    row.className = 'liuli-wp-fit liuli-mode-row liuli-veil-row';
    const label = document.createElement('span');
    label.textContent = '遮罩颜色';
    const seg = document.createElement('div');
    seg.className = 'liuli-seg';
    row.appendChild(label);
    row.appendChild(seg);
    const btns = {};
    [
      ['light', '亮'],
      ['dark', '暗']
    ].forEach(function (p) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'liuli-seg__item';
      b.textContent = p[1];
      b.addEventListener('click', function () {
        settings[veilKey] = p[0];
        saveSettings(settings);
        applySettings(settings);
        refresh();
      });
      seg.appendChild(b);
      btns[p[0]] = b;
    });
    function refresh() {
      const v = settings[veilKey] === 'dark' ? 'dark' : 'light';
      Object.keys(btns).forEach(function (k) {
        btns[k].classList.toggle('is-active', k === v);
      });
    }
    refresh();
    llVeilSegRefreshers.push(function (cfg) {
      const v = cfg && cfg[veilKey] === 'dark' ? 'dark' : 'light';
      settings[veilKey] = v;
      refresh();
    });
    return row;
  }
  const LL_TAB_KEY = 'liuli-settings-tab';
  const LL_TABS = [
    {
      key: 'look',
      label: '外观'
    },
    {
      key: 'wallpaper',
      label: '壁纸'
    },
    {
      key: 'color',
      label: '配色'
    },
    {
      key: 'layout',
      label: '布局'
    },
    {
      key: 'text',
      label: '文字'
    },
    {
      key: 'diag',
      label: '诊断'
    }
  ];
  function llSavedTab() {
    try {
      const v = localStorage.getItem(LL_TAB_KEY);
      return LL_TABS.some(function (t) {
        return t.key === v;
      })
        ? v
        : LL_TABS[0].key;
    } catch (e) {
      return LL_TABS[0].key;
    }
  }
  function llBuildTabs(container, builders) {
    const list = LL_TABS;
    const bar = document.createElement('div');
    bar.className = 'liuli-seg liuli-tabs';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', '设置分区');
    container.appendChild(bar);
    const btns = {};
    const pages = {};
    const built = new Set();
    function show(key) {
      if (!pages[key]) key = list[0].key;
      if (!built.has(key)) {
        builders[key](pages[key]);
        built.add(key);
      }
      Object.keys(pages).forEach(function (k) {
        const on = k === key;
        pages[k].classList.toggle('is-active', on);
        pages[k].hidden = !on;
      });
      Object.keys(btns).forEach(function (k) {
        const on = k === key;
        btns[k].classList.toggle('is-active', on);
        btns[k].setAttribute('aria-selected', on ? 'true' : 'false');
        btns[k].tabIndex = on ? 0 : -1;
      });
      try {
        localStorage.setItem(LL_TAB_KEY, key);
      } catch (e) {}
    }
    list.forEach(function (t) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'liuli-seg__item';
      b.textContent = t.label;
      b.dataset.tab = t.key;
      b.setAttribute('role', 'tab');
      b.addEventListener('click', function () {
        show(t.key);
      });
      bar.appendChild(b);
      btns[t.key] = b;
    });
    list.forEach(function (t) {
      const p = document.createElement('div');
      p.className = 'liuli-tabpage';
      p.dataset.tab = t.key;
      p.setAttribute('role', 'tabpanel');
      p.hidden = true;
      container.appendChild(p);
      pages[t.key] = p;
    });
    show(llSavedTab());
    return {
      bar: bar,
      pages: pages,
      show: show
    };
  }
  function buildLookControls(pageLook, settings) {
    Object.assign(settings, llModeCfg);
    const themeGroup = document.createElement('div');
    themeGroup.className = 'liuli-panel__group';
    themeGroup.textContent = '主题';
    pageLook.appendChild(themeGroup);
    buildModeControls(pageLook);
    const group = document.createElement('div');
    group.className = 'liuli-panel__group';
    group.textContent = '材质';
    pageLook.appendChild(group);
    const blurPreview = document.createElement('div');
    blurPreview.className = 'liuli-blur-preview';
    blurPreview.textContent = '材质模糊预览';
    pageLook.appendChild(blurPreview);
    const inputs = {};
    let frame = 0;
    const flush = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      applySettings(settings);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(flush);
    };
    for (const f of FIELDS) {
      const wrap = document.createElement('div');
      wrap.className = 'liuli-field';
      const row = document.createElement('div');
      row.className = 'liuli-field__row';
      const label = document.createElement('div');
      label.className = 'liuli-field__label';
      label.textContent = f.label;
      const value = document.createElement('div');
      value.className = 'liuli-field__value';
      row.appendChild(label);
      row.appendChild(value);
      wrap.appendChild(row);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'liuli-slider';
      slider.min = f.min;
      slider.max = f.max;
      slider.step = f.step;
      slider.value = settings[f.key];
      wrap.appendChild(slider);
      const hint = document.createElement('div');
      hint.className = 'liuli-field__hint';
      hint.textContent = f.hint;
      wrap.appendChild(hint);
      const sync = () => {
        const v = Number(slider.value);
        settings[f.key] = v;
        const pct = f.pct ? f.pct(v) : ((v - f.min) / (f.max - f.min)) * 100;
        slider.style.setProperty('--liuli-pct', Math.max(0, Math.min(100, pct)) + '%');
        value.textContent = f.key === 'opacity' ? v.toFixed(2) : f.unit ? v + f.unit : v.toFixed(2);
      };
      slider.addEventListener('input', () => {
        sync();
        schedule();
      });
      slider.addEventListener('change', () => {
        sync();
        flush();
        saveSettings(settings);
      });
      sync();
      inputs[f.key] = slider;
      if (f.veilKey) wrap.appendChild(buildVeilRow(f.veilKey, settings));
      pageLook.appendChild(wrap);
    }
    const veilNote = document.createElement('div');
    veilNote.className = 'liuli-field__hint liuli-veil__note';
    veilNote.textContent = '遮罩颜色：「亮」盖一层白，「暗」盖一层黑。';
    pageLook.appendChild(veilNote);
    const reset = document.createElement('div');
    reset.className = 'liuli-field__hint';
    reset.style.cssText = 'cursor:pointer;color:var(--ll-brand);margin-top:14px;';
    reset.textContent = '恢复默认';
    reset.addEventListener('click', () => {
      Object.assign(settings, DEFAULT_SETTINGS);
      for (const f of FIELDS) {
        inputs[f.key].value = settings[f.key];
        inputs[f.key].dispatchEvent(new Event('input'));
      }
      flush();
      llRefreshVeilSegs(settings);
      saveSettings(settings);
      toast('已恢复默认');
    });
    pageLook.appendChild(reset);
    const resetAll = document.createElement('div');
    resetAll.className = 'liuli-field__hint';
    resetAll.style.cssText = 'cursor:pointer;color:var(--ll-brand);margin-top:8px;';
    resetAll.textContent = '恢复全部默认';
    resetAll.addEventListener('click', async () => {
      if (!confirm('恢复全部默认设置？包括布局、明暗、壁纸、字体等，需要重启 QQ 生效。')) return;
      const ok = await llResetAll();
      Object.assign(settings, DEFAULT_SETTINGS);
      for (const f of FIELDS) {
        inputs[f.key].value = settings[f.key];
        inputs[f.key].dispatchEvent(new Event('input'));
      }
      flush();
      llRefreshVeilSegs(settings);
      toast(ok ? '已恢复全部默认，重启 QQ 生效' : '恢复失败，请在诊断页查看错误详情');
    });
    pageLook.appendChild(resetAll);
  }
  function buildColorControls(pageColor) {
    const sourceGroup = document.createElement('div');
    sourceGroup.className = 'liuli-panel__group';
    sourceGroup.textContent = '主题基色';
    pageColor.appendChild(sourceGroup);
    const sourceRow = document.createElement('div');
    sourceRow.className = 'liuli-color-source';
    const auto = document.createElement('button');
    auto.type = 'button';
    auto.textContent = '壁纸自动取色';
    const manual = document.createElement('button');
    manual.type = 'button';
    manual.textContent = '手动颜色';
    const picker = window.LiuliColorPicker.create({label:'主题基色',value:colorSourceConfig().hex || DEFAULT_SOURCE,onChange:color=>{saveColorSource('manual',color,true);syncSourceControls();}});
    const resetSource = document.createElement('button');
    resetSource.type = 'button';
    resetSource.textContent = '恢复默认';
    const exact = document.createElement('button');
    exact.type = 'button';
    exact.textContent = '直接使用输入色';
    exact.setAttribute('aria-pressed', 'false');
    sourceRow.append(auto, manual, picker.element, exact, resetSource);
    pageColor.appendChild(sourceRow);
    const sourceHint = document.createElement('div');
    sourceHint.className = 'liuli-field__hint';
    sourceHint.textContent = '手动颜色会保持不变；下方每个区域都可单独打开调色盘选色。' ;
    pageColor.appendChild(sourceHint);
    function syncSourceControls() {
      const cfg = colorSourceConfig();
      auto.classList.toggle('is-active', cfg.mode === 'wallpaper');
      manual.classList.toggle('is-active', cfg.mode === 'manual');
      exact.classList.toggle('is-active', cfg.mode === 'manual' && cfg.exact);
      exact.setAttribute('aria-pressed', String(cfg.mode === 'manual' && cfg.exact));
      picker.setValue(cfg.hex || document.body.dataset.liuliSource || DEFAULT_SOURCE);
    }
    auto.addEventListener('click', () => { saveColorSource('wallpaper', ''); syncSourceControls(); });
    manual.addEventListener('click', () => {
      saveColorSource('manual', colorSourceConfig().hex || document.body.dataset.liuliSource || DEFAULT_SOURCE);
      syncSourceControls();
    });
    exact.addEventListener('click', () => {
      const cfg = colorSourceConfig();
      saveColorSource('manual', cfg.hex || document.body.dataset.liuliSource || DEFAULT_SOURCE, !cfg.exact);
      syncSourceControls();
    });
    resetSource.addEventListener('click', () => {
      try { localStorage.removeItem(COLOR_SOURCE_KEY); }
      catch (error) { toast('主题色重置失败：' + error.message); return; }
      window.__liuliPaletteApplied = false;
      applyDynamicPalette();
      syncSourceControls();
    });
    window.addEventListener('storage', event => {
      if (event.key === COLOR_SOURCE_KEY && sourceRow.isConnected) syncSourceControls();
    });
    syncSourceControls();
    const info = document.createElement('div');
    info.className = 'liuli-info';
    const swatch = document.createElement('div');
    swatch.className = 'liuli-swatch';
    const infoText = document.createElement('span');
    info.appendChild(swatch);
    info.appendChild(infoText);
    pageColor.appendChild(info);
    const refreshInfo = () => {
      const src = document.body.dataset.liuliSource || DEFAULT_SOURCE;
      const brand = getComputedStyle(document.body).getPropertyValue('--ll-brand').trim();
      swatch.style.background = brand || src;
      const cfg = colorSourceConfig();
      infoText.textContent = (cfg.mode === 'manual' ? '手动基色 ' : '壁纸取色 ') + src +
        ' · 当前界面强调色 ' + brand;
    };
    refreshInfo();
    refreshPaletteInfo = refreshInfo;
    buildRoleControls(pageColor, function () {
      window.__liuliPaletteApplied = false;
      applyDynamicPalette();
    });
  }
  function buildPanelContent(host, settings) {
    host.innerHTML = '';
    llPanelSettings.add(settings);
    llVeilSegRefreshers = [];
    const sub = document.createElement('div');
    sub.className = 'liuli-panel__sub';
    sub.textContent = '材质与外观 · 实时生效';
    host.appendChild(sub);
    llBuildTabs(host, {
      look: page => buildLookControls(page, settings),
      wallpaper: buildWallpaperControls,
      color: buildColorControls,
      layout: page => {
        // 布局页由 layout-custom.js 构建；会话列表这一组属于主题自己的设置，
        // 追加在它后面（layout-custom.js 不碰主题设置存储）。
        buildLayoutSection(page);
        buildPinGroupSection(page, settings);
      },
      text: page => {
        const group = document.createElement('div');
        group.className = 'liuli-panel__group';
        group.textContent = '文字';
        page.appendChild(group);
        buildMarkdownControls(page);
        buildFontControls(page);
        buildMessageTypeControls(page, settings);
      },
      diag: buildDiagSection
    });
  }
  async function initPanel() {
    const settings = await loadSettings();
    applySettings(settings, true);
  }
  const themeReady = (async () => {
    const started = Date.now();
    installRouteScope();
    try {
      const chunks = await Promise.all(
        FILES.map(async file => {
          try {
            return await loadText(file);
          } catch (e) {
            if (!OPTIONAL_FILES.has(file)) throw e;
            return '';
          }
        })
      );
      ensureStyle().textContent = chunks.join('\n');
      document.body.dataset.liuliTheme = 'dsh';
      llApplyFont();
      try {
        const m0 = llThemeMode();
        if (m0 !== 'auto') document.body.dataset.liuliMode = m0;
        document.body.dataset.liuliDark = llIsDark() ? '1' : '0';
      } catch (e) {}
      const paletteReady = applyDynamicPalette().catch(e => {
        console.warn('[theme] dynamic palette failed:', e && e.message);
      });
      const bootWallpaper = loadWallpaperState();
      const wallpaperReady = bootWallpaper.src ? primeImageRatio(bootWallpaper.src) : null;
      renderWallpaper(bootWallpaper, 'boot');
      try {
        installLayout(function () {
          refreshInputGeometry();
        });
      } catch (e) {
        console.warn('[theme] layout failed:', e && e.message);
      }
      try {
        installArkExternal(window.LiuliHost);
      } catch (e) {
        console.warn('[theme] ark external failed:', e && e.message);
      }
      installAvatarStick();
      installPageObserver();
      try {
        await initPanel();
      } catch (e) {
        console.warn('[theme] panel failed:', e && e.message);
      }
      await Promise.all([paletteReady, wallpaperReady]);
      renderWallpaper(loadWallpaperState(), 'boot-ready');
      console.log('[theme] ready in ' + (Date.now() - started) + 'ms');
      markBootReady();
    } catch (error) {
      const reason = (error && error.message) || String(error || '未知异常');
      console.error('[theme] inject failed:', reason);
      try {
        document.body.dataset.liuliTheme = 'failed';
      } catch (e) {}
      try {
        noteThemeFailure(reason);
      } catch (e) {}
      markBootFailed(error);
      throw error;
    }
  })();
  const onSettingWindowCreated = async view => {
    let cfg;
    try {
      cfg = await loadSettings();
    } catch (e) {
      cfg = Object.assign({}, DEFAULT_SETTINGS);
    }
    window.__liuliSettingsCache = cfg;
    const box = document.createElement('div');
    box.id = 'liuli-embedded';
    box.className = 'liuli-embedded';
    try {
      view.appendChild(box);
      buildPanelContent(box, cfg);
      try {
        notePanelBuild(true);
      } catch (e) {}
    } catch (error) {
      const reason = (error && error.message) || String(error || '未知异常');
      try {
        notePanelBuild(false, reason);
      } catch (e) {}
      try {
        console.error('[theme] settings panel build failed:', reason);
      } catch (e) {}
      throw error;
    }
  };
  window.__liuliRenderSettings = onSettingWindowCreated;
  const LL_MD_KEY = 'liuli-md-render';
  const LL_MD_TRIGGER = /`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|~~[^~\n]+~~|\|\|[^|\n]+\|\|/;
  function llMdEnabled() {
    try {
      return localStorage.getItem(LL_MD_KEY) !== '0';
    } catch (e) {
      return true;
    }
  }
  function llInlineMarkdown(md) {
    return md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\s][^*\n]*)\*/g, '<em>$1</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/\|\|([^|\n]+)\|\|/g, '<span class="ll-spoiler">$1</span>')
      .replace(/\n/g, '<br>');
  }
  function llMarkdownPass(root = document.body) {
    try {
      const on = llMdEnabled();
      const els = elementsWithin(root, '.ml-item .text-normal');
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!on) {
          if (el.__llMdSrc !== undefined) {
            el.textContent = el.__llMdSrc;
            el.__llMdSrc = undefined;
            el.__llMdSeen = undefined;
            const box = el.closest('.message-content');
            if (box) box.classList.remove('ll-inline-md');
          }
          continue;
        }
        const text = el.textContent;
        if (el.__llMdSeen === text) continue;
        if (!LL_MD_TRIGGER.test(text)) {
          el.__llMdSeen = text;
          el.__llMdSrc = undefined;
          continue;
        }
        el.__llMdSrc = text;
        el.innerHTML = llInlineMarkdown(text);
        el.__llMdSeen = el.textContent;
        const box = el.closest('.message-content');
        if (box) box.classList.add('ll-inline-md');
      }
    } catch (e) {}
  }
  /* 通用「开启 / 关闭」开关行。
   * 为什么抽出来：布局页新增的「会话列表」开关必须和文字页的 Markdown 渲染
   * 完全同款——同一组类名（.liuli-wp-fit + .liuli-mode-row + .liuli-seg）、
   * 同样的 开启 / 关闭 顺序、同样的 is-active 高亮，以后改一处两边都变。 */
  function llBuildSwitchRow(host, label, value, onChange) {
    const row = document.createElement('div');
    row.className = 'liuli-wp-fit liuli-mode-row';
    const text = document.createElement('span');
    text.textContent = label;
    const seg = document.createElement('div');
    seg.className = 'liuli-seg';
    row.appendChild(text);
    row.appendChild(seg);
    host.appendChild(row);
    const btns = {};
    [
      ['1', '开启'],
      ['0', '关闭']
    ].forEach(function (p) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'liuli-seg__item';
      b.textContent = p[1];
      b.addEventListener('click', function () {
        refresh(p[0]);
        onChange(p[0] === '1');
      });
      seg.appendChild(b);
      btns[p[0]] = b;
    });
    function refresh(cur) {
      const active = cur != null ? cur : value ? '1' : '0';
      Object.keys(btns).forEach(function (k) {
        btns[k].classList.toggle('is-active', k === active);
      });
    }
    refresh();
    return row;
  }
  function buildMarkdownControls(host) {
    llBuildSwitchRow(host, 'Markdown 渲染', llMdEnabled(), function (on) {
      try {
        localStorage.setItem(LL_MD_KEY, on ? '1' : '0');
      } catch (err) {}
      llMarkdownPass();
    });
  }
  /* 「布局 → 会话列表」：两个开关直接改面板持有的 settings 对象再整体保存。
   * 为什么不单独读一份：外观页签的滑杆保存时会整体写 settings，如果这几项
   * 只写在 localStorage、不写回同一个对象，切到外观页动一下滑杆就会被旧值覆盖。 */
  function buildPinGroupSection(host, settings) {
    const group = document.createElement('div');
    group.className = 'liuli-panel__group';
    group.textContent = '会话列表';
    host.appendChild(group);
    function persist(key, value) {
      settings[key] = value;
      applySettings(settings, true);
    }
    function settingSwitch(label, key, value, onChange) {
      const row = llBuildSwitchRow(host, label, value, onChange || (on => persist(key, on)));
      row.dataset.liuliSetting = key;
      [...row.querySelectorAll('button')].forEach((button, i) => {
        button.dataset.settingValue = String(i === 0);
      });
    }
    settingSwitch('置顶会话左侧短竖线', 'pinGroup', settings.pinGroup !== false);
    settingSwitch('置顶行增加主题色', 'pinColor', settings.pinColor === true);
    const colorHint = document.createElement('div');
    colorHint.className = 'liuli-field__hint';
    colorHint.textContent = '置顶行使用淡主题色和图钉标识，不显示数量与折叠按钮。';
    host.appendChild(colorHint);
    settingSwitch('隐藏空会话的 QQ 图标', 'hideEmptyLogo', settings.hideEmptyLogo !== false);
    const messageGroup = document.createElement('div');
    messageGroup.className = 'liuli-panel__group';
    messageGroup.textContent = '聊天消息';
    host.appendChild(messageGroup);
    function choice(label, key, options) {
      const row = document.createElement('div');
      row.className = 'liuli-wp-fit liuli-mode-row';
      row.dataset.liuliSetting = key;
      const caption = document.createElement('span');
      caption.textContent = label;
      const seg = document.createElement('div');
      seg.className = 'liuli-seg';
      for (const [value, text] of options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'liuli-seg__item';
        button.textContent = text;
        button.dataset.settingValue = value;
        button.classList.toggle('is-active', settings[key] === value);
        button.addEventListener('click', () => {
          settings[key] = value;
          applySettings(settings, true);
          for (const child of seg.children) child.classList.toggle('is-active', child === button);
        });
        seg.appendChild(button);
      }
      row.append(caption, seg);
      host.appendChild(row);
    }
    choice('聊天布局', 'chatStyle', [['tg', 'TG'], ['classic', '经典'], ['tim', 'TIM']]);
    choice('头像位置', 'avatarPosition', [['top', '消息开头'], ['bottom', '消息末尾']]);
    settingSwitch('隐藏纯图片消息的昵称', 'hideImageNames', settings.hideImageNames === true);
    settingSwitch('隐藏顶部的文件接收提示条', 'hideFileTip', settings.hideFileTip !== false);
    settingSwitch('点表情包直接发送', 'stickerSend', settings.stickerSend !== false);
    settingSwitch('禁止 QQ 自动更新', 'blockUpdate', settings.blockUpdate !== false);
    const updateHint = document.createElement('div');
    updateHint.className = 'liuli-field__hint';
    updateHint.textContent = '把 QQ 的版本配置固定为当前版本并设为只读，后台下载的新版本不会被加载。关闭后恢复可写，QQ 下次检查时照常更新。';
    host.appendChild(updateHint);
    const stickerHint = document.createElement('div');
    stickerHint.className = 'liuli-field__hint';
    stickerHint.textContent = '输入框为空时点表情包立即发出；已经写了字时仍插入到输入框，不会把半句话发出去。小表情（emoji）始终插入文字。';
    host.appendChild(stickerHint);
    const imageHint = document.createElement('div');
    imageHint.className = 'liuli-field__hint';
    imageHint.textContent = '同时隐藏图片上方的头衔；带文字或引用的混合消息保留昵称。';
    host.appendChild(imageHint);
  }
  function buildMessageTypeControls(host, settings) {
    const group = document.createElement('div');
    group.className = 'liuli-panel__group';
    group.textContent = '消息文字层级';
    host.appendChild(group);
    const rows = [];
    function sync() {
      Object.assign(settings, llNormalizeSettings(settings));
      for (const row of rows) {
        row.input.value = settings[row.key];
        row.value.textContent = settings[row.key] + 'px';
        const ratio = (settings[row.key] - Number(row.input.min)) /
          (Number(row.input.max) - Number(row.input.min));
        row.input.style.setProperty('--liuli-pct', ratio * 100 + '%');
      }
      applySettings(settings, true);
    }
    for (const [key, text, min, max] of [
      ['messageFontSize', '消息正文', 12, 24],
      ['nameFontSize', '发送者昵称', 10, 18],
      ['titleFontSize', '群头衔与身份标签', 9, 14]
    ]) {
      const field = document.createElement('div');
      field.className = 'liuli-field';
      const top = document.createElement('div');
      top.className = 'liuli-field__row';
      const label = document.createElement('div');
      label.className = 'liuli-field__label';
      label.textContent = text;
      const value = document.createElement('div');
      value.className = 'liuli-field__value';
      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'liuli-slider liuli-type-slider';
      input.dataset.liuliSetting = key;
      input.min = min;
      input.max = max;
      input.step = 1;
      input.addEventListener('input', () => { settings[key] = Number(input.value); sync(); });
      top.append(label, value);
      field.append(top, input);
      host.appendChild(field);
      rows.push({ key, input, value });
    }
    const hint = document.createElement('div');
    hint.className = 'liuli-field__hint';
    hint.textContent = '昵称字号不超过消息正文，头衔字号不超过昵称；长昵称在气泡范围内省略。';
    host.appendChild(hint);
    // 初始化只画控件，不保存或广播，避免打开设置页改变当前配置。
    for (const row of rows) {
      row.input.value = settings[row.key];
      row.value.textContent = settings[row.key] + 'px';
      row.input.style.setProperty('--liuli-pct', (settings[row.key] - Number(row.input.min)) /
        (Number(row.input.max) - Number(row.input.min)) * 100 + '%');
    }
  }

  function llMsgRecordOf(el) {
    return window.LiuliQQ.messageRecord(el);
  }
  let llSelfUid = '';
  let llSelfUidRequest = null;
  let llSelfUidRetryAt = 0;
  function llLoadSelfUid() {
    if (llSelfUid || llSelfUidRequest || !window.LiuliHost) return;
    // 主进程还拿不到自己的 uid 时，别在每一批新消息上都发一次请求。
    if (performance.now() < llSelfUidRetryAt) return;
    llSelfUidRetryAt = performance.now() + 5000;
    llSelfUidRequest = window.LiuliHost.selfUid()
      .then(uid => {
        if (uid) {
          llSelfUid = String(uid);
          llAtPass();
        }
      })
      .catch(() => {})
      .finally(() => {
        llSelfUidRequest = null;
      });
  }
  function llAtPass(root = document.body) {
    try {
      if (!llSelfUid) {
        llLoadSelfUid();
        return;
      }
      const ats = elementsWithin(root, '.ml-item .text-element--at');
      for (let i = 0; i < ats.length; i++) {
        const at = ats[i];
        const holder = at.closest('[data-element-id]');
        if (!holder) continue;
        const id = holder.getAttribute('data-element-id');
        if (at.dataset.llAtId === id) continue;
        const rec = llMsgRecordOf(at);
        if (!rec || !Array.isArray(rec.elements)) continue;
        const el = rec.elements.find(e => String(e.elementId) === id);
        const te = el && el.textElement;
        if (!te) continue;
        const me = te.atType === 1 || (te.atNtUid && String(te.atNtUid) === llSelfUid);
        at.dataset.llAt = me ? 'me' : 'other';
        at.dataset.llAtId = id;
      }
    } catch (e) {}
  }
  const LL_FONT_KEY = 'liuli-font';
  const LL_FONT_CANDIDATES = [
    'MiSans',
    'HarmonyOS Sans SC',
    'OPPOSans',
    'vivo Sans',
    'Alibaba PuHuiTi 3.0',
    '阿里巴巴普惠体 3.0',
    'LXGW WenKai',
    '霞鹜文楷',
    'LXGW WenKai Screen',
    '霞鹜文楷 屏幕阅读版',
    'Source Han Sans SC',
    '思源黑体',
    'Noto Sans SC',
    'Noto Sans CJK SC',
    'Sarasa UI SC',
    '更纱黑体 UI SC',
    'Microsoft YaHei UI',
    'Microsoft YaHei',
    '微软雅黑',
    'DengXian',
    '等线',
    'PingFang SC',
    'Inter',
    'Segoe UI',
    'SimHei',
    '黑体',
    'KaiTi',
    '楷体',
    'SimSun',
    '宋体',
    'FangSong',
    '仿宋'
  ];
  function llFontName() {
    try {
      return (localStorage.getItem(LL_FONT_KEY) || '').trim();
    } catch (e) {
      return '';
    }
  }
  function llCleanFont(name) {
    return String(name || '')
      .replace(/["'\\;{}<>]/g, '')
      .trim()
      .slice(0, 64);
  }
  function llApplyFont() {
    const name = llCleanFont(llFontName());
    const b = document.body;
    if (!b) return;
    if (!name) {
      b.style.removeProperty('--ll-font');
      delete b.dataset.llFont;
      return;
    }
    b.style.setProperty(
      '--ll-font',
      '"' + name + '", "MiSans", "Microsoft YaHei UI", system-ui, sans-serif, "Segoe UI Emoji"'
    );
    b.dataset.llFont = '1';
  }
  window.addEventListener('storage', e => {
    if (e.key === LL_FONT_KEY) llApplyFont();
  });
  let llFontCtx = null;
  function llFontInstalled(name) {
    try {
      if (!llFontCtx) llFontCtx = document.createElement('canvas').getContext('2d');
      const sample = '永和九年岁在癸丑 Hamburgefonstiv 0123';
      for (const base of ['monospace', 'serif']) {
        llFontCtx.font = '32px ' + base;
        const w0 = llFontCtx.measureText(sample).width;
        llFontCtx.font = '32px "' + name + '", ' + base;
        if (llFontCtx.measureText(sample).width !== w0) return true;
      }
    } catch (e) {}
    return false;
  }
  async function llListFonts() {
    try {
      if (window.queryLocalFonts) {
        const fonts = await window.queryLocalFonts();
        const names = Array.from(new Set(fonts.map(f => f.family))).sort((a, b) =>
          a.localeCompare(b, 'zh')
        );
        if (names.length) return names;
      }
    } catch (e) {}
    return LL_FONT_CANDIDATES.filter(llFontInstalled);
  }
  function buildFontControls(host) {
    const row = document.createElement('div');
    row.className = 'liuli-wp-fit liuli-mode-row';
    const label = document.createElement('span');
    label.textContent = '字体';
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;gap:6px;align-items:center;flex:1;justify-content:flex-end;';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '默认（MiSans）';
    input.value = llFontName();
    input.setAttribute('list', 'liuli-font-list');
    input.style.cssText =
      'width:180px;height:28px;padding:0 10px;border-radius:8px;border:none;outline:none;' +
      'background:rgba(var(--ll-on-glass-rgb),0.08);color:var(--ll-on-glass);font:inherit;font-size:13px;';
    const list = document.createElement('datalist');
    list.id = 'liuli-font-list';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'liuli-seg__item';
    reset.textContent = '默认';
    box.appendChild(input);
    box.appendChild(list);
    box.appendChild(reset);
    row.appendChild(label);
    row.appendChild(box);
    host.appendChild(row);
    const apply = name => {
      name = llCleanFont(name);
      try {
        if (name) localStorage.setItem(LL_FONT_KEY, name);
        else localStorage.removeItem(LL_FONT_KEY);
      } catch (e) {}
      input.value = name;
      llApplyFont();
    };
    input.addEventListener('change', () => apply(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') apply(input.value);
    });
    reset.addEventListener('click', () => apply(''));
    llListFonts().then(names => {
      list.innerHTML = '';
      for (const n of names) {
        const o = document.createElement('option');
        o.value = n;
        list.appendChild(o);
      }
      input.title = names.length
        ? '本机可用 ' + names.length + ' 种，点输入框可选'
        : '直接输入字体名';
    });
  }
  function mountSettingsEntry() {
    const controls =
      document.querySelector('.window-control-area:has(.mini-fishing-entry)') ||
      document.querySelector(
        '.window-title-bar .window-control-area:not(.window-title-bar__controls-left)'
      );
    if (!controls) return;
    const mini = controls.querySelector('.mini-fishing-entry');
    if (mini) mini.style.setProperty('display', 'none', 'important');
    // 设置页已经挂到 QQ 设置窗口，标题栏不再放主题齿轮。
  }
  const themeEntry = document.createElement('button');
  themeEntry.id = 'liuli-settings-entry';
  themeEntry.type = 'button';
  themeEntry.title = '主题设置';
  themeEntry.setAttribute('aria-label', '打开主题设置');
  themeEntry.setAttribute('aria-haspopup', 'dialog');
  themeEntry.setAttribute('aria-expanded', 'false');
  themeEntry.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const themeDialog = document.createElement('dialog');
  themeDialog.id = 'liuli-settings-dialog';
  themeDialog.setAttribute('aria-labelledby', 'liuli-settings-heading');
  const dialogHeader = document.createElement('header');
  dialogHeader.className = 'liuli-dialog-header';
  const heading = document.createElement('h1');
  heading.id = 'liuli-settings-heading';
  heading.textContent = '主题设置';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', '关闭主题设置');
  dialogHeader.append(heading, closeButton);
  themeDialog.append(dialogHeader);
  document.body.append(themeDialog);
  let panelReady;
  async function openSettings() {
    panelReady ??= onSettingWindowCreated(themeDialog).catch(error => {
      panelReady = undefined;
      throw error;
    });
    await panelReady;
    if (!themeDialog.open) themeDialog.showModal();
    themeEntry.setAttribute('aria-expanded', 'true');
    closeButton.focus({ preventScroll: true });
  }
  function closeSettings() {
    themeDialog.close();
    themeEntry.setAttribute('aria-expanded', 'false');
    themeEntry.focus({ preventScroll: true });
  }
  themeEntry.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openSettings().catch(error => console.error('[theme] settings failed', error));
  });
  closeButton.addEventListener('click', closeSettings);
  themeDialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeSettings();
  });
  themeDialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSettings();
    }
  });
  themeDialog.addEventListener('click', event => {
    const rect = themeDialog.getBoundingClientRect();
    if (
      event.target === themeDialog &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom)
    )
      closeSettings();
  });
  mountSettingsEntry();
  window.SnowLoraLiuli = { open: openSettings, mount: mountSettingsEntry, ready: themeReady };

  /* SnowLora：设置窗（#/setting）里挂一个「琉璃」导航页，复用 buildPanelContent。
   * SnowLora 主进程在 window_created 时按规则注入本文件；这里等 QQ 设置页 DOM 就绪后挂载。 */
  function mountLiuliSettingsPage() {
    let tries = 0;
    const tick = () => {
      const tab = document.querySelector('.setting-tab');
      const navBar = tab && tab.querySelector('.nav-bar');
      const main = document.querySelector('.setting-main .setting-main__content');
      const original = document.querySelector('.setting-main .q-scroll-view');
      const title = document.querySelector('.setting-main .setting-title');
      const sample = navBar && navBar.querySelector('.nav-item');
      if (!tab || !navBar || !main || !original || !title || !sample) {
        if (tries++ < 80) setTimeout(tick, 250);
        return;
      }
      if (tab.querySelector('.liuli-settings-nav')) return;
      const nav = sample.cloneNode(true);
      nav.classList.remove('nav-item-active');
      nav.classList.add('liuli-settings-nav');
      const name = nav.querySelector('.name');
      if (name) name.textContent = '琉璃';
      else nav.textContent = '琉璃';
      const group = document.createElement('div');
      group.className = 'nav-bar liuli-settings-navbar';
      group.append(nav);
      tab.append(group);
      const view = document.createElement('div');
      view.className = 'q-scroll-view scroll-view--show-scrollbar';
      view.style.display = 'none';
      main.append(view);
      let titleNode = null;
      let titleSaved = null;
      nav.addEventListener('click', async () => {
        if (!view.dataset.ready) {
          view.dataset.ready = '1';
          try {
            await window.__liuliRenderSettings(view);
          } catch (e) {
            view.textContent = '主题设置加载失败：' + (e && e.message ? e.message : e);
          }
        }
        original.style.display = 'none';
        view.style.display = 'block';
        // 标题结构是 <div.setting-title><div.icon-area/> 通用<!--v-if--></div>，要改 icon-area 后面的文本节点；
        // 以前改的是 childNodes[1]（icon-area），标题会变成「琉璃通用」。离开时还原，Vue 在值没变时不会重绘它。
        const titleText = [...title.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
        if (titleText) {
          if (titleSaved === null) titleSaved = titleText.nodeValue;
          titleNode = titleText;
          titleText.nodeValue = ' 琉璃';
        }
        tab.querySelectorAll('.nav-item').forEach(el => el.classList.remove('nav-item-active'));
        nav.classList.add('nav-item-active');
      });
      tab.addEventListener('click', e => {
        const item = e.target.closest && e.target.closest('.nav-item');
        if (item && item !== nav) {
          view.style.display = 'none';
          original.style.display = 'block';
          // #63：克隆出来的导航项 QQ 不管，切到别的页时要自己去掉选中态，否则两项同时高亮
          nav.classList.remove('nav-item-active');
          // 点回进入插件页之前的同一项时路由没变，Vue 不会重绘选中态，这里补上；
          // 之后 Vue 重绘这一项会整体改写 className，不会冲突
          requestAnimationFrame(() => {
            if (!tab.querySelector('.nav-item.nav-item-active')) item.classList.add('nav-item-active');
          });
          if (titleNode && titleSaved !== null && titleNode.isConnected) titleNode.nodeValue = titleSaved;
          titleNode = null;
          titleSaved = null;
        }
      }, true);
    };
    tick();
  }
  if (location.hash.indexOf('#/setting') === 0) mountLiuliSettingsPage();
})();
