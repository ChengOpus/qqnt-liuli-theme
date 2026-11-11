/* ============================================================
 * 琉璃 · 置顶会话独立分组（issue #55）
 * ------------------------------------------------------------
 * 为什么单独成文件：虚拟列表会反复重建、复用行节点，分组标记只能自己
 * 盯着 DOM 才能跟上；写进 index.js 会和设置面板、动效、诊断互相牵扯。
 * 对外只暴露 window.__liuliPinGroups = { apply, clear }。
 *
 * 实测到的列表结构（QQ 9.9.36）：
 *   .recent-contact
 *     .list-toggler
 *       .q-scroll-view.scroll-view--memory   ← scrollTop 在这里
 *         .viewport-list
 *           .viewport-list__measure          固定定位，里面也有一份行，忽略
 *           .viewport-list__placeholder      上占位：滚到列表顶部时高度 0
 *           .viewport-list__inner            当前渲染的行，都是它的直接子元素
 *           .viewport-list__placeholder      下占位
 *
 * 置顶行带 .recent-contact-item--top，永远排在整个列表最前面。
 * 真实的第一行必须同时满足：它是 inner 的第一个子元素，且紧挨 inner
 * 前面的上占位高度 < 1px。列表滚下去以后 inner 的第一行只是「当前窗口
 * 的第一行」，上占位会变高，这时不能标 first，否则组卡片的圆角和小标题
 * 会跟着滚动位置乱跳。
 *
 * 小标题用 padding-top 加高行盒（实测虚拟列表按行盒实际高度重新测量，
 * 加 28px 后后面的行整体下移、scrollHeight 同步变大，来回滚动不跳）。
 * 不要改成 margin：外边距不进行盒，测量会错位。
 * ============================================================ */
(() => {
  'use strict';

  const PIN = 'data-liuli-pin';
  const COUNT = 'data-liuli-pin-count';
  const HEAD_H = 28; // 小标题占的行顶部高度，和 pin-groups.css 保持一致

  // 当前配置。onToggleCollapsed 由 index.js 注入：回调里写回设置并重新 apply。
  const opts = {
    group: false,
    color: false,
    collapsed: false,
    onToggleCollapsed: null
  };

  let root = null; // .recent-contact
  let inner = null; // .viewport-list__inner
  let scroller = null; // .q-scroll-view（滚动事件源）
  let observer = null; // 挂在 root 上，inner 被替换时也能自己重挂
  let frame = 0; // requestAnimationFrame 节流句柄

  function isPinRow(node) {
    return (
      !!node &&
      node.nodeType === 1 &&
      node.classList.contains('recent-contact-item') &&
      node.classList.contains('recent-contact-item--top')
    );
  }

  function rowOf(node) {
    return node && node.closest ? node.closest('.recent-contact-item') : null;
  }

  function setAttr(node, name, value) {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }

  function dropAttr(node, name) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  }

  /* 同一会话可能被虚拟列表同时渲染两份（例如切换会话的过渡帧），
   * 「置顶 · N」里的 N 要按 data-contact-id 去重，不能数 DOM 行数。 */
  function countConversations(run) {
    const seen = new Set();
    for (let i = 0; i < run.length; i++) {
      const id = run[i].getAttribute('data-contact-id');
      seen.add(id || 'row-' + i);
    }
    return seen.size;
  }

  /* 上占位高度 < 1px 才说明这一屏是从列表最顶上开始的。
   * 没有占位节点（结构变了）就按「不是第一行」处理，宁可不画圆角，
   * 也不要在滚动中途把小组头像切掉一半。 */
  function atListTop(cur) {
    const prev = cur.previousElementSibling;
    if (!prev || !prev.classList.contains('viewport-list__placeholder')) return false;
    return prev.getBoundingClientRect().height < 1;
  }

  function clearMarks() {
    const nodes = document.querySelectorAll(
      '.recent-contact [data-liuli-pin], .recent-contact [data-liuli-pin-count]'
    );
    for (const node of nodes) {
      node.removeAttribute(PIN);
      node.removeAttribute(COUNT);
    }
    document.querySelectorAll('.recent-contact .liuli-pin-heading, .recent-contact .liuli-pin-surface').forEach(node => node.remove());
  }

  function syncHeader(row, role, countText) {
    let header = row.querySelector(':scope > .liuli-pin-heading');
    if (role !== 'first' && role !== 'single') {
      if (header) header.remove();
      return;
    }
    if (!header) {
      header = document.createElement('div');
      header.className = 'liuli-pin-heading';
      header.setAttribute('role', 'button');
      header.tabIndex = 0;
      row.appendChild(header);
    }
    const text = '置顶 · ' + countText;
    if (header.textContent !== text) header.textContent = text;
    setAttr(header, 'aria-expanded', opts.collapsed ? 'false' : 'true');
    setAttr(header, 'aria-label', (opts.collapsed ? '展开' : '折叠') + '置顶会话');
  }

  function recompute() {
    if (!root || !root.isConnected) {
      root = null;
      inner = null;
      return;
    }
    const nextInner = root.querySelector('.viewport-list__inner');
    if (nextInner !== inner) inner = nextInner;
    // 滚动容器可能比 inner 晚出现（或者被整体替换），每次重算顺手校一次。
    bindScroll();
    if (!inner) {
      clearMarks();
      return;
    }

    const rows = Array.prototype.slice.call(inner.children);
    const run = [];
    for (let i = 0; i < rows.length; i++) {
      if (!isPinRow(rows[i])) break; // 置顶行永远是一段连续前缀，遇到普通行就停
      run.push(rows[i]);
    }

    const realFirst = run.length > 0 && rows[0] === run[0] && atListTop(inner);
    const count = countConversations(run);
    const afterRun = run.length ? run[run.length - 1].nextElementSibling : null;
    const bottomSpace = inner.nextElementSibling;
    const completeRun = !!(afterRun && afterRun.classList.contains('recent-contact-item') &&
      !afterRun.classList.contains('recent-contact-item--top')) ||
      (!afterRun && bottomSpace && bottomSpace.classList.contains('viewport-list__placeholder') &&
        bottomSpace.getBoundingClientRect().height < 1);
    // 虚拟列表没渲染出组尾时只能确认下限，不能把首屏数量当成全部置顶数量。
    const countText = String(count) + (completeRun ? '' : '+');

    /* 先算出每行该是什么角色：
     *   first / single  只有真正的列表第一行才配拥有（小标题 + 上圆角）
     *   mid             组中间：只有底色
     *   last            组的真实末行：下圆角 + 和普通会话之间的间隔
     * 看不到组尾（inner 被虚拟列表截断）时一律 mid，避免圆角画在半截上。 */
    const values = new Map();
    if (run.length) {
      values.set(run[0], realFirst ? (run.length === 1 && completeRun ? 'single' : 'first') : 'mid');
      for (let i = 1; i < run.length; i++) values.set(run[i], 'mid');
      const tail = run[run.length - 1];
      const endsHere = completeRun;
      if (endsHere && run.length > 1) values.set(tail, 'last');
    }

    // inner 里的每一行都要过一遍：被复用成普通会话的旧置顶行必须清干净。
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const value = values.get(row);
      if (!value) {
        dropAttr(row, PIN);
        dropAttr(row, COUNT);
        syncHeader(row, '', '');
        continue;
      }
      setAttr(row, PIN, value);
      syncHeader(row, value, countText);
      if (value === 'first' || value === 'single') setAttr(row, COUNT, countText);
      else dropAttr(row, COUNT);
    }
    syncSurface(run, realFirst, completeRun);
  }

  // 整组只铺一层底，不能每行向外扩 2px 再叠半透明色，否则接缝会变成横线。
  function syncSurface(run, realFirst, completeRun) {
    let surface = root.querySelector(':scope > .liuli-pin-surface');
    const visible = run.filter(row => row.getBoundingClientRect().height > 0);
    if (!visible.length) {
      if (surface) surface.remove();
      return;
    }
    if (!surface) {
      surface = document.createElement('div');
      surface.className = 'liuli-pin-surface';
      surface.setAttribute('aria-hidden', 'true');
      root.appendChild(surface);
    }
    const host = root.getBoundingClientRect();
    const first = visible[0].getBoundingClientRect();
    const last = visible[visible.length - 1].getBoundingClientRect();
    const viewport = scroller ? scroller.getBoundingClientRect() : host;
    // 底板是滚动容器外的兄弟节点，必须主动裁到可视区，不能滚到搜索框后面。
    const top = Math.max(first.top, viewport.top);
    const bottom = Math.min(last.bottom, viewport.bottom);
    if (bottom <= top) {
      if (surface.style.display !== 'none') surface.style.display = 'none';
      return;
    }
    const roundTop = realFirst && first.top >= viewport.top;
    const roundBottom = (completeRun || opts.collapsed) && last.bottom <= viewport.bottom;
    const radius = (roundTop ? '12px 12px ' : '0 0 ') + (roundBottom ? '12px 12px' : '0 0');
    const css = 'display:block;left:' + (first.left - host.left) + 'px;top:' + (top - host.top) +
      'px;width:' + first.width + 'px;height:' + (bottom - top) + 'px;border-radius:' + radius + ';';
    if (surface.style.cssText !== css) surface.style.cssText = css;
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      try {
        recompute();
      } catch (e) {}
    });
  }

  /* 折叠小标题：点在标题带里的 mousedown / mouseup / click 全部在捕获阶段
   * 截住，QQ 的「打开会话」拿不到事件，就不会跳转。点在行的其他位置照常。 */
  function inHeadBand(event) {
    const row = rowOf(event.target);
    if (!row) return null;
    const role = row.getAttribute(PIN);
    if (role !== 'first' && role !== 'single') return null;
    const rect = row.getBoundingClientRect();
    const y = event.clientY - rect.top;
    if (y < 0 || y > HEAD_H) return null;
    return row;
  }

  function onGuard(event) {
    if (!opts.group) return;
    if (!inHeadBand(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== 'click') return;
    if (typeof opts.onToggleCollapsed === 'function') opts.onToggleCollapsed(!opts.collapsed);
  }

  function onHeaderKey(event) {
    if (!event.target.classList.contains('liuli-pin-heading') ||
        (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof opts.onToggleCollapsed === 'function') opts.onToggleCollapsed(!opts.collapsed);
  }

  function bindScroll() {
    const next = root.querySelector('.q-scroll-view') || root;
    if (scroller === next) return;
    if (scroller) scroller.removeEventListener('scroll', schedule);
    scroller = next;
    if (scroller) scroller.addEventListener('scroll', schedule, { passive: true });
  }

  function reflectAttrs() {
    if (!root) return;
    if (opts.color) setAttr(root, 'data-liuli-pin-color', '1');
    else dropAttr(root, 'data-liuli-pin-color');
    if (opts.collapsed) setAttr(root, 'data-liuli-pin-collapsed', '1');
    else dropAttr(root, 'data-liuli-pin-collapsed');
  }

  function bindRoot() {
    if (!root) return;
    root.addEventListener('mousedown', onGuard, true);
    root.addEventListener('mouseup', onGuard, true);
    root.addEventListener('click', onGuard, true);
    root.addEventListener('keydown', onHeaderKey, true);
    window.addEventListener('resize', schedule);
    if (!observer) {
      // 同时盯 childList 和 class：行被复用、置顶/取消置顶、inner 被整体
      // 换掉（切换账号、列表重建）都会走到这里；我们只写 data-* 属性，
      // 不在 class 过滤范围内，不会自己触发自己。
      observer = new MutationObserver(schedule);
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
    }
  }

  function unbind() {
    window.removeEventListener('resize', schedule);
    if (root) {
      root.removeEventListener('mousedown', onGuard, true);
      root.removeEventListener('mouseup', onGuard, true);
      root.removeEventListener('click', onGuard, true);
      root.removeEventListener('keydown', onHeaderKey, true);
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (scroller) {
      scroller.removeEventListener('scroll', schedule);
      scroller = null;
    }
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  function mount() {
    const next = document.querySelector('.recent-contact');
    if (next !== root || !root || !root.isConnected) {
      unbind();
      root = next;
      inner = null;
    }
    if (!root) return false;
    reflectAttrs();
    bindScroll();
    bindRoot();
    return true;
  }

  function apply(options) {
    if (options) Object.assign(opts, options);
    // group 关掉等同于 clear：不监听、不留标记，列表恢复 QQ 原样。
    if (!opts.group) {
      clear();
      return;
    }
    // 列表还没渲染出来时不要白挂监听：index.js 的结构观察者会在
    // .recent-contact 出现后再调一次 apply。
    if (!mount()) return;
    try {
      recompute();
    } catch (e) {}
  }

  function clear() {
    opts.group = false;
    unbind();
    if (root) {
      root.removeAttribute('data-liuli-pin-color');
      root.removeAttribute('data-liuli-pin-collapsed');
    }
    clearMarks();
    root = null;
    inner = null;
  }

  window.__liuliPinGroups = { apply, clear };
})();
