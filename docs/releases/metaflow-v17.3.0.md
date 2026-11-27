# Zotero MetaFlow 17.3.0

Zotero MetaFlow 发布 **17.3.0** 版本，以 `Zotero-BridgeFlow` 为基准全面完成五层微内核架构业务下沉迁移（消除骨架中间态），修复深度审计检出的 8 项生命周期重入与集中观察者边界问题，并补齐隔离临时 Profile 无头 Zotero 真实启动与清理冒烟验证。

## 核心更新与改进

1. **五层微内核架构全面下沉落地（零跨域导入、零骨架遗留）**：
   - 将原扁平 `src/modules/` 下的全部 100 个生产模块与随附单测物理收敛至 `src/services/`（`lint/`、`metadata/`、`duplicates/`、`host/`）与四大内聚领域目录 `src/domains/{workspace-ui,journal-insights,review-duplicates,lint-engine}/`；
   - 新增 `src/services/lint/rule-registry.ts` 与 `ReviewDuplicatesPort.setupSettingsPane` 等窄端口，实现跨域引用数清零，`src/` 内生产代码对 `src/modules/` 引用数清零（`src/modules/` 仅保留 7 个单行纯 `export *` 外部测试兼容垫片）。
2. **补齐无头 Zotero 真实启动与清理冒烟（`pnpm run smoke:launch`）**：
   - 新增 `scripts/smoke-launch.mjs` 并升级 `scripts/smoke-zotero.mjs`，支持在独立临时 Profile 下以 `-headless -no-remote -ZoteroDebugText` 启动真实 Zotero 宿主，验证 `metaflow@groele` 注册与激活状态、零插件脚本异常、子进程树按 PID 回收及临时目录重试清理。
3. **生命周期可重入与观察者一致性深度加固**：
   - 修复 `UnifiedPrefService` 观察未配置项缓存覆盖显式 `fallback`（引入 `UNSET_PREF` 哨兵）、`Zotero.Notifier` 统一路由至 `addon.hooks.onNotify`、自动入库动态委派 `hooks.onLintInBatch`、`UnifiedNotifierHub.restart()` 保留订阅者、`PluginKernel.revive()` 支持同实例关闭后重启、`hooks.onNotify` 存活守卫与端口按需注册、`ItemSyncBridge` 微任务存活校验及并发窗口加载 Promise 去重等 8 项问题，并新增 `src/architecture-regressions.test.ts` 与 `src/smoke-zotero.test.ts` 回归测试。
4. **架构守卫升级至 21 项**：
   - 在 `scripts/architecture-guard.mjs` 中强制禁止 `src/` 生产代码导入 `src/modules/`、强制校验兼容垫片单行纯净度，并校验 `smoke:host` 与 `smoke:launch` 双模宿主冒烟入口完整性。

兼容声明为 Zotero 10.0–12.*，`21/21` 项架构守卫、`7/7` 项 `omni.ja` 宿主契约、本机 Zotero 10.0.8 无头真实启动冒烟与 `840` 项单元测试全部通过。
