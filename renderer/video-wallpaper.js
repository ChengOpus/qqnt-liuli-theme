/* 本地视频壁纸：Blob 放 IndexedDB，localStorage 只放 id 和首帧。
 * 不把大视频编码进 localStorage，也不向页面开放任意文件路径能力。 */
(() => {
  'use strict';
  const DB_NAME = 'liuli-wallpaper-media';
  const STORE = 'videos';
  const LIMIT = 100 * 1024 * 1024;
  let layer = null;
  let objectUrl = '';
  let activeId = '';
  let serial = 0;
  let current = null;

  function database() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onerror = () => reject(req.error || new Error('无法打开视频存储'));
      req.onsuccess = () => resolve(req.result);
    });
  }
  async function transact(mode, action) {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        let result;
        const req = action(tx.objectStore(STORE));
        req.onsuccess = () => { result = req.result; };
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(tx.error || req.error || new Error('视频存储失败'));
      });
    } finally { db.close(); }
  }

  function firstFrame(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      let finished = false;
      const timer = setTimeout(() => finish(new Error('视频解码超时，请换一个较短的视频')), 20000);
      function finish(error, value) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        video.onloadeddata = video.onseeked = video.onerror = null;
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
        error ? reject(error) : resolve(value);
      }
      function capture() {
        try {
          if (!video.videoWidth || !video.videoHeight) throw new Error('视频没有有效画面');
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 1280 / video.videoWidth);
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('无法创建视频首帧画布');
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const width = video.videoWidth;
          const height = video.videoHeight;
          finish(null, { poster: canvas.toDataURL('image/jpeg', 0.82), width, height });
        } catch (error) { finish(error); }
      }
      video.onerror = () => finish(new Error('无法解码视频，请使用 H.264 MP4 或 WebM'));
      video.onloadeddata = () => {
        // 跳过容器的全黑起始帧，短视频则直接取已解码的帧。
        if (Number.isFinite(video.duration) && video.duration > 0.2) {
          video.onseeked = capture;
          video.currentTime = Math.min(0.1, video.duration / 2);
        } else capture();
      };
      video.src = url;
    });
  }
  async function importFile(file) {
    if (!(file instanceof Blob) || !file.size) throw new Error('请选择有效的视频文件');
    if (file.size > LIMIT) throw new Error('视频不能超过 100 MB');
    if (!/^video\/(mp4|webm)$/i.test(file.type) && !/\.(mp4|webm)$/i.test(file.name || '')) {
      throw new Error('仅支持 MP4 和 WebM 视频');
    }
    const frame = await firstFrame(file);
    const id = crypto.randomUUID();
    await transact('readwrite', store => store.put(file, id));
    return { id, ...frame, name: String(file.name || '本地视频') };
  }
  async function remove(id) {
    if (typeof id !== 'string' || !id) return;
    await transact('readwrite', store => store.delete(id));
  }
  async function clearAll() {
    current = null;
    dispose();
    await transact('readwrite', store => store.clear());
  }
  // ── Drawing ─────────────────────────────────────────────────────────────
  // Windows hands a playing <video> to its own hardware layer. In QQ's
  // translucent main window that layer is never shown: two user diagnostics
  // (2026-11-13) had the video playing at full window size with the first
  // frame already removed, and nothing on screen, also with opacity 0.999.
  // Each frame is therefore copied onto a canvas, which is composited with
  // the page like any picture. The <video> keeps playing underneath it.
  let canvas = null;
  let context = null;
  let request = 0;
  let painting = 'none'; // 'frame' (requestVideoFrameCallback) | 'raf' | 'none'
  let lastTime = -1;
  let base = '#ffffff'; // letterbox colour for "contain": the window's own base
  const MAX_PIXELS = 2560 * 1600;
  function fitMode() {
    const fit = current && current.fit;
    return fit === 'stretch' ? 'fill' : fit === 'contain' ? 'contain' : 'cover';
  }
  function sizeCanvas() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    let w = Math.max(1, Math.round(window.innerWidth * dpr));
    let h = Math.max(1, Math.round(window.innerHeight * dpr));
    const k = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }
  // object-fit for a canvas: cover crops the source, contain letterboxes.
  function paint(video) {
    if (!context || !video.videoWidth || !video.videoHeight) return false;
    const cw = canvas.width;
    const ch = canvas.height;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const mode = fitMode();
    if (mode === 'fill') {
      context.drawImage(video, 0, 0, cw, ch);
    } else if (mode === 'contain') {
      const k = Math.min(cw / vw, ch / vh);
      const dw = vw * k;
      const dh = vh * k;
      context.fillStyle = base;
      context.fillRect(0, 0, cw, ch);
      context.drawImage(video, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    } else {
      const k = Math.max(cw / vw, ch / vh);
      const sw = cw / k;
      const sh = ch / k;
      context.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, cw, ch);
    }
    return true;
  }
  function stopPainting() {
    if (layer && painting === 'frame' && request && layer.cancelVideoFrameCallback) layer.cancelVideoFrameCallback(request);
    if (painting === 'raf' && request) cancelAnimationFrame(request);
    request = 0;
    painting = 'none';
  }
  // Without a canvas (no 2D context, or drawing refused) the <video> itself
  // is the wallpaper again, as before.
  function dropCanvas() {
    stopPainting();
    canvas?.remove();
    canvas = null;
    context = null;
  }
  function frame(video) {
    if (layer !== video) return;
    let ok = false;
    try {
      ok = paint(video);
    } catch (error) {
      console.warn('[theme] video wallpaper canvas:', error && error.message);
      dropCanvas();
      return;
    }
    if (ok) {
      lastTime = video.currentTime;
      if (video.currentTime > 0) document.body.setAttribute('data-liuli-video-wallpaper', '');
    }
    schedule(video);
  }
  function schedule(video) {
    if (layer !== video || !canvas) return;
    if (painting === 'frame') {
      request = video.requestVideoFrameCallback(() => frame(video));
    } else if (painting === 'raf') {
      request = requestAnimationFrame(() => {
        // a new picture only when the media time moved
        if (layer !== video) return;
        if (video.currentTime !== lastTime || !document.body.hasAttribute('data-liuli-video-wallpaper')) frame(video);
        else schedule(video);
      });
    }
  }
  function startPainting(video) {
    if (!canvas || painting !== 'none') return;
    painting = typeof video.requestVideoFrameCallback === 'function' ? 'frame' : 'raf';
    schedule(video);
  }
  // Frame callbacks follow the compositor. If they stop arriving while the
  // media clock runs (checked on timeupdate, ~4 times a second), draw on
  // animation frames instead.
  function stalled(video) {
    if (painting !== 'frame' || video.paused || document.hidden) return false;
    return lastTime >= 0 ? video.currentTime - lastTime > 0.6 : video.currentTime > 1;
  }
  function toAnimationFrames(video) {
    if (request && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(request);
    request = 0;
    painting = 'raf';
    schedule(video);
  }
  function onResize() {
    if (!canvas || !layer) return;
    sizeCanvas();
    try {
      paint(layer);
    } catch (error) {}
  }

  function dispose() {
    serial++;
    stopPainting();
    if (layer) {
      layer.pause();
      layer.removeAttribute('src');
      layer.load();
      const host = layer.parentElement;
      layer.remove();
      if (host && host.id === 'liuli-video-layer') host.remove();
      layer = null;
    }
    canvas = null;
    context = null;
    lastTime = -1;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    activeId = '';
    document.body.removeAttribute('data-liuli-video-wallpaper');
  }
  // 系统「减少动画」不再停用视频壁纸：视频是用户明确选的壁纸，而 Windows 关掉
  // 「动画效果」的人很多，以前这种情况下主界面直接没有视频（2026-11-13 用户反馈）。
  function playback() {
    if (!layer) return;
    if (document.hidden) layer.pause();
    else layer.play().catch(() => { /* 自动播放被拒绝时保留首帧，用户操作后重试。 */ });
  }
  // The main window and the settings page play the video. Standalone chat
  // windows are pooled: QQ keeps them alive off screen while reporting them
  // visible (user diagnostics), so a video there would decode for nobody;
  // they, like other small windows, keep the first frame as a picture.
  function playsHere() {
    const scope = document.body.dataset.liuliScope;
    if (document.body.dataset.liuliAv === '1') return false;
    if ((location.hash || '').indexOf('#/mini-fishing') === 0) return false;
    return scope === 'main' || scope === 'setting';
  }
  async function apply(state) {
    current = state;
    if (!playsHere() || !state || state.kind !== 'video' || !state.videoId) {
      dispose();
      return;
    }
    if (layer && activeId === state.videoId) {
      layer.style.objectFit = fitMode();
      onResize();
      playback();
      return;
    }
    dispose();
    const ticket = serial;
    const id = state.videoId;
    const blob = await transact('readonly', store => store.get(id));
    if (ticket !== serial) return;
    if (!(blob instanceof Blob)) throw new Error('视频文件已丢失，请重新选择壁纸');
    const app = document.getElementById('app');
    if (!app) return;
    const host = document.createElement('div');
    host.id = 'liuli-video-layer';
    host.setAttribute('aria-hidden', 'true');
    const video = document.createElement('video');
    video.id = 'liuli-video-wallpaper';
    video.setAttribute('aria-hidden', 'true');
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.poster = state.src || '';
    video.style.objectFit = fitMode();
    objectUrl = URL.createObjectURL(blob);
    video.src = objectUrl;
    layer = video;
    activeId = id;
    canvas = document.createElement('canvas');
    canvas.id = 'liuli-video-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    // Opaque: the compositor can then skip the <video> underneath.
    context = canvas.getContext('2d', { alpha: false });
    if (!context) canvas = null;
    else sizeCanvas();
    try {
      const fill = getComputedStyle(app).backgroundColor;
      if (fill && fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent') base = fill;
      else base = document.body.dataset.liuliDark === '1' ? '#000000' : '#ffffff';
    } catch (e) {}
    // 播放失败仍用现有的图片壁纸层作为首帧兜底，不留下空白。
    // 只有画面真的画出来了（画布上有了一帧、时间在走）才撤掉首帧图。
    video.addEventListener('playing', () => startPainting(video));
    // No canvas: the old rule — the <video> itself must have shown a frame.
    const shown = () => {
      if (canvas || layer !== video || !video.videoWidth || video.currentTime <= 0) return false;
      document.body.setAttribute('data-liuli-video-wallpaper', '');
      return true;
    };
    const tick = () => {
      if (layer !== video) return video.removeEventListener('timeupdate', tick);
      if (!canvas) {
        if (shown()) video.removeEventListener('timeupdate', tick);
      } else if (stalled(video)) toAnimationFrames(video);
    };
    video.addEventListener('timeupdate', tick);
    video.addEventListener('error', () => {
      if (layer === video) document.body.removeAttribute('data-liuli-video-wallpaper');
    });
    host.appendChild(video);
    if (canvas) host.appendChild(canvas);
    app.prepend(host);
    playback();
  }
  window.addEventListener('resize', onResize);
  // Pooled windows change route (and so scope) without reloading.
  window.addEventListener('liuli-scope', () => {
    if (current) apply(current).catch(() => {});
  });
  document.addEventListener('visibilitychange', playback);
  document.addEventListener('pointerdown', playback, { passive: true });

  window.addEventListener('pagehide', dispose);
  // for diagnostics and tests
  function state() {
    return { painting, painted: lastTime >= 0, canvas: !!canvas };
  }
  window.LiuliVideoWallpaper = { importFile, remove, clearAll, apply, state, clear: () => { current = null; dispose(); } };
})();
