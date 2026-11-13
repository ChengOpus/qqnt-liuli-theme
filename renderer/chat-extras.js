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
  let pending = null;
  function editorEmpty(input) {
    const editor = input?.querySelector(".ProseMirror, [contenteditable]");
    return (
      !!editor &&
      editor.textContent.trim() === "" &&
      !editor.querySelector("img, .image-element, .file-element, .face-element")
    );
  }
  function onClick(event) {
    const root = event.target.closest?.(PANEL);
    if (!root) return;
    const strip = tabs(root);
    if (strip?.row.contains(event.target)) return remember(event);
    if (!settings.stickerSend) return;
    const tile = event.target.closest("img, [class*='sticker'], [class*='item'], [class*='emoji']") || event.target;
    const r = tile.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) return; // an emoji, not a sticker
    const input = window.LiuliComposer.area();
    if (!input || !editorEmpty(input)) return; // keep a half-written message
    clearTimeout(pending?.timer);
    pending = {
      input,
      timer: setTimeout(() => (pending = null), 1200),
    };
  }
  // Called with the mutation records of each batch (runtime.js).
  function records(list) {
    if (!pending) return;
    const { input } = pending;
    for (const record of list) {
      if (record.type !== "childList" || !input.contains(record.target)) continue;
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (!(node.matches("img, .image-element") || node.querySelector("img, .image-element"))) continue;
        clearTimeout(pending.timer);
        pending = null;
        // the innermost control first: QQ's handler sits on the button itself
        const send =
          input.querySelector(".operation .send-msg") ||
          input.querySelector(".operation .send") ||
          input.querySelector(".send-btn-wrap");
        // after ProseMirror has finished its own transaction
        setTimeout(() => send?.click(), 0);
        return;
      }
    }
  }
  function install() {
    document.addEventListener("click", onEmojiClick, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerover", onOver, true);
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
  });
})();
