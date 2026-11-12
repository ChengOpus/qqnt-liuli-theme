/* Shared DOM boundaries. Geometry is sampled only on input/layout events. */
(() => {
  "use strict";
  const protectedUI =
    ".lucky-money-dialog,.send-lucky-money-dialog,.video-content,.av-call,.screen-share,.image-viewer,.picture-viewer,webview,embed";
  function visible(node) {
    if (
      !node?.isConnected ||
      node.closest('[hidden],[aria-hidden="true"],.viewport-list__measure')
    )
      return false;
    const rect = node.getBoundingClientRect();
    if (
      rect.width < 1 ||
      rect.height < 1 ||
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= innerHeight ||
      rect.left >= innerWidth
    )
      return false;
    const css = getComputedStyle(node);
    return css.display !== "none" && css.visibility !== "hidden";
  }
  function visibleQuery(selector, root = document) {
    return [...root.querySelectorAll(selector)].find(visible) || null;
  }
  function within(root, selector) {
    return [
      ...(root.matches?.(selector) ? [root] : []),
      ...root.querySelectorAll(selector),
    ];
  }
  function roots(nodes) {
    const set = new Set(nodes.filter((n) => n?.isConnected));
    return [...set].filter((n) => {
      for (let p = n.parentElement; p; p = p.parentElement)
        if (set.has(p)) return false;
      return true;
    });
  }
  function mainLike() {
    return (
      document.body.dataset.liuliScope === "main" ||
      /^#\/chat(?:[/?]|$)/.test(location.hash)
    );
  }
  function safe(node) {
    return (
      !document.body.hasAttribute("data-liuli-av") &&
      !node.closest(protectedUI) &&
      !node.querySelector(protectedUI)
    );
  }
  window.LiuliDOM = Object.freeze({
    visible,
    visibleQuery,
    within,
    roots,
    mainLike,
    safe,
    protectedUI,
  });
})();
