const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { app, screen, shell } = require('electron');
const { buildZip } = require('./zip.cjs');

module.exports = function createDiagnostics(root, windows) {
  const directory = path.join(app.getPath('userData'), 'theme-diagnostics');
  const logs = [];
  const exports = new Set();
  let exporting = false;
  const redact = text => String(text).split(os.homedir()).join('~');
  const log = entry => {
    logs.push({
      time: new Date().toISOString(),
      entry: redact(JSON.stringify(entry)).slice(0, 8192)
    });
    if (logs.length > 500) logs.shift();
  };

  function inventory(directory = root) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return inventory(file);
      if (!entry.isFile()) return [];
      const bytes = fs.readFileSync(file);
      return [
        {
          name: path.relative(root, file).replaceAll('\\', '/'),
          bytes: bytes.length,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex')
        }
      ];
    });
  }

  async function exportReport(payload) {
    if (exporting) throw new Error('诊断导出正在进行');
    if (!payload || typeof payload.snapshot !== 'object') throw new Error('缺少诊断快照');
    exporting = true;
    try {
      const entries = [];
      const json = (name, value) =>
        entries.push({ name, data: redact(JSON.stringify(value, null, 2)) });
      const screenshotResults = [];
      json('renderer/request.json', payload);
      json('host/environment.json', {
        generatedAt: new Date().toISOString(),
        app: { name: app.getName(), version: app.getVersion() },
        versions: process.versions,
        platform: process.platform,
        arch: process.arch,
        os: {
          release: os.release(),
          version: os.version(),
          memory: os.totalmem(),
          free: os.freemem(),
          cpus: os.cpus().length
        },
        memory: process.memoryUsage(),
        metrics: app.getAppMetrics(),
        gpu: app.getGPUFeatureStatus(),
        displays: screen.getAllDisplays(),
        themeRoot: root
      });
      json('theme/files.json', inventory());
      for (const wc of windows()) {
        if (wc.isDestroyed()) continue;
        const id = String(wc.id);
        try {
          const snapshot = await wc.executeJavaScript(
            `window.LiuliDiag?.collectDiagnostics({files:true,quota:true,wallpaperDecode:true,defaultWallpaper:true})`
          );
          if (snapshot) json('renderer/window-' + id + '.json', snapshot);
          const frame = await wc.executeJavaScript(`(() => {
            const dialog = document.querySelector('#liuli-settings-dialog[open]');
            const rect = dialog?.getBoundingClientRect();
            const x = Math.max(0, Math.ceil(rect?.x || 0)), y = Math.max(0, Math.ceil(rect?.y || 0));
            return {rect:rect ? {x,y,width:Math.max(0,Math.floor(Math.min(innerWidth,rect.right))-x),height:Math.max(0,Math.floor(Math.min(innerHeight,rect.bottom))-y)} : null};
          })()`);
          const capture = payload.opts?.screenshots === true ? undefined : frame.rect;
          if (capture === undefined || (capture && capture.width > 0 && capture.height > 0)) {
            const image = await wc.capturePage(capture);
            if (image.isEmpty()) throw new Error('窗口截图为空');
            const name = 'screenshots/' + (capture ? 'settings-' : 'window-') + id + '.png';
            entries.push({ name, data: image.toPNG() });
            screenshotResults.push({ window: id, name, scope: capture ? 'settings' : 'window' });
          }
          if (payload.opts?.wallpaperPreview === true) {
            const preview = await wc.executeJavaScript(`(async () => {
              const source=JSON.parse(localStorage.getItem('liuli-dsh-wallpaper') || '{}').src;
              if (!source) return null;
              const image=new Image(); image.src=source; await image.decode();
              const scale=Math.min(1,640/image.naturalWidth,640/image.naturalHeight);
              const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
              canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
              return canvas.toDataURL('image/jpeg',0.75);
            })()`);
            if (preview)
              entries.push({
                name: 'wallpaper/window-' + id + '.jpg',
                data: Buffer.from(preview.split(',')[1], 'base64')
              });
          }
        } catch (error) {
          json('renderer/window-' + id + '-error.json', { error: error.message });
        }
      }
      json('screenshots/index.json', screenshotResults);
      entries.push({
        name: 'logs/session.jsonl',
        data: logs.map(entry => JSON.stringify(entry)).join('\n')
      });
      entries.push({
        name: 'README.txt',
        data: '主题诊断。默认仅截图主题设置层；只有主动勾选时才包含聊天窗口截图及壁纸预览。\n包含运行环境、资源哈希、各主题窗口的样式/布局/壁纸/性能检查与会话错误。\n'
      });
      const zip = buildZip(entries);
      fs.mkdirSync(directory, { recursive: true });
      const destination = path.join(
        directory,
        'diagnostics-' +
          new Date().toISOString().replace(/[:.]/g, '-') +
          '-' +
          crypto.randomUUID().slice(0, 8) +
          '.zip'
      );
      fs.writeFileSync(destination, zip, { flag: 'wx' });
      exports.add(destination);
      return { ok: true, path: destination, size: zip.length };
    } finally {
      exporting = false;
    }
  }

  return {
    log,
    exportReport,
    openPath(file) {
      if (!exports.has(file) || !fs.existsSync(file)) throw new Error('不是本次会话导出的诊断文件');
      shell.showItemInFolder(file);
      return true;
    }
  };
};
