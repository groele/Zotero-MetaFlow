# Zotero MetaFlow 17.0.0

Zotero MetaFlow 正式发布 **17.0.0** 大版本（Zotero Flow 统一版本发布）。

## 核心更新与改进

1. **统一大版本升级与发布基线收敛**：
   - 版本号升级至 `17.0.0`，同步更新 `package.json`、`docs/brand/product.json`、`scripts/architecture-baseline.json`、`update.json` 与 `dist/` 校验产物；
   - 保持 Zotero 10.0–12.* 兼容声明（Gecko 153+ / Firefox 140 现代架构），`npm run guard` 与 `npm run typecheck` 全项通过。
2. **身份校验、匹配精度与诊断完善（继承自 16.1.2–16.1.4）**：
   - 强化同名期刊跨 ISSN 分区与 EasyScholar / 南农指标身份校验，收紧中文标题自动更新与无第一作者标题检索的误匹配防护；
   - 完成条目诊断消息的 Fluent 本地化，并在多阶段工作流中明确分段保存进度提示；
   - 精简设置面板冗长说明文案，补充折叠摘要悬停提示，保持 100% Fluent 驱动与 40px 三级对齐基线。
3. **规则契约与代码洁净度打磨**：
   - 清理 `src/modules/rules/rule-base.ts` 中已由 `menu.ts` 接入的 `getItemMenu` 过时 `@todo` 注释，确认 `src/vendor/abbrev-iso.js` 受 `vendorAssets` 哈希基线保护，其余 TS 源码全部保持 ≤ 360 行且零 `@ts-ignore`/`@ts-nocheck`。

兼容声明为 Zotero 10.0–12.*；实际验证范围以本次发布验证结果为准。
