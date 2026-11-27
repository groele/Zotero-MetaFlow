# Zotero MetaFlow 渐进式微内核架构演进方案（以 BridgeFlow 为基准）

## 1. 演进目标与基准对齐

以 `Zotero-BridgeFlow`（v1.1.3）为架构基准，在不破坏 MetaFlow 现有 59 项治理规则、双核流水线（离线检查修复 vs 在线元数据增强）、`Zotero.MetaRef` 公开门面与 123+ 测试套件的前提下，推进以下核心演进：

1. **统一五层单向依赖骨架**：`bootstrap.js` / `src/index.ts` / `src/addon.ts` / `src/hooks.ts` ➔ `src/kernel/` ➔ `src/services/`（含 `src/services/host/`）➔ `src/domains/` ➔ `src/bridges/`。
2. **控制反转与确定性生命周期**：将原 `src/hooks.ts` 中 350+ 行的紧耦合上帝协调逻辑下沉为可组合的 `PluginKernel` + `DomainModule` + `BridgeModule` + `AsyncDisposableStack`，消除孤儿监听器与时序竞态。
3. **集中化基础设施复用**：全仓统一收口 `Zotero.Prefs.registerObserver`（引用计数去重 + `AbortSignal` 自动清理 + 观察者驱动一致性缓存）与 `Zotero.Notifier.registerObserver`（单实例扇出），统一收口跨模块缓存清理与持久化刷盘。
4. **宿主私有 API 防腐围栏（ACL）与零 GUI 契约冒烟**：所有原型补丁与 Zotero 内部成员访问收敛至 `src/kernel/native-runtime.ts` 与 `src/services/host/`，并引入 `scripts/smoke-zotero.mjs` 对本机真实 `omni.ja` 执行 7 项宿主契约检查。

---

## 2. BridgeFlow 与 MetaFlow 五层架构映射表

| 层级 | BridgeFlow v1.1.3 基准 | MetaFlow v17.2.0 实现 | 核心职责与约束 |
|---|---|---|---|
| **Entry** | `BridgeFlowApp` (`src/index.ts`) | `Addon` (`src/addon.ts`) + `hooks` (`src/hooks.ts`) | 组装内核、服务、4 个领域模块与 2 个桥接模块；保留 `Zotero.MetaRef` 兼容性 |
| **Kernel** | `PluginKernel`, `TypedEventBus`, `DomainPortRegistry`, `CommandRegistry`, `NativeRuntime`, `UnifiedNotifierHub`, `UnifiedPrefService`, `DisposableStack` | `src/kernel/*`（新增 `AsyncDisposableStack` 与 `observeHostPrefs`） | 零业务/宿主模块依赖；统一管理生命周期、事件、命令、窄端口与集中监听 |
| **Services & Host ACL** | `ServiceContainer`, `src/services/host/*` | `ServiceContainer`, `CacheCoordinatorService`, `src/services/host/*` | 缓存清理/持久化统筹；隔离 `CollectionTreeRow.prototype`、`PreferencePanes.pluginPanes`、`ProgressWindowSet.tile` 等宿主私有细节 |
| **Domains** | `workspace`, `visual-notes`, `inspector`, `word-cite` | `workspace-ui`, `journal-insights`, `review-duplicates`, `lint-engine` | 各自内聚封装 `src/modules/` 能力并暴露窄 `DomainPort`；严禁跨领域直接导入 |
| **Bridges** | `CiteBadgeBridge`, `SpotlightFusionBridge`, `LookupWorkspaceBridge`, `VisualNotesBridge`, `CopyHistoryBridge` | `ItemSyncBridge`, `AutomaticIngestBridge` | 仅依赖 `src/kernel/` 与 `src/services/`，通过 `requires` 联动域启停与跨领域事件响应 |

---

## 3. 核心接口契约

### 3.1 强类型事件总线 (`MetaFlowEventMap`)
- `prefs:changed`: `{ key, value }` ➔ `ServiceContainer` 自动刷新 `bumpLintPrefsRevision()`
- `notifier:event`: `NotifierEventPayload` ➔ `ItemSyncBridge`、`AutomaticIngestBridge` 响应条目增删改
- `tldr:updated`: `{ itemIDs }` ➔ `ItemSyncBridge` 联动刷新期刊侧栏，解除 `item-info-row.ts` 与 `journal-pane` 的直接耦合
- `journal:refresh-requested`: `{ itemIDs?, reloadInsights? }` ➔ `JournalInsightsDomainModule` 响应设置页刷新请求
- `cache:clear-requested`: `{ target: "memory" | "persistent" | "all" }` ➔ `CacheCoordinatorService` 统一清理缓存

### 3.2 跨领域窄端口 (`DomainPortMap`)
- `lint-engine` (`LintEnginePort`): `runBatch`, `stopAll`, `enqueueAddedItems`, `cancelAddedItems`, `drainAddedItems`, `isSavingPhase`
- `journal-insights` (`JournalInsightsPort`): `refreshPane`, `refreshInsights`, `refreshItemJournal`, `setUpdateResult`, `syncExtraColumns`
- `review-duplicates` (`ReviewDuplicatesPort`): `runReview`, `processImportedDuplicates`, `invalidateStats`, `refreshStats`
- `workspace-ui` (`WorkspaceUiPort`): `refreshTldrRow`, `placeTldrRow`, `executeShortcut`

---

## 4. 已完成的渐进式迁移清单（v17.2.0）

1. **微内核基础设施落盘**：`src/kernel/{types,disposable,event-bus,native-runtime,notifier-hub,pref-service,domain-ports,command-registry,plugin-kernel}.ts` 与 `src/kernel/kernel.test.ts`。
2. **服务层与宿主 ACL 落盘**：`src/services/{cache-coordinator,service-container}.ts`、`src/services/host/{host-capabilities,collection-tree-adapter,preference-pane-adapter,index}.ts`、`src/services/services.test.ts` 与 `scripts/smoke-zotero.mjs`。
3. **四域二桥编排落盘**：`src/domains/{workspace-ui,journal-insights,review-duplicates,lint-engine}/module.ts`、`src/bridges/{item-sync-bridge,automatic-ingest-bridge,bridges.test}.ts`，并完成 `src/addon.ts`、`src/hooks.ts`、`src/api.ts` 集成。
4. **存量紧耦合与裸宿主调用消解**：
   - 消除 `item-info-row.ts` ➔ `journal-pane`、`journal-database-settings.ts` ➔ `journal-pane` 横向导入；
   - 将 5 处分散的 `Zotero.Prefs.registerObserver` 与 1 处裸 `Zotero.Notifier.registerObserver` 全部收口到内核层；
   - 将 `duplicate-stats.ts`、`preference.ts`、`native-duplicate-pane.ts`、`completion-notice.ts` 的宿主内部 API 访问全部收口到 `src/services/host/`；
   - 消除 `item-info-row.ts` 中的沙箱不安全 `queueMicrotask` 调用。
5. **架构守卫升级（13 ➔ 20 项）**：`scripts/architecture-guard.mjs` 新增五层单向依赖、Bridge 纯净度、宿主 ACL 围栏、集中观察者、沙箱安全、EventBus 闭环与 `smoke-zotero.mjs` 完整性 7 项硬性门禁。

---

## 5. 后续渐进式演进路线图（Post-v17.2.0）

- **Phase 2（按需切分）**：将 `src/modules/rules/` 的核心规则注册表与执行调度逐步绑定 `CommandRegistry` 与 `PrefSchema` 运行时校验（对标 BridgeFlow `valibot` schema）。
- **Phase 3（设置页与子模块内聚）**：在不破坏 E2E 选择器的前提下，将 `src/modules/settings-*.ts` 与 `src/modules/journal-pane/*` 逐步收敛至 `src/domains/workspace-ui/` 与 `src/domains/journal-insights/` 子包目录。
