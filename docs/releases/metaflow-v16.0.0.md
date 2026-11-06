# Zotero MetaFlow 16.0.0

Zotero MetaFlow 正式发布 **16.0.0** 大版本，标志着全系统一大版本（Zotero Flow Unified Major Release 16.0.0）协同确立。

## 🌟 核心升级与特性

1. **统一全系大版本号**：跃升至 16.0.0，与 Zotero Flow 家族其余六大插件保持完全一致的版本号与协同发布契约；
2. **彻底封杀 Gecko 153 过时接口**：全面剔除 `Components.utils` 与 `Components.classes` 历史残留，全面切换至沙箱原生特权全局 `Cu`、`Cc` 与 `Ci`，全面适配 Gecko 153+ / Firefox 140+；
3. **端到端测试链路自愈与环境适配**：`scripts/test-e2e.mjs` 原生支持 Windows / macOS / Linux 宿主二进制自愈嗅探，无需手工配置即可直通 227 项端到端测试；
4. **架构守护与 360 行红线**：全量 40+ 核心模块 100% 恪守 360 行上限约束（0 债务）；
5. **Fluent 本地化中英双语严格对称**：全面板 100% Fluent `data-l10n-id` 驱动，零硬编码。
