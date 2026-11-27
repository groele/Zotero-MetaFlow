# Zotero MetaFlow 渐进式微内核架构演进方案与完成台账（以 BridgeFlow 为基准）

## 1. 演进目标与基准对齐

以 `Zotero-BridgeFlow`（v1.1.3）为架构基准，在不破坏 MetaFlow 现有 59 项治理规则、双核流水线（离线检查修复 vs 在线元数据增强）、`Zotero.MetaRef` 公开门面与外部 E2E 测试契约的前提下，分阶段完成五层微内核架构落地：

1. **统一五层单向依赖架构（全面落地）**：`bootstrap.js` / `src/index.ts` / `src/addon.ts` / `src/hooks.ts` ➔ `src/kernel/` ➔ `src/services/`（含 `src/services/host/`、`src/services/lint/`、`src/services/metadata/`、`src/services/duplicates/`）& `src/utils/` ➔ `src/domains/` ➔ `src/bridges/`。
2. **业务域与共享服务全量下沉（消除骨架态）**：原扁平 `src/modules/` 下的 100 个生产模块与随附单测已 100% 物理迁入 `src/services/` 与四大领域包 `src/domains/{workspace-ui,journal-insights,review-duplicates,lint-engine}/`；`src/` 内任何生产代码禁止引用 `src/modules/`，`src/modules/` 仅保留 7 个面向外部 `test/**/*.spec.ts` 与 `zotero-plugin.config.ts` 的单行纯重导出兼容垫片（由架构守卫第 15 项门禁强制校验）。
3. **集中化基础设施与生命周期可重入加固**：
   - `UnifiedPrefService` 采用 `UNSET_PREF` 哨兵区分“宿主未设置”与“显式值”，确保观察者缓存命中时仍正确应用调用方 `fallback` 与默认表；
   - `UnifiedNotifierHub` 支持 `onHostNotify` 钩子路由以及 `restart()`（保留域/服务订阅者）与 `dispose()`（彻底释放）分离；
   - `PluginKernel` 具备 `generation` 世代令牌、`revive()` 重生恢复与 `Map<Window, Promise<void>>` 并发窗口加载去重能力，支持同一 `Addon` 实例执行 `onShutdown() -> revive() -> onStartup()` 循环而零死锁。
4. **宿主私有 API 防腐围栏（ACL）与双模宿主冒烟（静态 `omni.ja` + 真实无头进程启动）**：
   - 所有原型补丁与 Zotero 内部成员访问收敛至 `src/kernel/native-runtime.ts` 与 `src/services/host/`；
   - `scripts/smoke-zotero.mjs` + `scripts/smoke-launch.mjs` 同时提供 `--check-only`（7 项 `omni.ja` 符号契约扫描）与 `--launch`（隔离临时 Profile 启动真实无头 Zotero 进程、验证扩展挂载、无致命异常并干净回收进程树与临时目录）。

---

## 2. BridgeFlow 与 MetaFlow 五层架构映射表

| 层级 | BridgeFlow v1.1.3 基准 | MetaFlow v17.3.0 落地实现 | 核心职责与门禁约束 |
|---|---|---|---|
| **Entry** | `BridgeFlowApp` (`src/index.ts`) | `Addon` (`src/addon.ts`) + `hooks` (`src/hooks.ts`) + `api` (`src/api.ts`) | 组装内核、服务、4 个领域模块与 2 个桥接模块；保留 `Zotero.MetaRef` 公开契约；严禁导入 `src/modules/` |
| **Kernel** | `PluginKernel`, `TypedEventBus`, `DomainPortRegistry`, `CommandRegistry`, `NativeRuntime`, `UnifiedNotifierHub`, `UnifiedPrefService`, `DisposableStack` | `src/kernel/*`（含 `AsyncDisposableStack.reopen()`、`PluginKernel.revive()`、`UNSET_PREF`、`observeHostPrefs`） | 零上层业务/宿主依赖；统一管理生命周期、事件、命令、窄端口与集中监听 |
| **Services & Utils** | `ServiceContainer`, `src/services/host/*`, 共享引擎服务 | `src/services/{cache-coordinator,service-container,notifier}.ts`、`src/services/host/*`、`src/services/lint/*`（`Rule` 基类、`Rules` 目录注册表、`LintRunner`、报告与撤销）、`src/services/metadata/*`（多源学术元数据服务、预印本/快照判定、TL;DR、核验策略）、`src/services/duplicates/non-duplicates.ts`、`src/utils/*` | 跨领域共享能力与宿主私有细节防腐隔离；严禁反向导入 `domains/`、`bridges/` 或 `modules/` |
| **Domains** | `workspace`, `visual-notes`, `inspector`, `word-cite` | `src/domains/workspace-ui/`（设置面板控制器集、菜单、快捷键、富文本标题栏、TL;DR 信息行）、`src/domains/journal-insights/`（期刊侧栏卡片组与虚拟列）、`src/domains/review-duplicates/`（重复项统计、原生去重面板、批量合并与设置子控制器）、`src/domains/lint-engine/`（56 项离线/工具规则实现、核心双流水线编排、批量派发与条目诊断） | 100% 承载各自领域业务实现并注册窄 `DomainPort`；跨领域直接导入数为 **0** |
| **Bridges** | `CiteBadgeBridge` 等 5 个桥接器 | `src/bridges/{item-sync-bridge,automatic-ingest-bridge}.ts` | 仅依赖 `src/kernel/` 与 `src/services/`，通过 `DomainPortRegistry` 与 `TypedEventBus` 协同跨域联动 |

---

## 3. 核心接口契约

### 3.1 强类型事件总线 (`MetaFlowEventMap`)
- `prefs:changed`: `{ key, value }` ➔ `ServiceContainer` 自动刷新 `bumpLintPrefsRevision()`
- `notifier:event`: `NotifierEventPayload` ➔ `ItemSyncBridge`、`AutomaticIngestBridge` 响应条目增删改
- `tldr:updated`: `{ itemIDs }` ➔ `ItemSyncBridge` 联动刷新期刊侧栏
- `journal:refresh-requested`: `{ itemIDs?, reloadInsights? }` ➔ `JournalInsightsDomainModule` 响应设置页刷新请求
- `cache:clear-requested`: `{ target: "memory" | "persistent" | "all" }` ➔ `CacheCoordinatorService` 统一清理缓存

### 3.2 跨领域窄端口 (`DomainPortMap`)
- `lint-engine` (`LintEnginePort`): `runBatch`, `stopAll`, `enqueueAddedItems`, `cancelAddedItems`, `drainAddedItems`, `isSavingPhase`
- `journal-insights` (`JournalInsightsPort`): `refreshPane`, `refreshInsights`, `refreshItemJournal`, `setUpdateResult`, `syncExtraColumns`
- `review-duplicates` (`ReviewDuplicatesPort`): `runReview`, `processImportedDuplicates`, `invalidateStats`, `refreshStats`, `setupSettingsPane`
- `workspace-ui` (`WorkspaceUiPort`): `refreshTldrRow`, `placeTldrRow`, `executeShortcut`

---

## 4. 外部兼容垫片边界说明（`src/modules/` 仅存 7 项单行纯重导出）

为保持 `zotero-plugin.config.ts` 编译期 `typings/rules.d.ts` 生成钩子及 `test/**/*.spec.ts` 既有 E2E 测试导入路径 100% 零改动兼容，`src/modules/` 下仅保留以下 7 个单行纯 `export *` 转发文件（不含任何运行时逻辑，`src/` 内部零引用）：

1. `src/modules/rules/index.ts` ➔ `src/domains/lint-engine/rules`
2. `src/modules/rules/tool-update-easyscholar.ts` ➔ `src/services/metadata/easyscholar-rule`
3. `src/modules/rules/tool-update-metadata/index.ts` ➔ `src/services/metadata/tool-update-metadata`
4. `src/modules/rules/tool-update-metadata/issn-resolver.ts` ➔ `src/services/metadata/tool-update-metadata/issn-resolver`
5. `src/modules/rules/tool-update-metadata/services/index.ts` ➔ `src/services/metadata/tool-update-metadata/services`
6. `src/modules/rules/tool-update-metadata/services/semantic-scholar-service.ts` ➔ `src/services/metadata/tool-update-metadata/services/semantic-scholar-service`
7. `src/modules/tldr-migration.ts` ➔ `src/domains/workspace-ui/tldr-migration`

---

## 5. 验证体系（21 项架构守卫 + 单元测试 + 双模宿主冒烟）

- `pnpm run guard`：21 项静态与构建产物门禁（含五层单向边界、跨领域零导入、`src/modules/` 纯重导出垫片门禁、Bridge 隔离、宿主 ACL 围栏、集中观察者、EventBus 闭环、确定性 XPI 哈希等）。
- `pnpm run test:unit`：128 个测试文件 / 840 项单元测试（含 `src/architecture-regressions.test.ts` 深度审计回归测试与 `src/smoke-zotero.test.ts` 无头冒烟单测）。
- `pnpm run smoke:host`：本机 Zotero `omni.ja` 7 项宿主符号契约静态校验。
- `pnpm run smoke:launch`：本机独立临时 Profile 无头 Zotero (`-headless -no-remote`) 真实进程启动、扩展挂载与干净退出回收验证。
