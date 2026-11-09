# Zotero MetaFlow 16.0.4

## 跨数据源缓存共享、刊名归一化与持久化恢复优化

- **Crossref 持久化缓存跨重启恢复**：将 `crossref` 命名空间纳入 `api-cache.json` 合法键加载规则，使 `CrossrefService` 与 Crossref DOI 查询在 Zotero 重启后可直接从本地持久缓存恢复。
- **ISSN 补全与 CrossrefService 共享单篇缓存及刊名归一化**：
  - 按 DOI 补全缺失 ISSN 时复用 `requestServiceGET("crossref", ...)`，与 `CrossrefService` 共享同一份持久化与并发请求缓存，避免同一 DOI 重复请求 Crossref；
  - 按期刊名称检索 OpenAlex 与 Crossref 时，统一通过 `publicationCacheName(publicationTitle)` 归一化大小写与多余空白，使同刊不同大小写变体共享同一缓存。
- **arXiv 预印本查询缓存与中文期刊补充源并发合并**：
  - `ArxivService` 对 `arXiv` 标识符执行归一化并接入公共请求缓存 `requestCachedGET`；
  - 中文期刊补充源（NJAU）新增 `inFlight` 并发请求合并与刊名归一化键，并在点击「清除 API 查询缓存」时同步清空全部内存与磁盘请求缓存。

兼容声明为 Zotero 10.0–12.*；实际宿主验证范围以发布验证记录为准。
