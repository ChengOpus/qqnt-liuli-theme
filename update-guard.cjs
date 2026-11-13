'use strict';
// Keeps QQ on the version it is running.
//
// QQ NT updates itself in place: it downloads a new build into its `versions`
// directory and records it as `curVersion` in `versions/config.json`; the next
// start loads whatever `curVersion` names. Pinning `baseVersion`/`curVersion`
// to the running build and making the file read-only stops that switch (the
// same approach NixOS's QQ package uses for `disableAutoUpdate`). A downloaded
// build may still sit on disk; it is simply never loaded.
//
// Nothing else is touched: not QQ.exe, not the loader, not the network. Turning
// the switch off only makes the file writable again; QQ resumes updating the
// next time it checks.
const fs = require('node:fs');
const path = require('node:path');

function runningVersion(appPath, appVersion) {
  // <root>/versions/9.9.36-53644/resources/app
  const parts = path.resolve(appPath).split(path.sep);
  const at = parts.lastIndexOf('versions');
  if (at >= 0 && parts[at + 1] && /^\d+(\.\d+)+-\d+$/.test(parts[at + 1])) {
    return { version: parts[at + 1], dir: parts.slice(0, at + 1).join(path.sep) || path.sep };
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(appPath, 'package.json'), 'utf8'));
    if (/^\d+(\.\d+)+-\d+$/.test(pkg.version)) return { version: pkg.version, dir: null };
  } catch {}
  return /^\d+(\.\d+)+-\d+$/.test(appVersion || '') ? { version: appVersion, dir: null } : null;
}

function candidates(app, running) {
  const list = [];
  if (running?.dir) list.push(path.join(running.dir, 'config.json'));
  for (const base of [app.getPath('appData'), app.getPath('userData')]) {
    if (!base) continue;
    list.push(path.join(base, 'QQ', 'versions', 'config.json'));
    list.push(path.join(base, 'Tencent', 'QQ', 'versions', 'config.json'));
    list.push(path.join(base, 'versions', 'config.json'));
  }
  return [...new Set(list)];
}

function writable(file, on) {
  try {
    fs.chmodSync(file, on ? 0o644 : 0o444);
    return true;
  } catch {
    return false;
  }
}

// enabled: pin; disabled: release. Returns a report for diagnostics/the UI.
function apply(app, enabled) {
  const running = runningVersion(app.getAppPath(), app.getVersion());
  const report = { enabled: !!enabled, version: running?.version || '', files: [] };
  if (!running) {
    report.error = '无法确定当前运行的 QQ 版本，未做任何修改';
    return report;
  }
  for (const file of candidates(app, running)) {
    if (!fs.existsSync(file)) continue;
    const entry = { file, action: 'none' };
    report.files.push(entry);
    try {
      if (!enabled) {
        entry.action = writable(file, true) ? 'released' : 'release-failed';
        continue;
      }
      const raw = fs.readFileSync(file, 'utf8');
      let config;
      try {
        config = JSON.parse(raw);
      } catch {
        entry.action = 'unreadable';
        continue;
      }
      const buildId = running.version.split('-').pop();
      const pinned =
        config.baseVersion === running.version &&
        config.curVersion === running.version &&
        String(config.buildId ?? buildId) === buildId;
      if (!pinned) {
        writable(file, true);
        const next = { ...config, baseVersion: running.version, curVersion: running.version, buildId };
        fs.writeFileSync(file, JSON.stringify(next, null, 2));
        entry.previous = { baseVersion: config.baseVersion, curVersion: config.curVersion };
      }
      entry.action = writable(file, false) ? (pinned ? 'kept' : 'pinned') : 'pin-not-readonly';
    } catch (error) {
      entry.action = 'failed';
      entry.error = error.message;
    }
  }
  if (!report.files.length) report.note = '没有找到 QQ 的版本配置文件（这个版本的 QQ 可能不用它更新）';
  return report;
}

module.exports = { apply, runningVersion, candidates };
