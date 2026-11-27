# Zotero MetaFlow 17.1.1

Zotero MetaFlow 发布 **17.1.1** 版本，补齐期刊索引内置数据库在设置面板中的真实落地路径显示与悬浮查看体验。

## 核心更新与改进

1. **内置期刊数据库（ESI / Nature Index）真实文件路径直观展示**：
   - 将内置 `esi-journals.json` 与 `nature-index-journals.json` 自动原子落地至配置目录 `<Zotero Profile>/metaflow/` 下（与内置期刊缩写 `journal-abbr.json` 目录规范完全对齐）；
   - 设置面板中的 ESI 与 Nature Index 数据路径输入框默认直接展示当前生效的内置文件真实路径（不再留空仅显示灰色占位符），鼠标悬停即可查看完整路径；
   - 点击「校验数据库」或「清除路径」后，状态提示行同步展示具体的内置或自定义文件路径（如 `内置数据库 (.../metaflow/esi-journals.json)`），且拦截宿主 `syncfrompreference` 空值覆盖以保持路径常驻可见。
2. **完整包含 17.1.0 全部核心增强**：
   - 无密钥（OpenAlex + 原生 Translator）/ API 双模自适应元数据补全、化学式角标深度修复、BridgeFlow 风格 6 栏横向标签设置面板及全链路性能优化。

兼容声明为 Zotero 10.0–12.*，`13/13` 项架构守卫与全量单元测试通过。
