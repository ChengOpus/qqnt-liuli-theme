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
  const debug = { armed: 0, landed: 0, sent: 0, kept: 0, held: 0, reopened: 0, restored: 0, ended: '', closedOnLeave: 0, released: '', last: '', skipped: '' };
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
  function mediaNodes(editor) {
    return [...editor.querySelectorAll(MEDIA_IN_EDITOR + ', .file-element, .face-element')].filter(
      (node) => !node.matches(HELPER) && !node.closest(HELPER),
    );
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
    } else if (editor) {
      editor.focus();
      for (const type of ['keydown', 'keypress', 'keyup'])
        editor.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      debug.last = 'enter';
    }
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
    holdTimer = setTimeout(() => release(input), 4000);
  }
  function release(input) {
    clearTimeout(holdTimer);
    holdTimer = 0;
    if (!input) return;
    input.removeAttribute('data-liuli-sticker-sending');
    input.style.removeProperty('--ll-sticker-hold');
  }
  // ── Sending ───────────────────────────────────────────────────────────
  // A burst of sticker presses: QQ puts each sticker into the editor itself;
  // whenever the editor holds pictures and no text, they are sent — then the
  // next ones that land, and so on, until no sticker has been pressed for a
  // moment. (.34 held fast presses back and replayed them; in QQ the replay
  // did not always insert, and each miss waited out a 2 s timeout: user
  // diagnostics armed 6, landed 3.) Stickers that land together before a
  // send go out together.
  let burst = null;
  let looping = false;
  function arm(input, editor) {
    const now = performance.now();
    if (!burst || burst.input !== input) burst = { input, until: now + 2000, sending: false, sentAt: 0, seenAt: 0, entered: false, expect: 0 };
    else burst.until = Math.max(burst.until, now + 2000);
    // stickers pressed and not yet sent: only those make the editor go out
    // (an emoji added a moment later is the reader's, not part of the burst)
    burst.expect++;
    pending = burst;
    hold(input, editor);
    if (!looping) {
      looping = true;
      requestAnimationFrame(tick);
    }
  }
  function finish(reason) {
    const b = burst;
    burst = null;
    pending = null;
    looping = false;
    if (reason) debug.ended = reason;
    // (not if a new burst has started on the same editor in the meantime)
    if (b) requestAnimationFrame(() => (!burst || burst.input !== b.input) && release(b.input));
  }
  function tick() {
    const b = burst;
    if (!b) return void (looping = false);
    const now = performance.now();
    const editor = editorOf(b.input);
    if (!editor?.isConnected) return finish("no-editor");
    const media = mediaCount(editor);
    // the reader started typing: leave the draft alone
    if (textOf(editor) !== "") return finish("text");
    if (b.sending) {
      // done once the pictures this send took are out of the editor — a
      // sticker that landed right after may already be there
      if (media === 0 || !b.sentNodes.some((n) => n.isConnected && editor.contains(n))) b.sending = false;
      else if (!b.entered && now - b.sentAt > 700) {
        // the button did not take: Enter, the key the reader sends with
        b.entered = true;
        editor.focus();
        for (const type of ["keydown", "keypress", "keyup"])
          editor.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        debug.last = "button+enter";
      } else if (now - b.sentAt > 1400) {
        debug.kept++;
        return finish("kept");
      }
    }
    if (!b.sending && media > 0 && b.expect > 0) {
      // after ProseMirror has finished its own transaction
      if (!b.seenAt) b.seenAt = now;
      else if (now - b.seenAt >= 30) {
        b.seenAt = 0;
        b.entered = false;
        debug.landed++;
        // the stickers in the editor go out with this send; presses whose
        // sticker has not landed yet are still expected
        b.expect = Math.max(0, b.expect - media);
        b.sentNodes = mediaNodes(editor);
        press(b.input);
        b.sending = true;
        b.sentAt = now;
        b.until = Math.max(b.until, now + 600);
      }
    } else if (!b.sending) b.seenAt = 0;
    // done: nothing on its way, nothing more expected (or the expected
    // sticker never arrived)
    if (!b.sending && (b.expect === 0 || now > b.until)) return finish(b.expect === 0 ? "sent" : "idle");
    requestAnimationFrame(tick);
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
  const watcher = new MutationObserver((records) => {
    if (!stay) return;
    if (!stay.sheet.isConnected) return letGo("gone");
    // QQ hides it with an inline display:none (v-show). That is read from the
    // attribute: asking for the computed style here would make the browser
    // lay the panel out hidden, which drops the grid's scroll position and
    // makes it lay the whole grid out again when it is shown.
    let hidden = stay.sheet.style.display === "none";
    if (!hidden && records.some((r) => r.attributeName !== "style")) hidden = getComputedStyle(stay.sheet).display === "none";
    if (!hidden) return;
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
    // the grid where the reader was (QQ's reopen can start it at the top)
    const scrolls = stay.scrolls || [];
    const restore = () => {
      for (const [el, top] of scrolls)
        if (el.isConnected && Math.abs(el.scrollTop - top) > 1) {
          el.scrollTop = top;
          debug.restored++;
        }
    };
    queueMicrotask(() => queueMicrotask(restore));
    requestAnimationFrame(restore);
    setTimeout(restore, 60);
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
    // where the grid is scrolled to, read while it is still shown
    const scrolls = [];
    for (const el of root.querySelectorAll(".q-scroll-view, [class*='scroll']")) if (el.scrollTop > 0) scrolls.push([el, el.scrollTop]);
    stay = { root, sheet, box, scrolls, until: performance.now() + 3000, count: 0, reopened: stay?.reopened || false };
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
    // keep a half-written message (pictures in it count, unless they are
    // the stickers of the burst still on their way out)
    if (textOf(editor) !== '' || (mediaCount(editor) > 0 && !burst))
      return void (debug.skipped = 'draft:' + textOf(editor).length + 'ch/' + mediaCount(editor) + 'media');
    debug.armed++;
    debug.skipped = '';
    arm(input, editor);
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
  function records() {}
  function install() {
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
    debug: () => ({ ...debug, pending: !!pending, holding: !!stay, burst: !!burst }),
    letGo,
  });
})();
