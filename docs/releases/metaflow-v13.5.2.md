# Zotero MetaFlow 13.5.2

**发布日期：** 2026-11-03  
**发布版本：** 13.5.2  
**更新类型：** 数据隔离与防串扰加固（彻底隔离单篇学术「撷论 (TL;DR)」与用户自主「简记 (Remark)」）

---

## 🚀 核心改进与防串扰解耦

### 1. 彻底解耦「撷论 (TL;DR)」与「简记 (Remark)」
- **根除字段与格式串扰**：
  - 严格限制 Extra 字段中「撷论」的标准前缀仅为 `TLDR:` / `撷论:`，彻底弃用并禁止写入 `remark:` 前缀；
  - 默认 Extra 写入格式权威切换为 `tldr`（即 `TLDR:`），绝不与 Ethereal Style 或用户自定义的 `remark:`（简记）发生重名碰撞；
- **防覆盖与防误删隔离**：
  - `cleanseTLDRFromExtra` 严格限制只匹配和清理 `TLDR:` / `撷论:` 行，绝不触碰或删除 Extra 字段中用户的 `remark:` / `简记:` 文本；
  - `saveTLDRToExtra` 在写入或替换历史论点时，只替换旧有的 `TLDR:` 行，绝不覆盖或抹去用户的 `remark:` / `简记:` 行；
- **提取与视图展示隔离**：
  - `extractTLDRFromExtra` 彻底移除对 `remark:` 和 `简记:` 的后备提取，条目仅存在用户简记时绝不会被误识别为具备学术 TL;DR；
  - `extractTLDRFromNote` 彻底移除对包含 `简记` 或 `remark` 关键词用户笔记的侵入式提取，保护用户私人阅读随笔与章节笔记不受干扰；
  - 条目信息面板（`placeTLDRBeforeExtra`）中，当 Extra 仅包含用户私人 `remark:` 时，原生「其他 (Extra)」字段行将保持正常展示与编辑，绝不因误判为 TL;DR 而被隐藏。

---

## 📦 构建与发布产物验证

- **版本号：** `13.5.2`
- **插件标识：** `metaflow@groele`
- **发布产物：** `zotero-metaflow.xpi`
- **文件体积：** `3,514,106` 字节
- **SHA-256：** `d1c29a65e0d986797b4da8fd8e48b29b9fd450f0bb6c68a41c7511f857a4f882`
