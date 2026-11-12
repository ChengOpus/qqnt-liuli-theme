/* Single renderer scheduler. Native mutations are classified once; independent
 * changes share a frame. Cached page activation is a layout event, not a poll. */
(() => {
  "use strict";
  const D = window.LiuliDOM;
  function install(hooks) {
    if (window.__liuliRuntime) return window.__liuliRuntime;
    const pending = new Set(),
      roots = new Set(),
      messages = new Set();
    let frame = 0,
      flushing = false,
      dirtyHidden = false,
      measured = [],
      flushes = 0,
      lastJobs = [];
    const own =
      ".liuli-owned-ui,#liuli-settings-dialog,#liuli-toast,.liuli-picker,.liuli-pin-label,#liuli-nav-handle,.liuli-top-hint,#liuli-ctl-shield,#liuli-video-layer";
    const structure =
      ".aio,.message-panel,.group-chat,.chat-container,.container-content,.two-col-layout__main,.chat-input-area,.chat-msg-area,.recent-contact,.container-sidebar,.window-title-bar";
    const isOwn = (node) =>
      !node || node.closest?.(own) || node.matches?.("style,script");
    const element = (node) => (node.nodeType === 1 ? node : node.parentElement);
    function invalidate(kind = "geometry") {
      pending.add(kind);
      if (!document.hidden && !frame) frame = requestAnimationFrame(flush);
      else if (document.hidden) dirtyHidden = true;
    }
    function classify(node, descendants = false) {
      const touches = (selector) =>
        node.closest(selector) || (descendants && node.querySelector(selector));
      if (touches(".chat-msg-area,.topbar-profile")) pending.add("messages");
      if (touches(".group-member,.recent-contact")) pending.add("side");
      if (touches(".chat-input-area,.expression-panel"))
        pending.add("geometry");
      if (
        node.matches(structure) ||
        (descendants && node.querySelector(structure))
      )
        pending.add("structure");
      if (
        touches(
          ".chat-func-bar,.sidebar__nav,.sidebar__menu,.window-control-area,.aio-right-click-menu",
        )
      )
        pending.add("layout");
    }
    const observer = new MutationObserver((records) => {
      if (document.hidden) {
        dirtyHidden = true;
        hooks.hidden?.();
        return;
      }
      hooks.records?.(records);
      for (const record of records) {
        const target = element(record.target);
        if (isOwn(target)) continue;
        if (
          record.type === "attributes" &&
          (target === document.body ||
            record.oldValue === target.getAttribute(record.attributeName))
        )
          continue;
        if (record.type === "childList") {
          const changed = [...record.addedNodes, ...record.removedNodes]
            .map(element)
            .filter((n) => !isOwn(n));
          if (!changed.length) continue;
          classify(target, true);
          for (const node of record.addedNodes) {
            if (!(node instanceof Element) || isOwn(node)) continue;
            roots.add(node);
            classify(node, true);
            D.within(node, ".ml-item").forEach((n) => messages.add(n));
          }
          // Removal can close a popup or activate another cached pane without adding a node.
          roots.add(target);
        } else {
          roots.add(target);
          classify(target, target.matches(structure));
        }
      }
      if (pending.size || roots.size) invalidate("roots");
    });
    let editorHeight = 0;
    const resize = new ResizeObserver((entries) => {
      const entry = entries.find((n) =>
        n.target.hasAttribute("data-liuli-composer"),
      );
      const height =
        entry?.borderBoxSize?.[0]?.blockSize || entry?.contentRect.height;
      const changed =
        height !== undefined && Math.abs(height - editorHeight) > 0.5;
      if (height !== undefined) editorHeight = height;
      // CSS owns the bounded 200ms dock transition. Do not remeasure the entire
      // composer/shell on every width-only resize; refresh once when it settles.
      if (!window.LiuliDock.moving() || changed) invalidate();
    });
    function bind(next) {
      next = [...new Set(next.filter((n) => n?.isConnected))];
      if (
        next.length === measured.length &&
        next.every((n, i) => n === measured[i])
      )
        return;
      resize.disconnect();
      measured = next;
      measured.forEach((n) => resize.observe(n));
    }
    function flush() {
      flushes++;
      frame = 0;
      if (document.hidden) {
        dirtyHidden = true;
        return;
      }
      flushing = true;
      const jobs = new Set(pending),
        changed = D.roots([...roots]),
        added = [...messages];
      lastJobs = [...jobs];
      pending.clear();
      roots.clear();
      messages.clear();
      try {
        if (jobs.has("structure")) {
          hooks.structure?.();
          jobs.add("layout");
          jobs.add("geometry");
        }
        if (jobs.has("layout")) {
          hooks.layout?.();
          jobs.add("geometry");
        }
        changed.forEach((root) => hooks.root?.(root));
        if (jobs.has("geometry")) {
          const nodes = hooks.geometry?.() || [];
          bind(nodes);
        }
        if (jobs.has("messages")) hooks.messages?.(changed, added);
        if (jobs.has("side") || jobs.has("structure")) hooks.side?.();
        if (jobs.has("messages") || jobs.has("side") || jobs.has("structure"))
          window.dispatchEvent(new Event("liuli-page-change"));
      } finally {
        observer.takeRecords();
        flushing = false;
      }
      if (pending.size && !frame) frame = requestAnimationFrame(flush);
    }
    function refresh() {
      roots.add(document.body);
      for (const kind of ["structure", "messages", "side"]) pending.add(kind);
      invalidate();
    }
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: [
        "class",
        "style",
        "hidden",
        "aria-hidden",
        "aria-label",
        "data-element-id",
      ],
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        hooks.hidden?.();
      } else if (dirtyHidden) {
        dirtyHidden = false;
        refresh();
      }
    });
    window.addEventListener("liuli-scope", refresh);
    window.addEventListener("resize", () => invalidate());
    window.addEventListener("liuli-dock-settled", () => invalidate());
    window.addEventListener("focus", () => invalidate());
    window.addEventListener("storage", (e) => {
      if (e.key?.startsWith("liuli-")) refresh();
    });
    document.addEventListener(
      "load",
      (e) => {
        if (e.target instanceof Element && !isOwn(e.target)) invalidate();
      },
      true,
    );
    const api = Object.freeze({
      invalidate,
      refresh,
      stats: () => ({
        frameQueued: !!frame,
        measured: measured.length,
        pending: pending.size,
        flushes,
        lastJobs,
      }),
    });
    window.__liuliRuntime = api;
    window.LiuliComposer.install(() => invalidate());
    window.LiuliDock.install();
    refresh();
    return api;
  }
  window.LiuliRuntime = Object.freeze({ install });
})();
