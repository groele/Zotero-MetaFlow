# Zotero MetaFlow 13.5.4

## 核心变更 (Highlights)

1. **[P0 只读/回收站安全加固] `TL;DR` 自动迁移与手动保存全链路回收站 (`!item.deleted`) 及只读守卫**：
   - 在 `item-info-row.ts` 的 `onItemChange`、`onSetData` 以及 `tldr.ts` 的 `saveTLDRToItem`、`saveTLDRToNote`、`backfillItemTLDR` 中全面补充 `!item.deleted && item.isEditable()` 双重安全检查，彻底杜绝点击浏览个人库回收站 (`item.deleted === true`) 或群组只读库条目时自动创建子笔记或触发非法写库。
2. **[P1 生命周期零泄漏] 定时器句柄集中托管与 `addon.data.alive` 守卫**：
   - 将 `item-info-row.ts` 中 `0 / 50 / 200ms` 延迟执行的 `setTimeout(placeTLDRBeforeExtra)` 统一纳入 `activeTimers` 集合管理，在 `unregisterInfoRows()` 卸载时通过 `clearPendingTimers()` 彻底清理；同时在 `placeTLDRBeforeExtra` 与 `refreshTLDRInfoRow` 入口增加 `addon?.data?.alive === false` 守卫，防止插件关闭后残留定时器重新挂载 `MutationObserver`。
3. **[P1 附件重命名防冲突] 多主文档 (`main_pdf`) 独立递增序号与子附件只读/回收站过滤**：
   - 在 `correct-attachment-roles.ts` 获取子附件时逐一校验 `!att.deleted && att.isEditable()`；
   - 新增 `mainIndex` 计数器，当同一父条目下存在多个正文主文档 (`main_pdf`) 时，第 2 个起自动生成 `_Main__2.pdf`（标题对应 `[正文 2]`），彻底消除同名文件覆盖与重命名冲突。
4. **[P2 双核边界体验优化] 侧边栏「期刊洞察」面板导航守卫**：
   - 在 `journal-pane/index.ts` 的 `completeFromNavigation` 与 `hooks.ts` 的 `onRefreshJournal` 中补充 `!item.deleted && item.isEditable()`、插件存活状态、`metadata.updateJournalInfo` 偏好开关及有效 `easyscholar.secretKey` 校验，避免在未配置密钥或关闭自动更新时点击侧边栏触发无效在线请求与写库。
