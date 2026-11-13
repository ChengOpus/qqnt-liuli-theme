(() => {
  const { token, assets, info, wallpaper } = bootstrap;
  const send = console.debug.bind(console);
  const pending = new Map();
  let sequence = 0;
  function request(method, argument) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('主题宿主响应超时：' + method));
      }, 60000);
      pending.set(id, { resolve, reject, timer });
      send(token + JSON.stringify({ id, method, argument }));
    });
  }
  window.LiuliHost = Object.freeze({
    info,
    wallpaper,
    async readAsset(name) {
      return assets[name] || { name, fetchOk: false, status: 404, bytes: 0, text: '' };
    },
    selfUid: () => request('selfUid'),
    openExternal: url => request('openExternal', url),
    updateGuard: enabled => request('updateGuard', enabled),
    diagExport: payload => request('diagExport', payload),
    diagOpenPath: path => request('diagOpenPath', path),
    diagLog: entry => send(token + JSON.stringify({ id: 0, method: 'diagLog', argument: entry })),
    reply(id, result, error) {
      const task = pending.get(id);
      if (!task) return;
      pending.delete(id);
      clearTimeout(task.timer);
      if (error) task.reject(new Error(error));
      else task.resolve(result);
    }
  });
})();
