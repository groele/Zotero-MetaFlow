# Zotero MetaFlow 17.3.1

Zotero MetaFlow 发布 **17.3.1** 补丁版本，彻底修复 Gecko `Services.scriptloader.loadSubScript(url, ctx)` 沙箱作用域下 `globalThis.addon` 解析为空导致的设置页「查重与合并 → 去重设置」控件未渲染及跨域窄端口解析失败问题，并新增第 22 项架构守卫永久阻断此类隐患。

## 核心修复与加固

1. **修复设置面板「查重与合并 → 去重设置」单选组与并发组数空白 Bug**：
   - 根因：Zotero `bootstrap.js` 通过 `Services.scriptloader.loadSubScript(url, ctx)` 加载插件脚本时，`addon` 挂载在 `ctx`（即 `_globalThis`）与 `Zotero.MetaRef` 上，而外层 BackstagePass 的 `globalThis.addon` 为 `undefined`，导致 `preference.ts` 中通过 `globalThis.addon` 调用 `ReviewDuplicatesPort.setupSettingsPane(pane)` 被静默跳过；
   - 修复：在 `src/kernel/host-globals.ts` 中统一封装 `resolveAddonHost()` 与 `resolveZoteroHost()`，按 `addon / Zotero` 词法作用域 → `_globalThis` → `globalThis` → `Zotero.MetaRef` 顺序安全解析宿主实例，并全量替换全仓 16 个模块中的 `globalThis.addon` / `globalThis.Zotero` 访问。
2. **启动恢复期领域窄端口前置注册**：
   - 在 `src/hooks.ts` 的 `onStartup()` 中将 4 个领域的 `ensurePortRegistered()` 前置于 `workspaceUi.startEarly()` 之前执行，确保插件禁用再重新启用时偏好页可立即获取完整领域端口。
3. **新增第 22 项架构守卫与沙箱作用域回归单测**：
   - `scripts/architecture-guard.mjs` 新增 `Gecko loadSubScript sandbox global safety` 门禁，严禁业务与服务代码绕过 `host-globals.ts` 直接读取 `globalThis.addon` 或 `globalThis.Zotero`；
   - 新增 `src/domains/review-duplicates/duplicate-settings.test.ts` 模拟 `globalThis.addon === undefined` 真实 `loadSubScript` 拓扑，验证默认操作单选组、主条目的 4 项策略单选组与默认并发数 `3` 完整渲染。

兼容声明为 Zotero 10.0–12.*，`22/22` 项架构守卫、`7/7` 项 `omni.ja` 宿主契约、本机 Zotero 10.0.8 无头真实启动冒烟与 `842` 项单元测试全部通过。
