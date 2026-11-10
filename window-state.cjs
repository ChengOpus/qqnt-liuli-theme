const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, screen } = require('electron');

// Preserve upstream's QQ settings-window geometry independently of the theme dialog.
module.exports = function rememberSettingsWindows(log) {
  const file = path.join(app.getPath('userData'), 'snowlora/qqnt-liuli-theme/settings-window.json');
  function track(window) {
    const wc = window.webContents;
    let owned = false;
    let timer;
    const save = () => {
      clearTimeout(timer);
      if (window.isDestroyed() || window.isMinimized()) return;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(
          file,
          JSON.stringify({ ...window.getNormalBounds(), maximized: window.isMaximized() })
        );
      } catch (error) {
        log({ event: 'settings-window-save', error: error.message });
      }
    };
    const restore = () => {
      if (owned || !/#\/setting(?:[/?]|$)/.test(wc.getURL())) return;
      owned = true;
      try {
        if (fs.existsSync(file)) {
          const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
          const valid = ['x', 'y', 'width', 'height'].every(key => Number.isFinite(saved[key]));
          const visible =
            valid &&
            screen
              .getAllDisplays()
              .some(
                ({ workArea: a }) =>
                  Math.min(saved.x + saved.width, a.x + a.width) - Math.max(saved.x, a.x) >= 100 &&
                  Math.min(saved.y + saved.height, a.y + a.height) - Math.max(saved.y, a.y) >= 100
              );
          if (visible) {
            window.setBounds({
              x: Math.round(saved.x),
              y: Math.round(saved.y),
              width: Math.max(600, Math.round(saved.width)),
              height: Math.max(480, Math.round(saved.height))
            });
            if (saved.maximized) window.maximize();
          }
        }
      } catch (error) {
        log({ event: 'settings-window-restore', error: error.message });
      }
      const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(save, 400);
        timer.unref();
      };
      window.on('resize', schedule);
      window.on('move', schedule);
      window.on('close', save);
    };
    wc.on('did-navigate', restore);
    wc.on('did-navigate-in-page', restore);
    window.once('closed', () => clearTimeout(timer));
    restore();
  }
  app.on('browser-window-created', (_event, window) => track(window));
  for (const window of BrowserWindow.getAllWindows()) track(window);
};
