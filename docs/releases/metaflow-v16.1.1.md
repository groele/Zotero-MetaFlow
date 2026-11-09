# Zotero MetaFlow 16.1.1

## 增量脏检查指纹缓存、侧栏微秒级卡片缓存与强制刷新交互修复

1. **大规模文献库的增量扫描与脏检查（Incremental Dirty-Checking，`lint-fingerprint-cache.ts`）**：
   - 基于条目版本、`dateModified`、JSON 字段快照、子附件快照与当前启用规则集合签名，构建 FNV-1a 64 位元数据指纹缓存；
   - 对已通过纯本地清洗规则（无修改、无告警）的条目，在后续批量「检查并修复元数据」且字段与规则配置未变时直接命中指纹跳过 59 项重复判定，使大规模全库重复体检耗时缩减至毫秒级。
2. **侧栏「期刊索引」高频切换下的微秒级内存卡片缓存（DOM Fragment Cache，`fragment-cache.ts`）**：
   - 按宿主 `Document`（`WeakMap<Document, Map<string, HTMLElement>>`，兼容分离式 PDF 阅读器窗口）缓存已构建的期刊画像 DOM 模板；
   - 在文献列表按住方向键连续切换同期刊或未变更条目时，直接通过 `cloneNode(true)` 复用 DOM 片段并仅绑定当前条目动作按钮，消除重复构建 60+ 个 DOM 节点的渲染开销。
3. **侧栏「强制刷新指标」按钮全链路交互修复（`share-button.ts` & `hooks.ts`）**：
   - **修复点击无视觉反馈问题**：点击刷新按钮时立即启动 SVG 图标 360° 旋转动画与忙碌提示；
   - **修复面板重绘导致对勾状态丢失**：在 `onRefreshJournal` 重绘侧栏面板后，精准定位新挂载的 `button[data-journal-refresh="true"]` 节点，切换为对勾完成图标（`data-refresh-success="true"`）持续 1.6 秒后自动复位；
   - **新增右下角原生通知弹窗（`showNativeNotice`）**：与右侧「分享卡片」按钮保持一致，刷新完成后立即在右下角弹出 Zotero 原生通知提示刷新结果（或提示未配置密钥/网络异常原因）；
   - **补全主窗口 Fluent 词条**：将 `journal-refresh-*` 与 `editorial-notice-*` 移入主窗口加载的 `main-window.ftl`。

兼容声明为 Zotero 10.0–12.*；实际宿主验证范围以发布验证记录为准。
