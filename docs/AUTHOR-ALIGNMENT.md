# 作者源码对齐记录（SnowLora .10 修复构建）

核对日期：2026-11-13（北京时间）。对照的是实际获取的作者仓库，不用版本号、截图外观或本地旧副本推测“最新版本”。

## 已核对的上游

| 来源                                                                              | 实际分支 / 提交                                                                                                                                             | 说明                                                         |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [LilycleHeart/qqnt-liuli-theme](https://github.com/LilycleHeart/qqnt-liuli-theme) | [`main` / `3d183f34184f58b7d2d935179c54505d5544ffc8`](https://github.com/LilycleHeart/qqnt-liuli-theme/tree/3d183f34184f58b7d2d935179c54505d5544ffc8)       | 当前 SnowLora 源码，清单为 `.4`；与本分支原始共同基线相同    |
| 同一作者仓库                                                                      | [`liteloader` / `114fe3897c67c029fe7d9b60905c6d0813b49a15`](https://github.com/LilycleHeart/qqnt-liuli-theme/tree/114fe3897c67c029fe7d9b60905c6d0813b49a15) | 另一套宿主实现，已检查；没有以它替换 SnowLora 宿主或加载接口 |
| 本仓库上一测试包                                                                  | [`c0e8ace` / `.9`](https://github.com/ChengOpus/qqnt-liuli-theme/tree/c0e8ace521143d41db82b226c98303a50b57db7e)                                             | 本轮纠正的版本                                               |

`.10` 是本分支的修复构建编号，不代表作者发布了官方 `.10`。

## 差异、来源与处理

用户新录屏显示，工具栏约 3 秒处退化为松散横排；顶部约 8–12 秒处 QQ 字样被裁切，资料呼出未正常绘制；左侧呼出也出现新增箭头。以下问题都有具体源码出处。

| 区域              | 作者已有实现                                                                                                                                                                                                                                        | `.9` 回归 / 本轮处理                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| QQ Logo           | [`layout.css:201`](https://github.com/LilycleHeart/qqnt-liuli-theme/blob/3d183f34184f58b7d2d935179c54505d5544ffc8/assets/layout.css#L201)：浮动模式隐藏 `.topbar-content .qq-logo`，原生模式保持原生                                                | 删除旧层时漏掉规则，Logo 留在零高度顶栏里被裁切；恢复原有条件，不重画或替换 Logo                                                 |
| 资料与头像        | [`layout.css:204`](https://github.com/LilycleHeart/qqnt-liuli-theme/blob/3d183f34184f58b7d2d935179c54505d5544ffc8/assets/layout.css#L204)：原生 `width:0 + flex:1` 需覆盖，内容/资料 30px、头像槽 24px，昵称与签名按原布局省略                      | 补回 flex、内层尺寸、头像和空签名处理；取消把两个原生层都强行改成横排的处理；恢复强制可见性与相应选择器强度                      |
| 系统拖动区域      | [`layout.css:491`](https://github.com/LilycleHeart/qqnt-liuli-theme/blob/3d183f34184f58b7d2d935179c54505d5544ffc8/assets/layout.css#L491)：顶部拖动条收窄到 8px，左拖动条关闭                                                                       | `.9` 漏掉后，Electron 可在页面事件前接管鼠标；恢复作者规则与 no-drag 区域。浏览器不能代替 Windows 非客户区命中验收               |
| 左侧呼出          | [`index.js:2338`](https://github.com/LilycleHeart/qqnt-liuli-theme/blob/3d183f34184f58b7d2d935179c54505d5544ffc8/renderer/index.js#L2338)：整条左缘 8px，18px 余量，离开等待 250ms                                                                  | 撤掉新增 45ms 触发等待和顶部 42px 排除；恢复原感应范围与等待，不再用箭头按钮或点击开关                                           |
| 感应区与提示      | [`layout.css:925`](https://github.com/LilycleHeart/qqnt-liuli-theme/blob/3d183f34184f58b7d2d935179c54505d5544ffc8/assets/layout.css#L925)：全高 8px 空感应层，箭头不显示；隐藏提示仅影响伪元素                                                      | `.9` 把入口改成中间按钮，且隐藏顶部提示会移除感应层；恢复整高空感应层，隐藏提示时仍保留 no-drag 命中                             |
| 工具网格          | [`layout.css:1370`](https://github.com/LilycleHeart/qqnt-liuli-theme/blob/3d183f34184f58b7d2d935179c54505d5544ffc8/assets/layout.css#L1370)、`:1459`：四列 38px；`.chat-func-bar__left` 与 `.func-bar-native` 均为 `display:contents`               | `.9` 缺少真实 `.func-bar-native`，把原生内层当作一个大块排版；恢复作者结构、四列尺寸、图标与子菜单小按钮几何，关闭重复标签伪元素 |
| 截图 / 文件子菜单 | [`layout.css:1525`](https://github.com/LilycleHeart/qqnt-liuli-theme/blob/3d183f34184f58b7d2d935179c54505d5544ffc8/assets/layout.css#L1525)、`:1809`：零尺寸 `.bar-more-menu` 用 `translateZ(0)` 给固定内层建立坐标基准，内层按作者的 38px 格子偏移 | `.9` 误把所有固定内层都当作相对视口并删掉包装变换。恢复原包装与作者偏移；材质仍只画在可见内层，不给零尺寸壳加背景或阴影          |
| 区域分隔线        | [`no-dividers.css:12`](https://github.com/LilycleHeart/qqnt-liuli-theme/blob/3d183f34184f58b7d2d935179c54505d5544ffc8/assets/no-dividers.css#L12)：拖动条保持命中，默认不绘制                                                                       | 恢复拖动条透明度和原有去分隔线处理；另删掉本分支新增的置顶标题横线、组尾边线和标题节点                                           |

作者源码里的重复覆盖没有整文件叠加回来；只把这些实际生效的原生结构处理归回 `shell.css`、`composer.css` 和对应控制器。之前已要求的展开让位、左右独立、悬浮输入、通透材质和自定义配色保留。

## 对照结果与测试边界

`tests/author-alignment.cjs` 在同一匿名页面上分别加载作者原始 CSS 和当前完整 renderer，比较稳定状态。页面加入了作者源码明确记录的 `width:0 + flex:1` 约束、实际工具包装类名及零尺寸子菜单壳；没有 QQ 账号、消息或 Cookie。

本轮比较结果：

| 项目                 | 作者 CSS                | 修复版                  |
| -------------------- | ----------------------- | ----------------------- |
| 资料 / 内层高度      | 30px / 30px             | 30px / 30px             |
| 头像高度             | 24px                    | 24px                    |
| 工具网格             | 4 × 38px，176 × 92px    | 4 × 38px，176 × 92px    |
| 两层原生工具包装     | contents / contents     | contents / contents     |
| 截图入口小按钮       | 14px                    | 14px                    |
| 子菜单相对其定位包装 | −29px / −10px           | −29px / −10px           |
| 左侧感应层           | 8px × 860px，无可见箭头 | 8px × 860px，无可见箭头 |
| 关闭提示后的感应层   | 保留                    | 保留                    |
| 顶部 / 左侧拖动条    | 8px / 不显示            | 8px / 不显示            |

另测左边缘顶部、中部和底部均可呼出，原生顶栏模式仍显示原生 QQ Logo；没有新增置顶分隔线、标题、数量或折叠按钮。旧 `.9` 测试只检查了展开状态和简化结构，遗漏这些原生约束，不能作为实机通过证据。本轮已纠正相关测试，特别是子菜单必须相对定位包装，而非武断地断言固定视口坐标。

```sh
node tests/author-alignment.cjs /path/to/author-snowlora-checkout
node tests/ui-regression.cjs
node tests/runtime-lifecycle.cjs
```

匿名截图和 JSON 只保留在忽略的 `out/ui-qa/`。**这些结果证明源码处理与浏览器内布局对齐，不证明 Windows QQ 的系统命中、真实图标资源、全部弹窗或帧率已实机通过。** 用户录屏、截图和真实聊天不提交到仓库或安装包。

## .11：按后续实测反馈修正（2026-11-13）

再次通过作者 GitHub main 分支 API 核对，HEAD 仍为 `3d183f3`。上文 `.10` 对齐表是历史验证记录，不代表用户实机已经通过。

- 保留作者的呼出条件、QQ Logo 与资料结构、工具包装与子菜单契约；按用户最新要求删除左缘可见短线及拖动条悬停颜色。
- 用户本轮明确要求置顶行左侧短竖线，故增加行内 2×22px 标记；先前撤掉的分组横线／数量／折叠继续不添加。
- 输入占位约束参考作者 `assets/input-bar.css:24` 对 `--inputAreaHeight` 的记录。真正悬浮需要同时取消消息区的原生占位，单纯绝对定位编辑器不充分。
- 补齐作者 `assets/layout.css:749–774` 的资料／浮层种类（含 mini-buddy、group-member-card、expression-panel-inner 等），不再根据“发消息”按钮文字猜测资料卡。
- 所有原生浮层滤镜放到材质伪元素，避免原生固定子元素改换包含块；保留作者明确要求的截图子菜单零尺寸变换壳例外。
- 窗口控制、聊天标题和聊天操作区按用户本轮要求分开，标题与操作区为两个玻璃面板；这项是明确要求的设计变化，不冒称来自作者。
- 补齐作者 `assets/layout.css:1554–1565` 的标题菜单层级约束，当前标题层级同时高于悬浮输入区；验证菜单覆盖成员区／输入区时仍能命中，不只检查初始截图。
- 插件入口覆盖 WebContentsView 生命周期，沿用原 URL 保护边界；这是代码路径自查修复，仍需实机确认群资料具体宿主。
- 作者 `assets/layout.css:1814–1828` 的多选底栏行为保留，但将全局 `body:has(...[style])` 改为当前输入区的局部判断。Chromium 样式失效追踪显示全局规则会放大局部编辑器写入；新增隐藏缓存会话与当前会话多选开关的检查。

自查发现和浏览器验证均在 [部署与验收](UI-REWORK.md) 中列明。草稿 PR 已按要求关闭，未向作者 main 发起合并。
