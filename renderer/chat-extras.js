/* Small chat-pane behaviours that are not layout:
 *   · the file-transfer strip QQ pins under the chat title when someone sends a
 *     file or video ("xx.gif 39 MB · 待下载  [下载] [另存为] [取消]") is hidden;
 *   · QQ's own 表情 icon (moved beside "+") opens the expression panel on a
 *     sticker tab, on hover or click, instead of the emoji tab;
 *   · clicking a sticker sends it at once when the editor was empty.
 * None of these changes a message, a file or QQ's own download state: the strip
 * is only not displayed, and the message itself still carries its native
 * download controls.
 */
(() => {
  "use strict";
  const D = window.LiuliDOM;
  let settings = { hideFileTip: true, stickerSend: true };

  // ── File-transfer strip ─────────────────────────────────────────────────
  // Identified by what it is, not by a class name we cannot verify: a strip in
  // the chat pane, outside the message list and the composer, holding exactly
  // the transfer actions and a size/state line.
  const ACTIONS = /^(下载|另存为|取消|打开|打开文件夹|重新下载|接收|保存)$/;
  const STATE = /(\d+(\.\d+)?\s*(B|KB|MB|GB))|待下载|下载中|已下载|已过期|接收中/;
  function fileStrip(button) {
    let node = button.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      if (node.matches(".aio, .chat-msg-area, .ml-list, .ml-area, .group-panel, .chat-input-area"))
        return null;
      const buttons = [...node.querySelectorAll('button, [role="button"], .q-button')];
      const labels = buttons.map((b) => b.textContent.trim()).filter(Boolean);
      if (
        labels.length >= 2 &&
        labels.length <= 5 &&
        labels.every((l) => ACTIONS.test(l)) &&
        labels.includes("取消") &&
        STATE.test(node.textContent)
      )
        return node;
    }
    return null;
  }
  function scanTips(root) {
    if (!settings.hideFileTip || !(root instanceof Element)) return;
    const pane = root.closest?.(".aio") || (root.querySelector?.(".aio") ? root : null);
    if (!pane) return;
    for (const button of root.querySelectorAll('button, [role="button"], .q-button')) {
      if (button.textContent.trim() !== "取消") continue;
      if (button.closest(".ml-list, .ml-item, .chat-input-area, .q-dialog, .q-popup__main, [data-liuli-file-strip]"))
        continue;
      const strip = fileStrip(button);
      if (strip) strip.setAttribute("data-liuli-file-strip", "");
    }
  }
  function showTips() {
    for (const node of document.querySelectorAll("[data-liuli-file-strip]"))
      node.removeAttribute("data-liuli-file-strip");
  }

  // ── Stickers ────────────────────────────────────────────────────────────
  const PANEL = ".expression-panel, .expression-panel-inner, .sticker-panel";
  let stickerTab = null; // index the reader last used, if any
  try {
    stickerTab = JSON.parse(localStorage.getItem("liuli-sticker-tab") || "null");
  } catch (e) {}
  // Open = laid out, on screen and not faded out. QQ can keep the panel
  // mounted while closed; a mounted-but-transparent panel is not open.
  function shown(node) {
    if (!D.visible(node)) return false;
    for (let n = node; n && n !== document.body; n = n.parentElement)
      if (parseFloat(getComputedStyle(n).opacity) < 0.1) return false;
    return true;
  }
  function panel() {
    return [...document.querySelectorAll(PANEL)].find(shown) || null;
  }
  // The tab row. QQ 9.9.36 (user diagnostics): .sticker-panel__bar >
  // .tabs-container > .tabs-container-item × n — search, emoji, favourites,
  // GIF, then sticker packs. Geometry is only a fallback for other builds.
  const EMOJI_TAB = 1,
    SEARCH_TAB = 0,
    FAVOURITES_TAB = 2;
  function tabs(root) {
    const items = [...root.querySelectorAll(".sticker-panel__bar .tabs-container-item")];
    if (items.length >= 3) return { row: items[0].parentElement, items };
    let best = null;
    for (const row of root.querySelectorAll("div, ul, nav")) {
      const kids = [...row.children].filter((c) => c.getBoundingClientRect().width > 0);
      if (kids.length < 4 || kids.length > 30) continue;
      const rects = kids.map((c) => c.getBoundingClientRect());
      const h = rects[0].height;
      if (h < 20 || h > 64) continue;
      if (!rects.every((r) => Math.abs(r.top - rects[0].top) < 3 && Math.abs(r.height - h) < 3)) continue;
      if (!best || rects[0].top > best.top) best = { row, items: kids, top: rects[0].top };
    }
    return best;
  }
  let choosing = false;
  // The reader's own choice of a sticker tab is remembered; search and the
  // emoji tab never become the default (stickers open, not emoji).
  function remember(event) {
    if (choosing) return;
    const root = event.target.closest?.(PANEL);
    const strip = root && tabs(root);
    if (!strip) return;
    const index = strip.items.findIndex((item) => item.contains(event.target));
    if (index < 0 || index === EMOJI_TAB || index === SEARCH_TAB) return;
    stickerTab = index;
    try {
      localStorage.setItem("liuli-sticker-tab", JSON.stringify(index));
    } catch (e) {}
  }
  function chooseStickerTab() {
    const root = panel();
    const strip = root && tabs(root);
    if (!strip) return false;
    let index = stickerTab ?? FAVOURITES_TAB;
    if (index === EMOJI_TAB || index === SEARCH_TAB || index >= strip.items.length)
      index = Math.min(FAVOURITES_TAB, strip.items.length - 1);
    const target = strip.items[index];
    if (target.classList.contains("tabs-container-item-active")) return true;
    choosing = true;
    try {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    } finally {
      choosing = false;
    }
    return true;
  }
  function whenOpen(then) {
    let tries = 0;
    const step = () => {
      if (panel() && tabs(panel())) then();
      else if (++tries < 40) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // Opens QQ's expression panel through its own toolbar item and switches it
  // to the sticker tab. An already open panel is never toggled shut.
  function openStickers(nativeItem) {
    if (!panel()) nativeItem?.click();
    whenOpen(chooseStickerTab);
  }
  // QQ's own 表情 icon (placed beside "+"): hover opens the sticker panel,
  // a click opens it too — it never closes it or lands on emoji.
  const EMOJI_ICON = '.chat-input-area .chat-func-bar .bar-icon:has(> .icon-item[aria-label="表情"])';
  let intent = 0;
  function emojiIcon(target) {
    return target instanceof Element ? target.closest(EMOJI_ICON) : null;
  }
  function onOver(event) {
    const icon = emojiIcon(event.target);
    if (!icon || icon.contains(event.relatedTarget)) return;
    clearTimeout(intent);
    const item = icon.querySelector(":scope > .icon-item");
    intent = setTimeout(() => openStickers(item), 140);
  }
  function onOut(event) {
    const icon = emojiIcon(event.target);
    if (icon && !icon.contains(event.relatedTarget)) clearTimeout(intent);
  }
  function onEmojiClick(event) {
    if (bypass) return;
    const icon = emojiIcon(event.target);
    if (!icon || event.target.closest(".arrow")) return;
    clearTimeout(intent);
    if (panel()) {
      // QQ would toggle it shut; keep it open and on stickers instead.
      event.preventDefault();
      event.stopImmediatePropagation();
      chooseStickerTab();
    } else whenOpen(chooseStickerTab);
  }

  // Click on a sticker → once it lands in an empty editor, press QQ's own send.
  // Emoji (small inline faces) are left alone: they belong in the text.
  //
  // Armed on pointerdown: QQ inserts the sticker and closes the panel on the
  // press, so a click on the tile may never arrive (user report, 2026-11-15:
  // the sticker stayed in the editor). The editor is then watched each frame
  // for the picture rather than for one particular mutation shape.
  let pending = null;
  const debug = { armed: 0, landed: 0, sent: 0, kept: 0, held: 0, reopened: 0, queued: 0, replayed: 0, closedOnLeave: 0, released: '', last: '', skipped: '' };
  // What counts as a picture in the editor. ProseMirror keeps helper nodes in
  // an otherwise empty paragraph — an <img class="ProseMirror-separator"> and
  // a trailing <br> — and QQ pads with zero-width characters; none of those
  // is content (they made an empty editor look like a draft).
  const HELPER = '.ProseMirror-separator, .ProseMirror-trailingBreak, .ProseMirror-widget, [data-placeholder]';
  const MEDIA_IN_EDITOR = 'img, .image-element, .pic-element, [class*="image-element"], [class*="market-face"]';
  function editorOf(input) {
    return input?.querySelector('.ProseMirror, [contenteditable="true"], [contenteditable]') || null;
  }
  function textOf(editor) {
    return editor.textContent.replace(/[\s​-‏⁠﻿]/g, '');
  }
  // pictures, attachments and faces actually in the message
  function mediaCount(editor) {
    let n = 0;
    for (const node of editor.querySelectorAll(MEDIA_IN_EDITOR + ', .file-element, .face-element')) {
      if (node.matches(HELPER) || node.closest(HELPER)) continue;
      // an <img> inside an element already counted is the same picture
      if (node.parentElement?.closest('.image-element, .pic-element, [class*="image-element"], [class*="market-face"], .file-element, .face-element')) continue;
      n++;
    }
    return n;
  }
  function editorEmpty(input) {
    const editor = editorOf(input);
    return !!editor && textOf(editor) === '' && mediaCount(editor) === 0;
  }
  function activeTab(strip) {
    return strip ? strip.items.findIndex(item => item.classList.contains('tabs-container-item-active')) : -1;
  }
  // The tile pressed, if it is a sticker (not an emoji, not a tab).
  function stickerTile(event) {
    const root = event.target.closest?.(PANEL);
    if (!root) return null;
    const strip = tabs(root);
    if (strip?.row.contains(event.target)) return null;
    const tile =
      event.target.closest('.stickers-item, [class*="stickers-item"], [class*="sticker-item"]') ||
      event.target.closest('img');
    if (!tile || !root.contains(tile)) return null;
    const tab = activeTab(strip);
    if (tab === EMOJI_TAB) return null;
    if (tab < 0) {
      const r = tile.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return null; // unknown layout: an emoji
    }
    return tile;
  }
  function sendButton(input) {
    // the innermost control first: QQ's handler sits on the button itself
    return (
      input.querySelector('.operation .send-msg') ||
      input.querySelector('.send-msg') ||
      input.querySelector('.operation .send') ||
      input.querySelector('.send-btn-wrap button, .send-btn-wrap [role="button"]') ||
      input.querySelector('.send-btn-wrap')
    );
  }
  function press(input) {
    const button = sendButton(input);
    const editor = editorOf(input);
    if (button) {
      // A click only. A synthetic press (pointerdown/mousedown) on the send
      // button reached QQ's "pressed outside the panel" handler and closed
      // the sticker panel a second time for every sticker.
      button.click();
      debug.last = 'button';
    }
    // Still there well after (no button, or it did not take): Enter, the key
    // the user sends with. Late enough that a send in flight has cleared it.
    setTimeout(() => {
      if (!editor?.isConnected || mediaCount(editor) === 0) return;
      editor.focus();
      for (const type of ['keydown', 'keypress', 'keyup'])
        editor.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      debug.last = button ? 'button+enter' : 'enter';
    }, 600);
    debug.sent++;
  }
  // The sticker only passes through the editor on its way out: while it does,
  // the composer keeps its height and the picture in the editor is not drawn
  // (user report, 2026-11-15: it visibly landed in the editor first). If it
  // does not leave — the send did not take — it is shown again so it is never
  // invisibly left in a draft.
  let holdTimer = 0;
  function hold(input, editor) {
    clearTimeout(holdTimer);
    const h = Math.round(editor.getBoundingClientRect().height);
    input.style.setProperty('--ll-sticker-hold', Math.max(h, 20) + 'px');
    input.setAttribute('data-liuli-sticker-sending', '');
    holdTimer = setTimeout(() => release(input), 2600);
  }
  function release(input) {
    clearTimeout(holdTimer);
    holdTimer = 0;
    if (!input) return;
    input.removeAttribute('data-liuli-sticker-sending');
    input.style.removeProperty('--ll-sticker-hold');
  }
  // after the send: release as soon as the editor is empty again
  function releaseWhenSent(input, editor, until) {
    if (!editor?.isConnected || mediaCount(editor) === 0 || performance.now() > until) {
      if (editor?.isConnected && mediaCount(editor) > 0) debug.kept++;
      // one more frame so the cleared editor is laid out before it shows
      requestAnimationFrame(() => {
        release(input);
        inflight = false;
        next();
      });
      return;
    }
    requestAnimationFrame(() => releaseWhenSent(input, editor, until));
  }
  function watch() {
    if (!pending) return;
    const { input, until } = pending;
    const editor = editorOf(input);
    if (!editor || performance.now() > until) {
      pending = null;
      release(input);
      inflight = false;
      next();
      return;
    }
    if (mediaCount(editor) > pending.before && textOf(editor) === '') {
      pending = null;
      debug.landed++;
      // after ProseMirror has finished its own transaction
      setTimeout(() => {
        press(input);
        releaseWhenSent(input, editor, performance.now() + 1400);
      }, 30);
      return;
    }
    requestAnimationFrame(watch);
  }
  // The panel stays open after a sticker is sent while the pointer is still
  // over it, and closes once the pointer leaves (user, 2026-11-15). QQ closes
  // it on the press. Keeping QQ's hidden panel visible (.30/.31) showed an
  // empty shell: QQ hides the sticker grid inside too. So when QQ closes it
  // right after a sticker press with the pointer still on it, it is opened
  // again through QQ's own 表情 button — in the same task, before anything is
  // painted, so it never visibly closes — and QQ renders it as on any open.
  // When the pointer then leaves it, it is closed the same way.
  let stay = null; // { root, sheet, box, until, reopened }
  let pointer = { x: -1, y: -1 };
  let bypass = false;
  const watcher = new MutationObserver(() => {
    if (!stay) return;
    if (!stay.sheet.isConnected) return letGo("gone");
    if (getComputedStyle(stay.sheet).display !== "none") return;
    // QQ closed it. QQ closes it more than once for one sticker — on the
    // press and again when the message is sent (user diagnostics .32:
    // reopened 2, then released "closed") — so it is reopened each time
    // within the window after the press, a few times at most.
    if (performance.now() > stay.until || !inside(stay.box, pointer.x, pointer.y) || stay.count >= 4) return letGo("closed");
    const item = nativeEmoji();
    if (!item) return letGo("no-button");
    stay.count++;
    stay.reopened = true;
    debug.reopened++;
    item.click();
    whenOpen(chooseStickerTab);
  });
  function nativeEmoji() {
    return document.querySelector(EMOJI_ICON + " > .icon-item");
  }
  function inside(b, x, y) {
    const m = 6;
    return x >= b.left - m && x <= b.right + m && y >= b.top - m && y <= b.bottom + m;
  }
  function holdOpen(tile, event) {
    const sheet = tile.closest(".sticker-panel") || tile.closest(PANEL)?.querySelector(".sticker-panel");
    if (!sheet || getComputedStyle(sheet).display === "none") return;
    const box = (sheet.closest(".expression-panel-inner") || sheet).getBoundingClientRect();
    if (box.width < 40 || box.height < 40) return;
    if (event?.isTrusted && Number.isFinite(event.clientX)) pointer = { x: event.clientX, y: event.clientY };
    const root = sheet.closest(".expression-panel") || sheet.parentElement || sheet;
    if (!stay || stay.root !== root) {
      watcher.disconnect();
      // the panel element and its wrappers only — not the grid, whose hover
      // states change with every pointer move
      for (let n = sheet; n; n = n === root ? null : n.parentElement)
        watcher.observe(n, { attributes: true, attributeFilter: ["style", "class", "hidden"] });
    }
    stay = { root, sheet, box, until: performance.now() + 3000, count: 0, reopened: stay?.reopened || false };
    debug.held++;
  }
  function letGo(reason) {
    if (!stay) return;
    debug.released = typeof reason === "string" ? reason : "other";
    watcher.disconnect();
    stay = null;
  }
  function closePanel() {
    const item = nativeEmoji();
    if (!item || !panel()) return;
    bypass = true;
    try {
      item.click();
    } finally {
      bypass = false;
    }
  }
  function onMove(event) {
    pointer = { x: event.clientX, y: event.clientY };
    if (!stay) return;
    if (inside(stay.box, event.clientX, event.clientY)) return;
    // left the panel: close it if it is only open because it was reopened
    const reopened = stay.reopened;
    letGo("left");
    if (reopened) {
      debug.closedOnLeave++;
      closePanel();
    }
  }
  // Fast clicks (user, 2026-11-16: several stickers were left in the editor
  // unsent). While one sticker is on its way out, a sticker pressed next is
  // held back — QQ never sees that press — and pressed again for the reader
  // once the editor is clear, so each sticker goes out as its own message.
  let inflight = false;
  let replaying = false;
  const queue = [];
  // replayed on the very element that was pressed (QQ's handler may be on
  // the picture inside the tile, which a press on the tile never reaches)
  function stickerRef(tile, target) {
    const img = target?.closest?.("img") || (tile.matches("img") ? tile : tile.querySelector("img"));
    return { tile: target instanceof Element && tile.contains(target) ? target : tile, src: img?.getAttribute("src") || "" };
  }
  function resolve(ref) {
    if (ref.tile.isConnected && ref.tile.getClientRects().length) return ref.tile;
    if (!ref.src) return null;
    const root = panel();
    if (!root) return null;
    for (const img of root.querySelectorAll("img")) if (img.getAttribute("src") === ref.src) return img;
    return null;
  }
  function next() {
    if (inflight || !queue.length) return;
    const tile = resolve(queue.shift());
    if (!tile) return next();
    const r = tile.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, view: window, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    replaying = true;
    debug.replayed++;
    try {
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
        tile.dispatchEvent(new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, at));
      tile.dispatchEvent(new MouseEvent("click", at));
    } finally {
      replaying = false;
    }
  }
  function holdBack(event) {
    if (replaying || !inflight || !settings.stickerSend || event.button !== 0) return;
    if (!event.target.closest?.(PANEL)) return;
    const tile = stickerTile(event);
    if (!tile) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "pointerdown" || (event.type === "mousedown" && !queue.length)) {
      if (queue.length < 8 && (event.type === "pointerdown" || !queue.some((q) => q.tile === tile))) {
        queue.push(stickerRef(tile, event.target));
        debug.queued++;
      }
      // keep the panel up while the queue is worked through
      if (stay) stay.until = performance.now() + 3000;
    }
  }
  function onPress(event) {
    // A press elsewhere by the user lets go. Not the theme's own press on
    // QQ's send button right after the sticker (that released the stay at
    // once in .30, user diagnostics: held 2, holding false).
    if (stay && event.isTrusted && event.button === 0 && !event.target.closest?.(PANEL)) letGo("press");
    if (event.button !== 0 || !settings.stickerSend) return;
    if (!event.target.closest?.(PANEL)) return;
    const tile = stickerTile(event);
    if (!tile) return void (debug.skipped = 'not-a-sticker-tile');
    holdOpen(tile, event);
    const input = window.LiuliComposer.area();
    const editor = editorOf(input);
    if (!editor) return void (debug.skipped = 'no-editor');
    // keep a half-written message
    if (!editorEmpty(input)) return void (debug.skipped = 'draft:' + textOf(editor).length + 'ch/' + mediaCount(editor) + 'media');
    debug.armed++;
    debug.skipped = '';
    inflight = true;
    const fresh = !pending;
    hold(input, editor);
    pending = { input, before: mediaCount(editor), until: performance.now() + 2000 };
    if (fresh) requestAnimationFrame(watch);
  }
  function onClick(event) {
    const root = event.target.closest?.(PANEL);
    if (!root) return;
    const strip = tabs(root);
    if (strip?.row.contains(event.target)) return remember(event);
    // a click without a press first (keyboard, synthetic): arm here
    if (!pending && event.detail === 0) onPress({ target: event.target, button: 0 });
  }
  // Called with the mutation records of each batch (runtime.js).
  function records() {
    if (pending) watch();
  }
  function install() {
    // first, so a held-back press reaches nothing else
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) document.addEventListener(type, holdBack, true);
    document.addEventListener("click", onEmojiClick, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("mousedown", (e) => { if (!pending) onPress(e); }, true);
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointermove", onMove, { capture: true, passive: true });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") letGo("escape"); }, true);
    document.addEventListener("pointerout", onOut, true);
  }
  function configure(next) {
    settings = { ...settings, ...next };
    if (!settings.hideFileTip) showTips();
    else scanTips(document.body);
  }
  window.LiuliChatExtras = Object.freeze({
    install,
    configure,
    scanTips,
    records,
    openStickers,
    debug: () => ({ ...debug, pending: !!pending, holding: !!stay, inflight, waiting: queue.length }),
    letGo,
  });
})();
