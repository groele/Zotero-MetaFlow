# Zotero MetaFlow v17.3.2

Zotero MetaFlow `v17.3.2` 聚焦全量实机 E2E 审计暴露的元数据管线、设置面板布局与代码卫生缺陷修复：

## 核心修复与改进

1. **自动元数据巡检管线修复（`src/services/metadata/metadata-inspector.ts`）**
   - `inspectMetadata` 在 DOI 错配时记录 `mismatched` 标记，无匹配数据源时准确触发 `metadata-auto-blocked` 阻断状态；
   - 主数据源一旦返回有效 `title` 即停止后续主链请求，避免重复调用 `ItemTranslateService` 与非预期 `OpenAlexService` 请求，仅在 DOI 匹配且未尝试 Semantic Scholar 时执行补全；
   - `inspectPreprint` 在 `CrossrefService` 与 `IdentifiersTranslateService` 失败后补齐 `SemanticScholarService` 回退。
2. **预印本 DOI 优先级与 arXiv 解析修复（`src/services/metadata/tool-update-metadata/`）**
   - 无 API Key 排序下将 `SemanticScholarService` 置于 `URLTranslateService` 之前，并在已有结构化元数据结果时跳过 `lookup === "url"` 服务，防止网页抓取结果覆盖发表后 DOI；
   - `ArxivService.parseArxiv` 在 `latest === undefined` 且仅存在单个 `<entry>` 但缺少 `<id>` 标签时允许匹配该条目，确保从 `arxiv:doi` 正常提取发表后 DOI。
3. **设置面板控件统一与 16px 视觉对齐（`src/domains/workspace-ui/settings-easyscholar.ts`、`addon/content/preferences.css`）**
   - 取消对 `#metaref-menu-settings` 与 `#metaref-menu-settings-grid` 的跳过逻辑，全量 33 项菜单开关统一为 `.metaref-check-option` 原生复选框并恢复 `<select>` 位置同步；
   - 将 `#metaref .metaref-static-card > .metaref-card-heading` 内边距统一为 `8px 16px`，消除 3px 左侧偏移。
4. **代码卫生与 E2E 测试稳定性（`rich-text.ts`、`cache-maintenance.ts`、`journal-card-share.ts`、`metadata-workflow.spec.ts`）**
   - 使用 `DOMParser` + `importNode` 替换 `rich-text.ts` 中的 `innerHTML` 图标注入；
   - 为 `cache-maintenance.ts` 与 `journal-card-share.ts` 的 4 处空 `catch` 补齐调试日志；
   - 修复 `metadata-workflow.spec.ts` 快捷键响应式布局测量前未切换至 `tools` 标签页并展开对应 `<details>` 卡片的问题。
