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

  function messageRecord(element) {
    const message = element?.closest('.message');
    if (!message) return null;
    const cached = messages.get(message);
    if (cached && !cached.isUnmounted) return cached.props.msgRecord;
    visitComponents(message, component => {
      const record = component.props?.msgRecord;
      const node = component.vnode.el;
      const owner = node?.nodeType === 1 ? node.closest('.message') : null;
      if (record && owner) messages.set(owner, component);
      return record && owner === message;
    });
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

  window.LiuliQQ = Object.freeze({ messageRecord, selfUid });
})();
