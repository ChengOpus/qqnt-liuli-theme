/* QQ supplies .recent-contact-item--top. Keep settings compatibility without
 * observing or changing virtual rows. */
(() => {
  "use strict";
  let legacyCleaned = false;
  function removeLegacyMarks() {
    if (legacyCleaned) return;
    legacyCleaned = true;
    document
      .querySelectorAll(".recent-contact .liuli-pin-heading")
      .forEach((node) => node.remove());
    document
      .querySelectorAll(
        ".recent-contact [data-liuli-pin], .recent-contact [data-liuli-pin-count]",
      )
      .forEach((node) => {
        node.removeAttribute("data-liuli-pin");
        node.removeAttribute("data-liuli-pin-count");
      });
    document
      .querySelectorAll(".recent-contact[data-liuli-pin-collapsed]")
      .forEach((node) => node.removeAttribute("data-liuli-pin-collapsed"));
  }
  function clear() {
    removeLegacyMarks();
    if (document.body.hasAttribute("data-liuli-pin-group"))
      document.body.removeAttribute("data-liuli-pin-group");
    if (document.body.hasAttribute("data-liuli-pin-color"))
      document.body.removeAttribute("data-liuli-pin-color");
    sync();
  }
  function apply(options) {
    removeLegacyMarks();
    const group = !!options && !!options.group;
    const color = group && !!options.color;
    if (group) document.body.setAttribute("data-liuli-pin-group", "1");
    else document.body.removeAttribute("data-liuli-pin-group");
    if (color) document.body.setAttribute("data-liuli-pin-color", "1");
    else document.body.removeAttribute("data-liuli-pin-color");
    sync();
  }
  function sync() {
    const enabled = document.body.getAttribute("data-liuli-pin-group") === "1";
    const firstRows = new Set();
    if (enabled)
      for (const inner of document.querySelectorAll(
        ".recent-contact .viewport-list__inner",
      )) {
        if (inner.closest(".viewport-list__measure")) continue;
        const prev = inner.previousElementSibling;
        const placeholderHeight = prev
          ? Number.parseFloat(prev.style.height)
          : 0;
        const atTop =
          !prev ||
          !prev.matches(".viewport-list__placeholder") ||
          (Number.isFinite(placeholderHeight)
            ? placeholderHeight
            : prev.offsetHeight) < 1;
        const first = inner.firstElementChild;
        if (atTop && first?.matches(".recent-contact-item--top"))
          firstRows.add(first);
      }
    for (const old of document.querySelectorAll("[data-liuli-pin-first]")) {
      if (firstRows.has(old)) continue;
      old.removeAttribute("data-liuli-pin-first");
      old.querySelector(":scope > .liuli-pin-label")?.remove();
    }
    for (const row of firstRows) {
      row.dataset.liuliPinFirst = "";
      if (!row.querySelector(":scope > .liuli-pin-label")) {
        const label = document.createElement("div");
        label.className = "liuli-pin-label";
        label.textContent = "置顶";
        row.append(label);
      }
    }
  }
  window.__liuliPinGroups = { apply, clear, sync };
})();
