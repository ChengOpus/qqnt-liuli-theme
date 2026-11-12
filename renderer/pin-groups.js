/* QQ supplies .recent-contact-item--top. Keep settings compatibility without
 * observing or changing virtual rows. */
(() => {
  'use strict';
  let legacyCleaned = false;
  function removeLegacyMarks() {
    if (legacyCleaned) return;
    legacyCleaned = true;
    document.querySelectorAll('.recent-contact .liuli-pin-heading').forEach(node => node.remove());
    document.querySelectorAll('.recent-contact [data-liuli-pin], .recent-contact [data-liuli-pin-count]')
      .forEach(node => {
        node.removeAttribute('data-liuli-pin');
        node.removeAttribute('data-liuli-pin-count');
      });
    document.querySelectorAll('.recent-contact[data-liuli-pin-collapsed]')
      .forEach(node => node.removeAttribute('data-liuli-pin-collapsed'));
  }
  function clear() {
    removeLegacyMarks();
    if (document.body.hasAttribute('data-liuli-pin-group')) document.body.removeAttribute('data-liuli-pin-group');
    if (document.body.hasAttribute('data-liuli-pin-color')) document.body.removeAttribute('data-liuli-pin-color');
  }
  function apply(options) {
    removeLegacyMarks();
    const group = !!options && !!options.group;
    const color = group && !!options.color;
    if (document.body.hasAttribute('data-liuli-pin-group') !== group)
      document.body.toggleAttribute('data-liuli-pin-group', group);
    if (document.body.hasAttribute('data-liuli-pin-color') !== color)
      document.body.toggleAttribute('data-liuli-pin-color', color);
  }
  window.__liuliPinGroups = { apply, clear };
})();
