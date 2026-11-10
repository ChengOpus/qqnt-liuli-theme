# 琉璃主题 · SnowLora 适配版（移植说明）

> 基线：SnowLora `344e549` 内置的适配主题（其来源为 `qqnt-liuli-theme @ dda858b`，v1.3.2 前后）
> 本次从 `qqnt-liuli-theme @ 4b37f6b`（v1.3.5 + #52）移植功能修复。

## 用法

把整个目录放到 SnowLora 的 `resources/assets/qqnt-liuli-theme/`（覆盖原适配版）即可；
`snowlora.json` 里的 `script` 路径不用改：

```json
"script": "./assets/qqnt-liuli-theme/load.js"
```

## 已移植的修复

### #52 独立聊天窗 / 迷你窗 / 红包 / AV 壳
- `renderer/index.js`
  - 路由同步按特征打 `data-liuli-av`：`#/av...`、hash 含 `screen`/`share`、`about:` 壳窗口；
  - `mountInputBar()` 只在主窗口 / `#/chat` 挂代理按钮；
  - `renderWallpaper()` 在 AV 壳和 `#/mini-fishing` 直接跳过。
- `renderer/layout-custom.js`：`applyBar()` 只在主窗口 / `#/chat` 执行。
- `assets/liuli.css`：迷你窗不铺底色；AV 窗口排除 `--ll-acrylic` 底色。
- `assets/layout.css`：
  - AV 窗口 `#app` 去 isolation / 去 `::before`、`::after`；
  - `#/chat` 打透 `.chat-container`、去掉非主窗口材质层，壁纸正常透出；
  - 红包弹层不再命中通用浮层材质（`q-popup__main:not(.lucky-money-dialog):not(.send-lucky-money-dialog)`）。
- `assets/input-bar.css`：输入条规则限定主窗口 / `#/chat`；独立窗隐藏原生「关闭」按钮、发送键 30×30。
- `assets/qq-tokens.css`：红包作用域还原 `--bg_bottom_light` / `--bg_bottom_standard` / `--background_05`。
- `assets/motion.css`：`#app > *` 入场动画改 `backwards` 并排除 AV；所有 `animation ... both` 统一改 `backwards`。

### #49 群语音成员不显示
- 上面 motion 的 `backwards` + AV 排除（对应 v1.3.5 的修复）。

### v1.3.4 行为修复
- `assets/lists.css`：大群「· 管理 N」不参与 flex 压缩（#32.1a）。
- `renderer/index.js`：管理人数改用稳定 key（会话 id / 群名）+ 精确值 / `N+` 缓存（#32.1b）；
  顶部感应带放宽到胶囊底边 36px（#32.4a）。
- `assets/layout.css` / `motion.css`：`#27.5` 白名单菜单材质与淡入动画。
- 壁纸比例：SnowLora 适配版本身已用 `primeImageRatio` + boot 前解码（对应 #37），未重复移植。

### 保留 SnowLuma 的适配改动
- 标题栏 `z-index: 3800`、`.window-control-area` 原生命中区 / 子元素 `no-drag`；
- ES 模块拆成 `window.Liuli*` 全局、`LiuliHost` 宿主接口、页内设置 `<dialog>`、`integration.css`；
- 其自有的 `snowlora` 诊断/窗口状态/资源加载模块（`*.cjs`）原样保留。

## 多窗口（JS 侧窗口选择）

SnowLora 按窗口标题规则对多个 HWND 各执行一次 `load.js`。实测标题匹配既漏又滥：

- 漏：`#/forward/...`（聊天记录窗）、`#/chat`（`auxWinWithIpc=1&chatPoolWin=1`，隐藏预创建的独立聊天窗）、
  `#/setting/...`、`#/image-viewer` 等没有主题；
- 滥：`screenshot.html`、`about:blank`（屏幕共享壳）被注入主题；
- QQ 的池窗口先以 `#/blank` 预创建（`?webcontentsid=N&processGroupNS=createBlankWindow1#/blank`），
  之后靠**页内路由**（`did-navigate-in-page`）切到真实路由，不会重新 load。

所以窗口选择先做在 JS 侧（以后可以挪进加载器）。`load.js` 现在的结构：

- 全局单例 `globalThis.__snowloraLiuliManager`（第一次执行时创建，之后每次执行只复用）：
  - 沿用 `globalThis.__snowloraLiuliWindows`（key = `wc.id`，value = `{ wc, ready, token, generation, applied, managed, ... }`），
    `diagnostics.cjs` / `window-state.cjs` 的初始化方式与参数不变；
  - `attach(win)`：每个 webContents 只挂一次 `console-message` / `did-finish-load` / `did-navigate-in-page` / `destroyed`（按 `wc.id` 去重）；
  - 创建时注册 `app.on('browser-window-created')`，并对 `BrowserWindow.getAllWindows()` 全量 attach，只注册一次。
- `eligible(url)`（挂在管理器上，便于单独测试）：
  - 必须 `app:` 协议，pathname 以 `/renderer/index.html` 结尾——排除 `hiddenWindow.html`、`screenshot.html`、
    `newLogin.html` 以及 `about:`；
  - hash 非空且不是 `#` / `#/`；排除 `#/blank`、`#/tray-menu`、`#/screenselector`、`#/screenshare*`、`#/av` 与 `#/av/...`，
    以及 hash 中含 `screen` 或 `share`（不区分大小写）的路由；
  - `#/main`、`#/chat`、`#/setting`、`#/forward`、`#/image-viewer`、`#/mini-fishing`、资料卡等一律放行；
    `chatPoolWin=1` 在 query 里，不参与判断。
- 应用时机（每个 wc 一个 state）：
  - `did-finish-load`（新文档）：`generation++`、`applied=false`，当前 URL 合规才注入；
  - `did-navigate-in-page`（`isMainFrame`）：未注入且新 URL 合规 → 注入（`#/blank` 预创建窗口的主要入口）；
    已注入 → 维持原行为，只派发 `window.dispatchEvent(new Event('liuli-route'))`；
  - attach 时若页面已加载完且合规 → 立即注入；正在加载则等 `did-finish-load`；
  - 注入按 wc 串行（`state.ready` 队列），队列里再查一次 `applied`，同一文档不会注两次。
- 日志：`theme-ready`（带截断到 120 字符的 url）、`theme-skip`（同一 wc 同一 url 只记一次）、
  `theme-failed`（注入异常只记日志 + `console.error`，不向 SnowLora 抛错）。
- SnowLora 传入的 HWND：找得到就 attach 并 `await` 该窗口的 `ready`；找不到、或该窗口不合规时静默 `return`
  （管理器已全局接管），不再抛 `No QQ window matches`。
- 兼容：同一进程里旧版 `load.js` 留下的 Map 条目没有 `managed` 标记，视为「已 attach 且 applied」，
  既不重复挂监听也不重复注入。

注意：

- 已注入的文档之后切到排除路由（如 `#/av`）**不卸载**主题，由 `renderer/index.js` 的 `data-liuli-av` 关掉壁纸/材质（原有设计）。
- 诊断导出的窗口列表按 `applied` 过滤，仍然只包含真正注入过主题的窗口（多窗口后会比只注入主窗时多）。
- 仍属权宜：SnowLora 依旧按标题规则决定「对哪些 HWND 执行 `load.js`」，现在的实现靠「一次执行覆盖进程内全部窗口」绕开；
  加载器侧以后应直接提供窗口枚举。浏览器窗口刚创建时 webContents 可能还没有 URL，需靠 `did-finish-load` 补上，这也需要实机确认。

## 未移植 / 差异

- **主进程日志轮转（PR #42）**：SnowLora 没有 LiteLoader 的 `plugin.log` 机制，不适用。
- **「恢复全部默认」**：v1.3.4 的复位按钮依赖 LiteLoader 设置页；SnowLora 使用自己的页内设置对话框，本次未加。
- **诊断包**：SnowLora 使用自己的 `diagnostics.cjs` / 宿主通道，与 LiteLoader 版 `main/diag.js` 不通用。
- SnowLora 的标题匹配规则仍决定「对哪些 HWND 执行 `load.js`」；新版 `load.js` 在 JS 侧接管窗口选择后，
  `#/chat`、`#/forward`、`#/setting`、`#/image-viewer` 等窗口都会注入，`#/av`、屏幕共享壳仍排除（规则见上一节）。

## 版本

- 主题功能基线：`qqnt-liuli-theme` v1.3.5 + `4b37f6b`（#52）
- 适配基线：SnowLora `344e549`

## 实测（2026-11-09）

- 环境：QQ **9.9.36-53644** + SnowLora 0.3.0（CI `SnowLora-windows-x64` 构建）+ 本目录主题
- 临时把 LiteLoader 的 `liuli-dsh-theme` / `qq-enhance` 移出（保留 `ll-cdp` 仅用于检查），避免与 SnowLora 双重注入
- 结果：SnowLora 进程存活，主窗注入成功
  - `#liuli-dsh-theme` 存在，700 条规则；`data-liuli-theme=dsh`
  - `window.LiuliHost.info.host = native`，`window.SnowLoraLiuli === true`
  - `getErrorCount() = 0`
  - 壁纸、侧栏玻璃、选中项、成员卡、TG 输入条（+ / 表情 / 粉色发送键）均正常
- 反向检查（多窗口改造前）：`#/chat` 池窗口没有主题样式（当时 SnowLora 只匹配主窗，符合当时的设计）；
  改造后这些窗口应当有主题，需要在实机上重新验证。
- 截图：`probe/SnowLora-ported/EVIDENCE-snowlora-main.png`
