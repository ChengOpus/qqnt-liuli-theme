(() => {
  const messages = new WeakMap();
  let profileStore;

  // QQ's production Vue roots expose vnodes, but not LiteLoader's __VUE__ field.
  function visitComponents(element, visit) {
    for (let root = element; root; root = root.parentElement) {
      if (!root._vnode) continue;
      const stack = [root._vnode];
      const seen = new Set();
      while (stack.length) {
        const vnode = stack.pop();
        if (!vnode || typeof vnode !== 'object' || seen.has(vnode)) continue;
        seen.add(vnode);
        const component = vnode.component;
        if (component && !component.isUnmounted) {
          if (visit(component)) return;
          stack.push(component.subTree);
        }
        if (Array.isArray(vnode.children)) stack.push(...vnode.children);
        if (Array.isArray(vnode.dynamicChildren)) stack.push(...vnode.dynamicChildren);
        stack.push(vnode.suspense?.activeBranch);
      }
    }
  }

  // The component that renders a message list. A lookup that misses the cache
  // used to walk the whole application's vnode tree from the root — sidebar,
  // contact list, every open pane — once per batch of new rows. With the list
  // component known, only that list's subtree is walked.
  const LIST = '.ml-list, .ml-root, .ml-area, .chat-msg-area';
  const lists = new WeakMap(); // list element -> component
  function listScope(message) {
    for (let node = message.parentElement; node; node = node.parentElement) {
      if (!node.matches(LIST)) continue;
      const component = lists.get(node);
      if (component && !component.isUnmounted) return component.subTree;
    }
    return null;
  }
  function walk(vnode, visit) {
    const stack = [vnode];
    const seen = new Set();
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      const component = node.component;
      if (component && !component.isUnmounted) {
        if (visit(component)) return true;
        stack.push(component.subTree);
      }
      if (Array.isArray(node.children)) stack.push(...node.children);
      if (Array.isArray(node.dynamicChildren)) stack.push(...node.dynamicChildren);
      stack.push(node.suspense?.activeBranch);
    }
    return false;
  }
  function messageRecord(element) {
    const message = element?.closest('.message');
    if (!message) return null;
    const cached = messages.get(message);
    if (cached && !cached.isUnmounted) return cached.props.msgRecord;
    const visit = component => {
      const node = component.vnode.el;
      if (node?.nodeType === 1 && node.matches(LIST) && !lists.has(node)) lists.set(node, component);
      const record = component.props?.msgRecord;
      const owner = record && node?.nodeType === 1 ? node.closest('.message') : null;
      if (owner) messages.set(owner, component);
      return !!record && owner === message;
    };
    const scope = listScope(message);
    if (!(scope && walk(scope, visit))) visitComponents(message, visit);
    return messages.get(message)?.props.msgRecord || null;
  }

  function selfUid() {
    if (profileStore?.selfProfileInfo?.uid) return String(profileStore.selfProfileInfo.uid);
    visitComponents(document.querySelector('.topbar-profile'), component => {
      const serviceContainer = component.setupState?.qq_container__vue;
      const bindings = serviceContainer?.container?._bindingDictionary?._map;
      if (!bindings) return false;
      // Read already-created services; never instantiate or call QQ services.
      for (const group of bindings.values()) {
        for (const binding of group) {
          if (binding.cache?.selfProfileInfo?.uid) {
            profileStore = binding.cache;
            return true;
          }
        }
      }
      return false;
    });
    return profileStore?.selfProfileInfo?.uid ? String(profileStore.selfProfileInfo.uid) : '';
  }

  let shortcutComponent;
  const shortcutDefaults = new WeakMap();
  function sidebarShortcut(mode) {
    const anchor = document.querySelector('.sidebar__menu .func-menu-more-component .icon-item');
    if (!anchor) return false;
    const suitable = component => {
      const node = component.vnode?.el;
      return component.ctx?.switchHMenuItem && component.setupState?.allMenuConfig &&
        node?.nodeType === 1 && node.contains(anchor);
    };
    if (!shortcutComponent || shortcutComponent.isUnmounted || !suitable(shortcutComponent)) {
      shortcutComponent = null;
      // 仅使用已存在的渲染组件；不写 QQ 的账户配置，也不调用持久化服务。
      for (let c = anchor.__VUE__?.[0]; c; c = c.parent) {
        if (suitable(c)) { shortcutComponent = c; break; }
      }
      if (!shortcutComponent) visitComponents(anchor, c => {
        if (!suitable(c)) return false;
        shortcutComponent = c;
        return true;
      });
    }
    const component = shortcutComponent;
    const items = component?.ctx?.items;
    if (!Array.isArray(items)) return false;
    const index = items.findIndex(item => item.id === 8 || item.id === 9);
    if (index < 0) return false;
    if (!shortcutDefaults.has(component)) shortcutDefaults.set(component, items[index]);
    const desired = mode === 'favorite' ? component.setupState.allMenuConfig[8] :
      mode === 'mail' ? component.setupState.allMenuConfig[9] : shortcutDefaults.get(component);
    if (!desired) return false;
    if (items[index].id !== desired.id) {
      items.splice(index, 1, desired);
      component.proxy?.$forceUpdate();
    }
    return true;
  }

  // ── Exact unread counts for the conversation list ────────────────────────
  // QQ prints "99+"; the row's component knows the number. The list's own
  // component is found once (cached), then only its subtree is walked.
  let contactList = null;
  const UNREAD_KEY = /^(unread(Cnt|Count|Num|MsgCnt|MsgCount)?|unreadCnt)$/i;
  function unreadIn(object, depth = 0) {
    if (!object || typeof object !== 'object' || depth > 3) return null;
    let found = null;
    for (const key of Object.keys(object)) {
      let value;
      try {
        value = object[key];
      } catch (e) {
        continue;
      }
      if (UNREAD_KEY.test(key)) {
        const n = typeof value === 'string' ? Number(value) : value;
        if (Number.isFinite(n) && n >= 0) return n;
      }
      if (found == null && value && typeof value === 'object' && !(value instanceof Node) && !Array.isArray(value))
        found = unreadIn(value, depth + 1);
    }
    return found;
  }
  // Map of row element -> unread count, for the rows currently rendered.
  function unreadCounts(listElement) {
    const out = new Map();
    if (!listElement) return out;
    if (!contactList || contactList.isUnmounted || !listElement.contains(contactList.vnode.el)) {
      contactList = null;
      visitComponents(listElement, component => {
        const el = component.vnode.el;
        if (el?.nodeType === 1 && el.matches('.recent-contact, .recent-contact-list, .recent-contact .q-scroll-view')) {
          contactList = component;
          return true;
        }
        return false;
      });
    }
    if (!contactList) return out;
    walk(contactList.subTree, component => {
      const el = component.vnode.el;
      const row = el?.nodeType === 1 ? el.closest?.('.recent-contact-item') || (el.querySelector?.(':scope > .recent-contact-item') ?? null) : null;
      if (!row || out.has(row)) return false;
      const n = unreadIn(component.props) ?? unreadIn(component.setupState);
      if (n != null) out.set(row, n);
      return false;
    });
    return out;
  }
  window.LiuliQQ = Object.freeze({ messageRecord, selfUid, sidebarShortcut, unreadCounts });
})();
