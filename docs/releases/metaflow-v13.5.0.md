# Zotero MetaFlow 13.5.0

**发布日期：** 2026-11-03  
**发布版本：** 13.5.0  
**更新类型：** 核心架构增强与缺陷自愈（新增原生 Crossref REST API、脏抓取标题智能净化、占位符作者识别、条目缺陷自检自愈、全链路逻辑死锁解除）

---

## 🚀 核心改进与功能优化

### 1. 新增原生 Crossref REST API 客户端 (`CrossrefService`)
- 深度解决学术期刊（如 Wiley、ScienceDirect、Springer 等）抓取条目元数据严重残缺、无法补全的问题；
- 接入官方 Polite Pool (`https://api.crossref.org/works/{doi}`)，携带标准联系头，无需第三方中转，直连秒级响应；
- 全量精准解析并补全 `volume`（卷）、`issue`（期）、`page`（页码）、`publicationTitle`（刊名）、`ISSN`、`abstract`（摘要，自动清洗 JATS XML 标签与 XML 实体字符）、`author`（结构化作者名与排位，严格兼容机构单名字与标准分姓名）。
- 在 arXiv 预印本转正与常规文献更新中统一作为权威 DOI 解析源。

### 2. 网页脏抓取标题智能净化与一致性判定 (`sanitizeWebTitle` & `titlesAgree`)
- 针对从学术数据库或浏览器扩展抓取条目时经常附带的后缀（如 ` - chen - 2024 - advanced materials - wiley online library`、` - ScienceDirect`、` | Nature` 等），建立专有正则净化器；
- 标题一致性判定支持自动比对剥离脏后缀后的学术核心标题，消除因网页污染导致的误判冲突，实现自动安全覆盖清洗；
- 在直接规则流（`ToolUpdateMetadata`）与评审决策流（`automaticSelection`）中均支持在非覆盖模式下自动识别并清洗脏标题。

### 3. 占位符作者与残缺作者识别 (`isPlaceholderCreator` & `creatorsAgree`)
- 自动识别 Zotero 导入失败时遗留的无效占位符作者（如 `(姓), (名)`、`unknown`、`anonymous`、`未知`、`?`、`-` 等）；
- 升级作者身份核验机制（`creatorsAgree`），支持单姓名模式（`name: "Zhiqiang Chen"`）与双字段模式（`lastName: "Chen", firstName: "Zhiqiang"`）基于分词的精准匹配，消除不同数据源格式差异带来的误报冲突；
- 在直接规则流（`ToolUpdateMetadata`）与评审决策流（`automaticSelection`）中全面穿透识别占位符，安全替换并自动填充。

### 4. 自动决策策略容错升级与全链路死锁解除 (`automaticSelection`)
- **多途径 DOI 识别支持**：自动从条目 DOI 字段、URL 字段（`https://.../doi/...`）或 Extra 字段中解析已存 DOI，消除因 DOI 仅存于 URL 导致验证失败的隐患；
- **出版周期时间差容错**：允许在线首发（Online First）与正刊卷期出版年份存在 ±1 年的合理出版时滞，不再因年份微调而全盘阻断元数据保存；
- **保底缺失填充**：即便在默认非覆盖模式下，凡是本地为空的字段（卷号、期号、页码、摘要、ISSN 等）均能 100% 自动入库。

### 5. 本地条目缺陷智能体检引擎 (`inspectItemDefects`)
- 在本地无网检查流程（`localDOICheck`）中深度集成条目完整度与规范度体检；
- 全维检测：
  - 网页标题后缀污染（`title-contaminated`）；
  - 占位符虚假作者（`creators-placeholder`）；
  - 核心元数据缺失：缺少作者（`creators-missing`）、缺少卷号期号（`volume-issue-missing`）、缺少摘要（`abstract-missing`）、缺少出版物名称（`publication-missing`）；
  - 格式与命名规范：标题全大写/全小写、短横线格式异常等；
- 具备全局安全字段过滤防护（`safeGet` + `isFieldValidForItemType`），对非标准条目类型具备绝对防崩溃防护；
- 直接提供一键修复交互动作：直接挂接「更新元数据」或「规范化格式」流程，实现缺陷一键自愈。

---

## 📦 构建与发布产物验证

- **版本号：** `13.5.0`
- **插件标识：** `metaflow@groele`
- **发布产物：** `zotero-metaflow.xpi`
- **文件体积：** `3,514,724` 字节
- **SHA-256：** `6c24e248e58f56e14bb25c1e8f68eb793a93dce644b9c38ac1c6e60ea36c8f1b`
- **SHA-512：** `3b7e15608fe00b865d9fa13ace66d52f23e37fc0b2aab35a24bb8b690e9b56a28a295654127464f43ce487521a3644bd24bbef99c18aac91e1a64c07860a733d`
- **自动化测试：** 96 个测试套件，687 个单元测试用例全部通过（100% PASS）。
- **静态代码检查：** ESLint 0 错误 0 警告，AutoCorrect 0 异常。
