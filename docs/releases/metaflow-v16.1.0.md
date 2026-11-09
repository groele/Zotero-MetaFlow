# Zotero MetaFlow 16.1.0

## 科研全流程功能、性能与交互体验综合升级

1. **侧栏「期刊索引」单刊定向清缓存与强制刷新**：
   - 在右侧详情栏「期刊索引（Journal Insights）」卡片右上角（分享按钮旁）新增**强制刷新指标**按钮（`[data-journal-refresh="true"]`）；
   - 点击后仅定向剔除当前期刊在内存与 `api-cache.json` 中的 EasyScholar 及中文补充源缓存，并以覆盖模式重新联网拉取最新分区与影响因子，无需清空全库其他期刊缓存。
2. **Crossref 撤稿 / 关注声明 / 勘误零开销检测与侧栏醒目预警**：
   - 在执行「更新元数据」查询 Crossref 时，自动解析 `update-to` 与 `relation.is-retracted-by` 节点，识别撤稿（Retracted）、关注声明（Expression of Concern）与勘误（Correction），安全追加 `Editorial Notice:` 记录至 `Extra` 字段；
   - 在右侧「期刊索引」顶部渲染醒目的紅/琥珀色学术预警横幅，支持一键点击跳转官方公告 DOI。
3. **bioRxiv / medRxiv (`10.1101/...`) 预印本自动识别与一键转正**：
   - 预印本识别与一键转正工作流由 arXiv 扩展至生命科学与医学领域主流预印本库 **bioRxiv / medRxiv**（`10.1101/...`）；
   - 支持通过 Crossref `relation.is-preprint-of` 自动检出正式发表期刊论文 DOI，完整保留 PDF 附件、笔记、高亮批注与标签并升级为 `journalArticle`。
4. **最近一次批量变更一键安全撤销（Undo Last Batch Changes）**：
   - 在设置页「最近一次批量变更」面板新增「**撤销本次批量变更**」按钮（`#metaref-last-batch-undo`）；
   - 仅当条目当前字段值仍与批处理写入后的快照一致时才逆序回滚至修改前状态，绝不覆盖用户在批处理后手动编辑过的字段。

兼容声明为 Zotero 10.0–12.*；实际宿主验证范围以发布验证记录为准。
