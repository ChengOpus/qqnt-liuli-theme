/* QQ owns pin state and ordering. Theme markers do not depend on a particular
 * virtual-list wrapper, inject counts, or implement another collapse control. */
(() => {
  "use strict";
  let options = { group: true, color: false };
  function sync() {
    const root = window.LiuliDOM.visibleQuery(".recent-contact");
    if (!root) return;
    const rows = [...root.querySelectorAll(".recent-contact-item")].filter(
      (n) => !n.closest(".viewport-list__measure"),
    );
    const pinned = rows.filter((n) =>
      n.matches(
        '.recent-contact-item--top,[data-is-top="true"],[data-top="true"]',
      ),
    );
    const headers = [...root.querySelectorAll("div,span,button")].filter(
      (n) =>
        !n.closest(".recent-contact-item,.main-search") &&
        n.children.length === 0 &&
        /^置顶(?:\s*[（(]?\d+[）)]?)?$/.test(n.textContent.trim()),
    );
    const nativeHeader = headers[0];
    const first = pinned[0],
      last = pinned.at(-1);
    for (const row of rows) {
      row.toggleAttribute(
        "data-liuli-pinned",
        options.group && pinned.includes(row),
      );
      row.toggleAttribute("data-liuli-pin-last", options.group && row === last);
      row.toggleAttribute(
        "data-liuli-pin-first",
        options.group && !nativeHeader && row === first,
      );
      const old = row.querySelector(":scope > .liuli-pin-label");
      if (!options.group || nativeHeader || row !== first) old?.remove();
      else if (!old) {
        const label = document.createElement("div");
        label.className = "liuli-pin-label liuli-owned-ui";
        label.textContent = "置顶";
        row.append(label);
      }
    }
    for (const header of root.querySelectorAll("[data-liuli-pin-heading]"))
      header.removeAttribute("data-liuli-pin-heading");
    if (options.group && nativeHeader) {
      const parent = nativeHeader.parentElement;
      const heading =
        parent && parent.getBoundingClientRect().height < 48
          ? parent
          : nativeHeader;
      heading.dataset.liuliPinHeading = "";
    }
  }
  function apply(next) {
    options = { group: next?.group !== false, color: next?.color === true };
    for (const [key, on] of [
      ["data-liuli-pin-group", options.group],
      ["data-liuli-pin-color", options.group && options.color],
    ]) {
      if (on) document.body.setAttribute(key, "1");
      else document.body.removeAttribute(key);
    }
    sync();
  }
  function clear() {
    apply({ group: false, color: false });
  }
  window.__liuliPinGroups = Object.freeze({ apply, clear, sync });
})();
