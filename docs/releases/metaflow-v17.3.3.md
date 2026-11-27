# Zotero MetaFlow v17.3.3

Zotero MetaFlow `v17.3.3` 修复了 `v17.3.2` 独立深度复核中确认的生命周期门控、headless smoke 判据、DOI 元数据回退链与 URL 协议安全问题：

## 核心修复与改进

1. **微内核生命周期门控与 Notifier 时序修复（`src/hooks.ts`、`src/domains/journal-insights/module.ts`）**
   - `onNotify` 严格校验 `kernel.isStarted && !kernel.isDisposed`，移除绕过内核开关的 Port 重注册与 Bridge 强启调用，确保域停用后不会因通知复活；
   - 将 `registerNotifier()` 移至 `await kernel.start()` 完成之后，避免启动期 `preload()` 阶段提前接收宿主通知；
   - `kernel.init` 注入真实 `package.json` 版本号；
   - `JournalInsightsDomainModule.refreshItemJournal` 在入口及写回前校验 `this.active`，并在 `finally` 中仅清理当前任务引用（防止 stale-finally 误删新任务）。
2. **Headless Smoke 判据收紧（`scripts/smoke-launch.mjs`）**
   - 先执行临时 profile 清理，再计算验收结果；
   - 要求 `addonSeen && addonActive`（消除扩展未加载却误判 PASS 的漏洞）、`(!timedOut || treeKilled)` 及 `cleanup.removed` 全部成立。
3. **DOI 元数据回退链与安全校验完善（`src/services/metadata/metadata-inspector.ts`、`src/services/metadata/tool-update-metadata/services/translate-service.ts`）**
   - 主链仅在 `matched?.title && normalizeDOI(matched.DOI) === value.toLowerCase()` 时提前 `break`，当首个来源未返回 DOI 时继续尝试后续来源补齐 DOI 与期刊字段；
   - `triedS2` 改在 `svc.fetch` 返回后置位，避免瞬时网络抖动永久跳过 Semantic Scholar 补洞；且只要命中非错配回退记录（`!usedMismatched && (!matched.DOI || ...)`）即可触发补全；
   - 无 API Key 回退顺序与 `services/index.ts` 对齐为 `OpenAlex → Semantic Scholar → URLTranslateService`；
   - `inspectPreprint` 的 Semantic Scholar 回退路径补齐 `try/catch` 错误隔离，并复用 `src/utils/rule-execution.ts` 的 `createAbortController`；
   - `URLTranslateService` 强制校验 `http:` / `https:` URL scheme，拦截 `file:` / `chrome:` / `javascript:` 等非 HTTP(S) 地址。
4. **守卫与代码卫生完善（`scripts/architecture-guard.mjs`、`src/services/host/preference-pane-adapter.ts`、`src/utils/journal-card-share.ts`）**
   - `collectRelativeImports` 扩展覆盖副作用 `import "..."`、动态 `import("...")` 与 `require("...")`；
   - `dedupeAndRegisterPreferencePane` 在已有 pane 但插件已停用时注销后返回空字符串；
   - 修正 `showNativeNotice` 中两条复制残留的调试日志文案。
