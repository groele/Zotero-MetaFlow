# Zotero MetaFlow 13.6.0

**发布版本：** 13.6.0  
**发布状态：** 本地就绪候选版本（Local Release Candidate）  
**兼容基准：** Zotero 10.0 ~ 12.* (`strict_min_version: 10.0`, `strict_max_version: 12.*`)  
**目标运行时：** Firefox 140 / Gecko 153 现代 ESM 与 Web Components 架构  

## 核心版本更新摘要

Zotero MetaFlow 13.6.0 是一个承载全方位现代化架构演进、凭据隐私安全与端到端稳定性升级的里程碑版本：

### 1. 架构模块化解耦与 360 行守卫
- **Runner 调度分层**：将主调度器拆解为清晰的单向继承链 `RunnerState` (状态/统计/进度) → `RuleExecution` (规则判定/上下文/回滚) → `BatchPersistence` (事务保存/变基/恢复) → `LintRunner`，各层无方法遮蔽；
- **期刊面板解耦**：将指标卡片拆解为核心卡片、快捷动作 (`quick-actions.ts`)、分享控制器 (`share-button.ts`) 与条目上下文 (`section-context.ts`)，所有模块严格遵守 360 行物理上限；
- **附件资产治理与 TLDR 迁移**：正文主手稿与补充材料识别策略（`attachment-role-policy.ts`）与 TLDR 独立生命周期（`tldr-migration.ts`）彻底从主逻辑中剥离。

### 2. 凭据隐私安全传输与日志脱敏
- 引入匿名特权请求通道（`src/utils/credential-request.ts` 与 `http-transport.ts`），杜绝 EasyScholar、Crossref 等带有 API Token / `secretKey` 的请求泄露至 Gecko 原生调试日志；
- 在请求超时、网络中断或 4xx/5xx 错误时自动掩码敏感 Query，提供安全重试与 15s 熔断保护。

### 3. 数据写入边界与只读防护
- 全生命周期守卫 `item.isEditable()`、`item.deleted` 与 `item.inTrash`；
- 在异步网络等待返回后及进入保存事务前二次复验写入资格，严防用户在等待期间移入回收站导致的脏数据写入；
- 独立管理附件、专用笔记与文献条目的事务边界，避免回滚传播污染。

### 4. 设置面板现代化与首组展开铁律
- 全面板 11 个 `<html:details>` 卡片严格遵循**有且仅有第 1 张卡片默认展开（`open="open"`）**；
- 界面 100% 由 Fluent（`data-l10n-id`）驱动，零硬编码中文；
- 4 个 Fluent 语言包共 867 个顶层键实现中英文 100% 镜像对称。

### 5. 原生端到端回归测试 100% 通过
- **单元测试**：109 个套件、747 项测试全部通过；
- **原生 E2E 测试**：真实 Zotero 10 环境下 224 项集成测试全部通过（0 失败）；
- 原生条目切换与指标面板绑定引入 `await win.ZoteroPane.itemSelected()` 原生事件同步，彻底消除历史遗留的异步选定时序竞争。
