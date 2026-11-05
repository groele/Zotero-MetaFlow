# Zotero MetaFlow 13.7.0

**发布版本：** 13.7.0  
**发布状态：** 正式发行版（Official Release）  
**兼容基准：** Zotero 10.0 ~ 12.* (`strict_min_version: 10.0`, `strict_max_version: 12.*`)  
**目标运行时：** Firefox 140 / Gecko 153 现代 ESM 与 Web Components 架构  

---

## 核心版本更新摘要

Zotero MetaFlow 13.7.0 是一个专注于**在线元数据安全补全（Gap-Filling）**、**全快照新鲜度持久化守卫（Full-Snapshot Freshness Guard）**以及**现代 Gecko 153+ 原生弹窗状态机自愈**的里程碑版本：

### 1. 智能元数据补全与冲突防护解耦（Gap-Filling Enhancement）
- **空白缺失字段安全填充**：彻底解决在「仅补全缺失字段（blank 模式，不覆盖现有字段）」下，当文献已有非核心字段（如日期表达格式、作者中英文排列）与远端检索结果存在差异时导致的误拦截。只要显式 DOI 校验一致且标题匹配，插件将自动保护本地已有数据不被覆盖，同时将所有缺失空白字段（期刊名、卷号、期号、页码、摘要、ISSN 等）安全无损地合并写入；
- **出版商格式容错兼容**：兼容出版商 XML/HTML 上下标标签（`<sup>`、`<sub>`）前的不规则空白换行与缩进（如 ACS Nano Letters 等期刊），消除因多余空白换行导致的同一文献标题冲突误判；
- **多源元数据互补衔接**：在元数据发现阶段新增对 `Extra` 字段自由文本中 DOI 的正则提取；当 Crossref / Unpaywall 主源缺少摘要、卷期页码或 ISSN 时，自动衔接 Semantic Scholar 进行第二梯队无损补齐；
- **独立 ISSN 证据核验**：针对缺少准确刊名的条目，核验 Crossref / OpenAlex 返回的 DOI 对应关系，拒绝虚假或不匹配的 DOI 证据，保留按准确刊名查询的回退机制。

### 2. 审查与去重全快照新鲜度校验（Full-Snapshot Freshness Guard）
- **完整快照比对边界（`assertReviewFresh`）**：在用户进入审查决策交互及持久化事务等待期间，不仅比对核心元数据字段，更完整校验条目的 Extra 附加信息、Tags 标签集、Collections 集合归属及 Relations 关联关系；
- **防脏写与并发保护**：若用户在等待异步查询或人工决策期间于主界面修改了该条目的标签或归属，插件会敏锐感知并拦截过时决定的隐式覆盖，彻底保障用户数据的权威性。

### 3. Gecko 153+ / Zotero 10 原生弹窗状态机自愈
- **消除跨套件异步焦点竞态**：针对 Windows 原生 Zotero 10 环境中连续执行多套件操作或后台 `Zotero.Notifier` 重绘导致 XUL `nsXULPopupManager` 静默收起或吞没 `popupshown` 事件的偶发问题，重构测试弹窗控制器；
- **状态巡检与幂等重试**：实现基于 150ms 周期状态机检测与焦点主动唤醒机制，并在菜单命令执行后严密等待 `popup.state === "closed"`，彻底消除跨套件操作交错。

### 4. 全量质量验收与工程规范
- **单元测试**：110 个测试文件、757 项测试 100% 全部通过；
- **原生 E2E 测试**：真实 Zotero 10 环境下 228 项端到端集成测试全部通过（0 失败）；
- **静态分析与代码规范**：TypeScript 严格类型检查（`tsc --noEmit`）、ESLint Flat Config 以及 AutoCorrect 文本排版检查 0 错误、0 警告。
