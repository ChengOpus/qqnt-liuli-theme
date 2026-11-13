/* QQ owns pin state, ordering and headings. Theme only marks existing pinned
 * rows; it never adds group headings, counts, fold controls or divider lines. */
(() => {
  "use strict";
  let options = { group: true, color: false };
  function sync() {
    const root = window.LiuliDOM.visibleQuery(".recent-contact");
    if (!root) return;
    const rows = [...root.querySelectorAll(".recent-contact-item")].filter(
      (node) => !node.closest(".viewport-list__measure"),
    );
    for (const row of rows) {
      row.toggleAttribute(
        "data-liuli-pinned",
        options.group &&
          row.matches(
            '.recent-contact-item--top,[data-is-top="true"],[data-top="true"]',
          ),
      );
      for (const key of ["data-liuli-pin-first", "data-liuli-pin-last"])
        row.removeAttribute(key);
      row.querySelector(":scope > .liuli-pin-label")?.remove();
    }
    for (const header of root.querySelectorAll("[data-liuli-pin-heading]"))
      header.removeAttribute("data-liuli-pin-heading");
  }
  function apply(next) {
    options = { group: next?.group !== false, color: next?.color === true };
    for (const [key, on] of [
      ["data-liuli-pin-group", options.group],
      ["data-liuli-pin-color", options.group && options.color],
    ]) {
      if (on && document.body.getAttribute(key) !== "1")
        document.body.setAttribute(key, "1");
      else if (!on) document.body.removeAttribute(key);
    }
    sync();
  }
  window.__liuliPinGroups = Object.freeze({
    apply,
    clear: () => apply({ group: false }),
    sync,
  });
})();
