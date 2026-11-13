/* Proxy icons have local geometry; they do not clone QQ SVG mask/gradient IDs. */
(() => {
  const paths = {
    更多: '<path d="M12 5v14M5 12h14"/>',
    表情包: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8l-6 6H6a2 2 0 0 1-2-2z"/><path d="M14 20v-4a2 2 0 0 1 2-2h4"/><path d="M8.5 9.5h.01M13.5 9.5h.01M8.5 13q2 2 4 0"/>',
    表情: '<circle cx="12" cy="12" r="9"/><path d="M8 14q4 5 8 0M8.5 9h.01M15.5 9h.01"/>',
    截图: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8 8 13 13M8 16 21 3"/>',
    文件: '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3z"/>',
    图片: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-7 5 8"/>',
    语音: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    聊天记录: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    红包: '<rect x="4" y="3" width="16" height="19" rx="3"/><path d="M4 7q8 9 16 0"/><circle cx="12" cy="10" r="2"/>',
    翻译: '<path d="M2 5h12M8 2v3M4 5q1 7 9 10M12 5Q10 12 2 16M14 21l4-11 4 11M15 18h6"/>',
  };
  function svg(label) {
    const key =
      (paths[label] && label) || Object.keys(paths).find((k) => label.includes(k)) || "更多";
    return (
      '<svg class="liuli-ui-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      paths[key] +
      "</svg>"
    );
  }
  window.LiuliIcons = Object.freeze({ svg });
})();
