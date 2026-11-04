# Zotero MetaFlow 13.5.3

## 核心变更 (Highlights)

1. **短标题论文网页后缀清洗与对齐修复 (`titlesAgree`)**：
   - 修复了少于 5 个词的短标题论文（如 `"Ferroelectricity in ReS2 - Chen - 2024 - Advanced Materials - Wiley Online Library"`）因在清洗网页后缀前提前触发词数阈值短路而导致标题对齐失败的问题。现在优先对清洗后的标题执行精确等价匹配。
2. **多源元数据互补合并 (`inspectMetadata` 摘要跨源补全)**：
   - 当主通道 `CrossrefService` 或 Zotero Translator 成功返回 DOI 元数据但缺失摘要 (`abstractNote`) 时，自动向 `Semantic Scholar` 发起补充查询并调用 `mergeMetadata` 无损合并缺失字段，同时严格保持主数据源权威字段不被覆盖。
3. **创作者占位符识别扩充与非作者角色保护 (`isPlaceholderCreator` & `applyReviewedMetadata`)**：
   - 扩充 `isPlaceholderCreator` 识别范围，覆盖 `null`、`undefined`、`N/A`、`none`、`et al.`、`[Anonymous]` 等抓取异常占位符；
   - 在 `applyReviewedMetadata` 更新作者列表时，自动保留本地已有的非作者角色（如 `editor`、`translator`），与 `ToolUpdateMetadata` 保持完全一致。
4. **DOM `MutationObserver` 防重入锁与子笔记迁移并发锁 (`item-info-row.ts`)**：
   - 为 `placeTLDRBeforeExtra` 增加 `isPlacingTLDR` 同步重入防护与 DOM 脏检查，避免 `#info-table` 节点移动或属性更新触发 `MutationObserver` 微任务死循环；
   - 为 `onItemChange` 中的历史 `Extra` 撷论自动迁移逻辑增加按条目 ID 隔离的并发锁 (`migratingItemIDs`)，防止快速切换条目时重复创建子笔记。
5. **Zotero 10 ~ 12 多窗口无头环境容错 (`AbortController` & `DOMParser`)**：
   - 将 `core-workflow.ts`、`runner.ts`、`metadata.ts`、`http.ts`、`arxiv-service.ts`、`cnki-title-service.ts` 中对 `Zotero.getMainWindow().AbortController` / `DOMParser` 的强依赖升级为安全回退至现代 Gecko 153+ 全局 `AbortController` / `DOMParser`，确保在主窗口最小化/关闭、独立阅读器窗口运行时的绝对稳健。
