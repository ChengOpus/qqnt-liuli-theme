/* The chat header's tool icons and the group-apps dropdown (the icon with the
 * ∨ that opens 群文件 / 群相册 / 群精华 …), as the user asked (2026-11-15):
 *   · 语音通话 / 视频通话 / 屏幕共享 leave the header and appear in that
 *     dropdown, right after 群精华;
 *   · items of the dropdown can be hidden (群作业 / 群视频 / 群课堂 by default);
 *   · both are settings.
 * Nothing of QQ's is removed or re-implemented: moved icons stay in the page,
 * hidden (display:none), and the dropdown's extra rows press them. Hidden
 * dropdown rows are only not displayed.
 */
(() => {
  'use strict';
  const HIDDEN = 'data-liuli-menu-hidden';
  const EXTRA = 'data-liuli-menu-extra';
  const MOVED = 'data-liuli-tool-moved';
  const CALLS = [
    {
      key: 'voice',
      label: '语音通话',
      test: /语音/,
      svg: '<path d="M6.6 3.5h2.6l1.5 4-2 1.5a11 11 0 0 0 6.3 6.3l1.5-2 4 1.5v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/>'
    },
    {
      key: 'video',
      label: '视频通话',
      test: /^视频|视频通话/,
      svg: '<rect x="3" y="6" width="12.5" height="12" rx="2.5"/><path d="m15.5 10.5 5-3v9l-5-3"/>'
    },
    {
      key: 'screen',
      label: '屏幕共享',
      test: /屏幕|共享/,
      svg: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20M9.5 10.5l2.5-2.5 2.5 2.5M12 8v5"/>'
    }
  ];
  let settings = { moveCalls: true, hidden: ['群作业', '群视频', '群课堂'] };
  let frame = 0;

  function labelOf(node) {
    const item = node.matches?.('[aria-label],[title]') ? node : node.querySelector?.('[aria-label],[title]');
    return String(item?.getAttribute('aria-label') || item?.getAttribute('title') || '').trim();
  }
  function actionPanels() {
    return document.querySelectorAll('.aio > .chat-header .panel-header__action');
  }
  // The header's tool icons: QQ wraps each in .bar-icon (like the composer's
  // toolbar); older builds put the .icon-item straight in the panel.
  function tools(panel) {
    const icons = [...panel.querySelectorAll('.bar-icon')];
    return icons.length ? icons : [...panel.querySelectorAll('.icon-item')];
  }
  function callTool(panel, call) {
    return tools(panel).find(tool => call.test.test(labelOf(tool)) && !/^群/.test(labelOf(tool))) || null;
  }
  function markTools() {
    for (const panel of actionPanels())
      for (const call of CALLS) {
        const tool = callTool(panel, call);
        if (!tool) continue;
        const want = settings.moveCalls && !settings.hidden.includes(call.label);
        const hide = settings.moveCalls; // moved (or hidden): not in the header
        if (tool.hasAttribute(MOVED) !== hide) tool.toggleAttribute(MOVED, hide);
        tool.dataset.liuliToolKey = want ? call.key : '';
      }
  }
  // The open dropdown's rows: the container in the menu with the most
  // children that carry text.
  function menuRows(inner) {
    let best = null;
    for (const box of [inner, ...inner.querySelectorAll('*')]) {
      const kids = [...box.children].filter(k => !k.hasAttribute(EXTRA) && k.textContent.trim());
      if (kids.length >= 2 && (!best || kids.length > best.length)) best = kids;
    }
    return best || [];
  }
  function rowLabel(row) {
    return row.textContent.replace(/\s+/g, '').trim();
  }
  function textHolder(row, text) {
    let found = null;
    for (const node of row.querySelectorAll('*'))
      if (!node.children.length && node.textContent.replace(/\s+/g, '') === text) found = node;
    return found;
  }
  function extraRow(template, call, press) {
    const nativeIcon = template.querySelector('svg, i, img, .q-svg-icon, [class*="icon"]');
    const size = Math.round(nativeIcon?.getBoundingClientRect().width || 0) || 18;
    const row = template.cloneNode(true);
    row.removeAttribute('id');
    row.removeAttribute(HIDDEN);
    row.setAttribute(EXTRA, call.key);
    for (const n of row.querySelectorAll('[id]')) n.removeAttribute('id');
    const text = textHolder(row, rowLabel(template));
    if (text) text.textContent = call.label;
    else row.textContent = call.label;
    const icon = row.querySelector('svg, i, img, .q-svg-icon, [class*="icon"]');
    if (icon) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('class', 'liuli-menu-icon');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.6');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.innerHTML = call.svg;
      svg.style.width = svg.style.height = size + 'px';
      icon.replaceWith(svg);
    }
    row.addEventListener(
      'click',
      event => {
        event.preventDefault();
        event.stopPropagation();
        press();
      },
      true
    );
    return row;
  }
  function processMenus() {
    for (const panel of actionPanels()) {
      for (const inner of panel.querySelectorAll('.bar-more-menu-inner')) {
        const rows = menuRows(inner);
        if (!rows.length) continue;
        for (const row of rows) {
          const hide = settings.hidden.includes(rowLabel(row));
          if (row.hasAttribute(HIDDEN) !== hide) row.toggleAttribute(HIDDEN, hide);
        }
        const host = inner.closest('.bar-icon');
        const anchor = rows.find(r => rowLabel(r) === '群精华') || rows[rows.length - 1];
        const template = rows.find(r => !r.hasAttribute(HIDDEN)) || rows[0];
        let after = anchor;
        for (const call of CALLS) {
          const existing = inner.querySelector('[' + EXTRA + '="' + call.key + '"]');
          const tool = callTool(panel, call);
          const want = settings.moveCalls && tool && !settings.hidden.includes(call.label);
          if (!want) {
            existing?.remove();
            continue;
          }
          const row =
            existing ||
            extraRow(template, call, () => {
              const item = tool.matches('.icon-item') ? tool : tool.querySelector('.icon-item') || tool;
              item.click();
              // close the dropdown the way QQ does: its own icon toggles it
              requestAnimationFrame(() => {
                if (inner.isConnected && inner.getClientRects().length && host)
                  host.querySelector(':scope > .icon-item')?.click();
              });
            });
          if (row.previousElementSibling !== after) after.after(row);
          after = row;
        }
      }
    }
  }
  // ── Group drawer (the header's ⋯) ──────────────────────────────────────
  // Placed under the top row: left edge with the action panel, right edge
  // with the window controls (or the header's right edge), top 8px below
  // them, bottom with the pane. While it is open the member panel steps out
  // (data-liuli-drawer on the pane; CSS fades it), and comes back after.
  function drawer() {
    for (const aio of document.querySelectorAll('.aio')) {
      const panel = aio.querySelector('.side-panel');
      const open = !!panel && onScreen(panel);
      if (aio.hasAttribute('data-liuli-drawer') !== open) aio.toggleAttribute('data-liuli-drawer', open);
      if (!open) continue;
      const action = aio.querySelector(':scope > .chat-header .panel-header__action')?.getBoundingClientRect();
      const header = aio.querySelector(':scope > .chat-header')?.getBoundingClientRect();
      if (!action || !header || !action.width) continue;
      const controls = document.querySelector('.window-title-bar .window-control-area');
      const c = controls?.getBoundingClientRect();
      const pinned = controls && getComputedStyle(controls).opacity !== '0' && c.width > 0 && c.left > action.right;
      const right = pinned ? c.right : header.right;
      const left = Math.min(action.left, right - 260);
      const top = Math.max(header.bottom, pinned ? c.bottom : 0) + 8;
      const vars = { '--ll-drawer-left': left, '--ll-drawer-width': right - left, '--ll-drawer-top': top };
      for (const [k, v] of Object.entries(vars)) {
        const px = Math.round(v) + 'px';
        if (aio.style.getPropertyValue(k) !== px) aio.style.setProperty(k, px);
      }
    }
  }
  // ── Auto-hiding action panel ────────────────────────────────────────────
  // Hidden by default; it drops down from the top while the pointer is in the
  // header band right of the title (or on the panel), and stays while its
  // dropdown or the group drawer is open. Setting: autoHideActions.
  let autoHide = true;
  let hideTimer = 0;
  let pointer = { x: -1, y: -1 };
  // Really on screen: laid out, inside the window, visible and not faded.
  // QQ keeps menus and the drawer mounted (invisible) after first use; a
  // mounted-but-hidden one used to hold the panel open for good.
  function onScreen(node) {
    const r = node.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
    for (let n = node; n && n !== document.body; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.visibility === 'hidden' || c.display === 'none' || parseFloat(c.opacity) < 0.1) return false;
    }
    return true;
  }
  function held(aio) {
    if (aio.hasAttribute('data-liuli-drawer')) return true;
    for (const inner of aio.querySelectorAll(':scope > .chat-header .bar-more-menu-inner'))
      if (inner.childElementCount && onScreen(inner)) return true;
    return false;
  }
  // Where the panel rests, without its hidden offset: offsets ignore the
  // translate that parks it above the window.
  function restRect(panel) {
    let x = 0, y = 0;
    for (let n = panel; n; n = n.offsetParent) {
      x += n.offsetLeft;
      y += n.offsetTop;
      if (getComputedStyle(n).position === 'fixed') break;
    }
    return { left: x, top: y, right: x + panel.offsetWidth, bottom: y + panel.offsetHeight };
  }
  // The header band is a window-drag region: Windows sends the page no
  // pointer events there, so a parked panel could only be reached from the
  // no-drag window controls next to it (user, 2026-11-15). A transparent,
  // no-drag sensor sits where the panel rests.
  let sensor = null;
  function placeSensor(aio, panel) {
    if (!sensor) {
      sensor = document.createElement('div');
      sensor.id = 'liuli-actions-sensor';
      sensor.setAttribute('aria-hidden', 'true');
      document.body.append(sensor);
    }
    // only while the panel is parked: once shown, the panel itself (no-drag)
    // takes the pointer and the sensor must not cover its buttons
    if (!autoHide || !panel || aio.hasAttribute('data-liuli-actions-shown')) {
      sensor.style.display = 'none';
      return;
    }
    const r = restRect(panel);
    const pad = 6;
    Object.assign(sensor.style, {
      display: 'block',
      left: Math.round(r.left - pad) + 'px',
      top: Math.max(0, Math.round(r.top - pad)) + 'px',
      width: Math.round(r.right - r.left + pad * 2) + 'px',
      height: Math.round(r.bottom - Math.max(0, r.top - pad) + pad) + 'px'
    });
  }
  function inZone(aio) {
    const panel = aio.querySelector(':scope > .chat-header .panel-header__action');
    if (!panel || pointer.x < 0) return false;
    const r = restRect(panel);
    return pointer.x >= r.left - 6 && pointer.x <= r.right + 6 && pointer.y >= 0 && pointer.y <= r.bottom + 6;
  }
  function revealPass() {
    document.body.toggleAttribute('data-liuli-autohide-actions', autoHide);
    let visiblePane = null;
    for (const aio of document.querySelectorAll('.aio')) {
      if (!aio.getClientRects().length) continue;
      visiblePane = aio;
      const want = !autoHide || inZone(aio) || held(aio);
      const shown = aio.hasAttribute('data-liuli-actions-shown');
      if (want) {
        clearTimeout(hideTimer);
        hideTimer = 0;
        if (!shown) aio.setAttribute('data-liuli-actions-shown', '');
      } else if (shown && !hideTimer) {
        hideTimer = setTimeout(() => {
          hideTimer = 0;
          if (autoHide && !(inZone(aio) || held(aio))) aio.removeAttribute('data-liuli-actions-shown');
        }, 350);
      }
    }
    placeSensor(visiblePane, visiblePane?.querySelector(':scope > .chat-header .panel-header__action'));
  }
  let moveFrame = 0;
  addEventListener(
    'pointermove',
    e => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!moveFrame)
        moveFrame = requestAnimationFrame(() => {
          moveFrame = 0;
          revealPass();
        });
    },
    { passive: true, capture: true }
  );
  document.addEventListener('pointerleave', () => {
    pointer = { x: -1, y: -1 };
    revealPass();
  });
  function apply() {
    frame = 0;
    markTools();
    processMenus();
    drawer();
    revealPass();
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(apply);
  }
  // mutation records of each runtime batch: react to the header only
  const WATCH = '.chat-header, .aio, .side-panel';
  function records(list) {
    for (const record of list) {
      const target = record.target;
      if (target instanceof Element && target.closest('.chat-header, .side-panel')) return schedule();
      for (const nodes of [record.addedNodes, record.removedNodes])
        for (const node of nodes)
          if (node instanceof Element && (node.matches(WATCH) || node.querySelector?.('.chat-header, .side-panel')))
            return schedule();
    }
  }
  addEventListener('resize', schedule);
  function configure(next) {
    autoHide = next.autoHide !== false;
    settings = {
      moveCalls: next.moveCalls !== false,
      hidden: Array.isArray(next.hidden) ? next.hidden.map(String) : settings.hidden
    };
    schedule();
  }
  // for diagnostics: the header's tool labels and an open menu's row labels
  function report() {
    return [...actionPanels()].map(panel => ({
      tools: tools(panel).map(t => ({ label: labelOf(t), moved: t.hasAttribute(MOVED) })),
      menus: [...panel.querySelectorAll('.bar-more-menu-inner')].map(inner => ({
        rows: menuRows(inner).map(r => ({ label: rowLabel(r).slice(0, 12), hidden: r.hasAttribute(HIDDEN) })),
        extras: [...inner.querySelectorAll('[' + EXTRA + ']')].map(r => r.getAttribute(EXTRA))
      }))
    }));
  }
  window.LiuliHeaderTools = Object.freeze({ apply, schedule, records, configure, report, CALLS: CALLS.map(c => c.label) });
})();
