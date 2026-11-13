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
