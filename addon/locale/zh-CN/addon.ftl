## General
prefs-title = Zotero MetaFlow

## Item tree
field-abbr = 缩写
    .value = 缩写
    .label = 缩写
field-tldr = 撷论
    .value = 撷论
    .label = 撷论
info-row-tldr = 撷论
    .value = 撷论
    .label = 撷论

## batch
info-batch-init = 初始化中...
info-batch-no-selected = 未发现可执行的任务
info-batch-running = 正在处理中，请耐心等待...
info-batch-finish = 处理完成
info-batch-break = 点击此处结束本次处理
info-batch-stop-next = 将在当前条目处理完成后结束
info-batch-has-error = 存在错误，请在控制台查看错误信息

## dialog
confirm = 确认
cancel = 取消
subscript = 下标
supscript = 上标
bold = 粗体
italic = 斜体
no-case = 保持大小写
small-caps = 小型大写字母
unimplemented = 此功能尚未实现。

info-batch-pending-save = 等待保存...
info-batch-saving = 正在保存...
undo-action-lint-metadata = { $count ->
    [one] 整理元数据
   *[other] 整理 { $count } 个条目的元数据
}
info-batch-cancelled = 已停止：处理 { $processed } 条，跳过 { $skipped } 条
info-batch-duration = 耗时 { $seconds } 秒
report-export = 导出报告与字段变更
report-export-failed = 导出失败，点击重试。
report-prepare-failed = 规则准备失败
report-save-conflict = 条目在保存重试前已被更新，已保留当前文库内容，本次变更未覆盖。请核对后重新运行；冲突字段：{ $fields }。
info-batch-details = 已保存 { $saved }；未变化 { $unchanged }；不适用 { $notApplicable }；提醒 { $warnings }。

completion-notice-open = 点击查看报告 · 5 秒后自动消失

report-search = 搜索标题、条目 ID、规则或消息
report-filter = 筛选报告条目
report-filter-all = 所有条目
report-filter-warning = 有警告的条目
report-filter-error = 有错误的条目
report-filter-changed = 有字段变更的条目
report-previous = 上一页
report-next = 下一页
report-page = 第 { $page } / { $pages } 页 · { $count } 个条目

native-duplicates-merge-all = 一键合并当前库全部重复项
native-duplicates-start = 开始批量合并
native-duplicates-dismiss = 关闭结果
native-duplicates-scanning = 正在扫描当前文库的全部原生重复组…
native-duplicates-empty = 当前文库没有可处理的重复组。
native-duplicates-confirmation = 共 { $groups } 组、{ $items } 个条目。主条目策略：{ $strategy }。自动补齐空字段，冲突字段保留主条目值；附件、笔记、标签、集合及关联交由 Zotero 原生合并保留。不同类型、非重复标记或处理中变更的组将跳过。是否开始？
native-duplicates-progress = 已处理 { $completed }/{ $total } 组，合并 { $merged } 个重复条目，跳过 { $skipped } 组，失败 { $failed } 组。
native-duplicates-stopped = 已停止：处理 { $completed }/{ $total } 组，合并 { $merged } 个重复条目，跳过 { $skipped } 组，失败 { $failed } 组。已完成的合并保留。
native-duplicates-error = 批量合并失败：{ $error }

diag-missing-doi-url = DOI 字段为空（可从网址自动提取：{ $doi }）
diag-missing-doi = 缺少官方学术 DOI 标识符
diag-non-standard-doi = DOI 字段包含多余 URL 前缀或前置字符
diag-missing-creators = 作者字段为空，缺少创作者信息
diag-placeholder-creators = 作者字段仅含未解析的占位符（如 (姓), (名)）
diag-contaminated-title = 标题包含网页/出版商抓取残留后缀（如 Wiley / ScienceDirect 等）
diag-trailing-dot-title = 标题末尾包含多余标点句号
diag-missing-publication = 缺少期刊出版物名称 (Publication Title)
diag-missing-date = 缺少出版日期/年份 (Date)
diag-missing-pagination = 缺少文献定位信息 ({ $fields })
diag-field-volume = 卷号
diag-field-issue = 期号
diag-field-pages = 页码
diag-missing-abstract = 缺少论文摘要 (Abstract)
