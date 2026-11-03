# Zotero MetaFlow 13.5.1

**发布日期：** 2026-11-03  
**发布版本：** 13.5.1  
**更新类型：** 界面边界规约与职责解耦（从期刊索引侧边栏完全剥离单篇文献级「撷论 (TL;DR)」卡片）

---

## 🚀 核心改进与界面边界调整

### 1. 从「期刊索引」侧边栏彻底剥离篇章级「撷论 (TL;DR)」展示
- **权责边界纠偏**：右侧边栏「Zotero MetaFlow 期刊索引」专用于呈现**期刊/出版物级别**的学术指标与索引收录情况（JCR 分区、中科院分区、影响因子 IF、SCI 收录、ESI 学科分类、Nature Index、匹配 ISSN 等）；
- **移除误置卡片**：从期刊索引卡片容器（`renderInsightsCard`）、arXiv 预印本卡片（`renderPreprintCard`）和网页快照复活卡片（`renderSnapshotCard`）中彻底移除 Semantic Scholar 单篇文献摘要「💡 撷论 (TL;DR 核心论点)」的插入渲染与 `createTLDRBox` 结构；
- **修正激活判定**：修正 `supportsSection` 激活逻辑，消除因条目具备篇章 TL;DR 而错误强行激活期刊面板的问题。

### 2. 保证「撷论 (TL;DR)」在专职功能位稳健呈现
- 篇章级「撷论 (TL;DR)」继续通过正规学术交互渠道稳健提供：
  - **条目信息面板**：在 `<info-box>` / `#info-table` 原生信息区通过专用字段行（`workflow.tldrShowInInfoPane`）展示并支持直接双击修改；
  - **文献列表表格**：通过 Zotero 条目树列表的「撷论」列直观呈现；
  - **条目正文与笔记**：根据用户偏好（`workflow.tldrTarget`）妥善存储至独立笔记（Note）、附加字段（Extra）或摘要（Abstract）。

---

## 📦 构建与发布产物验证

- **版本号：** `13.5.1`
- **插件标识：** `metaflow@groele`
- **发布产物：** `zotero-metaflow.xpi`
- **文件体积：** `3,514,237` 字节
- **SHA-256：** `47aee81a49ffadedaa4b4d6c98f90cb3846aecfa63371667b11d0a3acb8f0eeb`
