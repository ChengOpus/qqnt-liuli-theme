/* Message rows: facts the stylesheet needs about a row, written as attributes.
 *
 * The bubble styles used to ask these questions with :has() — "does this row
 * contain a self bubble", "a picker", "a card" — on every .message-container.
 * QQ's virtual list creates and destroys rows continuously while scrolling, and
 * each :has() subject made every insertion re-match whole rows: style recalc
 * during a fast flick was ~90x what the client itself spends. Answering once
 * per row, synchronously in the mutation callback (before the frame renders),
 * gives the same result with no :has() work and no one-frame flash.
 *
 * Attributes (presence = true):
 *   .message-container  data-liuli-others  has a .msg-content-container.container--others
 *                       data-liuli-self    has a .msg-content-container.container--self
 *                       data-liuli-anyself has any .container--self
 *                       data-liuli-picker  has a multi-select .msg-picker
 *   .msg-content-container data-liuli-cardlike  holds .ark-view-message / .forward-msg
 *                       data-liuli-media   holds a picture, video, ark card or forward
 *   .ml-item            data-liuli-checked its picker is checked
 */
(() => {
  "use strict";
  function flag(node, name, on) {
    if (node.hasAttribute(name) !== on) node.toggleAttribute(name, on);
  }
  function markContainer(mc) {
    let others = false,
      self = false;
    for (const bubble of mc.getElementsByClassName("msg-content-container")) {
      const list = bubble.classList;
      if (list.contains("container--others")) others = true;
      if (list.contains("container--self")) self = true;
      flag(
        bubble,
        "data-liuli-cardlike",
        !!bubble.querySelector(".ark-view-message, .forward-msg"),
      );
      flag(
        bubble,
        "data-liuli-media",
        !!bubble.querySelector(
          ".pic-element, .video-element, .ark-view-message, .forward-msg",
        ),
      );
    }
    flag(mc, "data-liuli-others", others);
    flag(mc, "data-liuli-self", self);
    flag(mc, "data-liuli-anyself", self || mc.getElementsByClassName("container--self").length > 0);
    const picker = mc.getElementsByClassName("msg-picker")[0];
    flag(mc, "data-liuli-picker", !!picker);
    const item = mc.closest(".ml-item");
    if (item) flag(item, "data-liuli-checked", !!picker?.classList.contains("is-checked"));
  }
  function mark(root) {
    if (!(root instanceof Element)) return;
    if (root.classList.contains("message-container")) markContainer(root);
    for (const mc of root.getElementsByClassName("message-container")) markContainer(mc);
  }
  // Runs inside the MutationObserver callback. Only rows touched by this batch.
  function sync(records) {
    const touched = new Set();
    for (const record of records) {
      const target =
        record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!target) continue;
      const own = target.closest(".message-container");
      if (own) touched.add(own);
      if (record.type !== "childList") continue;
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.classList.contains("message-container")) touched.add(node);
        else if (!own)
          for (const mc of node.getElementsByClassName("message-container"))
            touched.add(mc);
      }
    }
    for (const mc of touched) if (mc.isConnected) markContainer(mc);
  }
  window.LiuliRows = Object.freeze({ mark, sync });
})();
