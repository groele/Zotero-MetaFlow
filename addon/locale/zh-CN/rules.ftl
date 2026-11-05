## no-item-duplication
rule-no-item-duplication =
  .label = 不应添加重复条目
rule-no-item-duplication-report-message = 该条目与已有条目重复
rule-no-item-duplication-report-action = 前往合并条目窗格
rule-no-item-duplication-search-failed = 无法检查此文献库中的重复条目：{ $error }


## no-article-webpage
rule-no-article-webpage =
  .label = 网页条目不应连接到学术出版社（应为期刊文章或其他类型）
rule-no-article-webpage-report-message = 该网页条目 URL 中包含了主要学术出版商的域名，请确认条目类型！


## no-journal-preprint
rule-no-journal-preprint =
  .label = 预印本不应保存为期刊文章
rule-no-journal-preprint-report-message = 该条目包含预印本标识符，但类型为期刊文章。请核对类型和元数据。
rule-no-journal-preprint-report-action = 尝试更新元数据


## no-value-nullish
rule-no-value-nullish =
  .label = 字段值不应为无效值（无、N/A 等）


## no-field-misuse
rule-no-field-misuse =
  .label = 清理被滥用的标准字段


## correct-attachment-roles
rule-correct-attachment-roles =
  .label = 正文与补充材料（SI）角色解耦与规范命名
rule-correct-attachment-roles-menu-item =
  .label = 解耦正文与补充材料（SI）角色
rule-correct-attachment-roles-option-rename-pdf =
  .label = 按照正文与补充材料角色自动规范重命名 PDF 文件
rule-correct-attachment-roles-option-sync-title =
  .label = 同步更新附件条目标题（明确标注 [正文] 与 [补充材料]）
rule-correct-attachment-roles-option-template = PDF 安全重命名模板：
rule-correct-attachment-roles-option-template-description = 可用占位符：{ "{" }author{ "}" }（第一作者）、{ "{" }year{ "}" }（年份）、{ "{" }title{ "}" }（标题）、{ "{" }role{ "}" }（角色标记：Main / Supplement）。默认：{ "{" }author{ "}" }_{ "{" }year{ "}" }_{ "{" }title{ "}" }_{ "{" }role{ "}" }。
rule-correct-attachment-roles-description =
  自动识别文献挂载的多个附件，将其智能归类为“主手稿（Manuscript）”与“补充材料（SI）”，分别套用安全命名并更新标题，避免 Nature/Science 等顶级刊物的关键实验细节混淆。
rule-correct-attachment-roles-report-message =
  已识别并解耦附件角色：{ $summary }
rule-correct-attachment-roles-report-action =
  查看附件


## require-language
rule-require-language =
  .label = 语言字段应填写 ISO 639-1 语言代码
rule-require-language-menu-item =
  .label = 自动识别条目语言
rule-require-language-menu-field =
  .label = 自动识别（Zotero MetaFlow）

rule-require-language-option-only =
  .label = 限制识别的语言以提高准确度：
rule-require-language-option-only-cmn =
  .label = 简体中文 (zh)
rule-require-language-option-only-eng =
  .label = 英文 (en)
rule-require-language-option-only-other = 和
rule-require-language-option-only-other-desc = 如需添加其他语言，请在空白处输入 ISO 693-1 语言代码，英文逗号','分隔。
rule-require-language-option-only-other-doc = ISO 639-1 代码
  .href = https://github.com/groele/Zotero-MetaFlow/blob/main/docs/features.md#require-language-require-language
rule-require-language-option-verify-before =
  .label = 若语言字段已包含有效的 ISO 639-1 代码，跳过处理


## require-short-title
rule-require-short-title =
  .label = 主标题应填入短标题


## correct-title-sentence-case
rule-correct-title-sentence-case =
  .label = 标题应以句子式大写存储
rule-correct-title-sentence-case-menu-item =
  .label = 将标题改为句首大写
rule-correct-title-sentence-case-menu-field =
  .label = 句首大写（Zotero MetaFlow）

rule-correct-title-sentence-option-custom-term = 自定义术语：
  .label = 自定义术语
  .placeholder = 自定义术语文件的路径
rule-correct-title-sentence-option-custom-term-button =
  .label = 选择
rule-correct-title-sentence-option-custom-term-desc =  自定义术语文件使用 CSV 文件格式，第一列为搜索词，第二列为替换词，不需要标题，搜索词支持正则表达式。分隔符可以为逗号或分号，但须统一，不得为制表符。
rule-correct-title-sentence-option-disabled-languages = 为以下条目语言禁用自动标题大小写转换：
  .label = 为以下条目语言禁用自动标题大小写转换
  .placeholder = zh,ja,ko
rule-correct-title-sentence-option-disabled-languages-doc = ISO 639-1 alpha2 代码
rule-correct-title-sentence-option-disabled-languages-desc = 如需添加其他语言，请在空白处输入 ISO 693-1 alpha2 语言代码，英文逗号','分隔。


## correct-title-punctuation
rule-correct-title-punctuation =
  .label = 标题中的符号应规范
rule-correct-title-punctuation-menu-field =
  .label = 规范符号（Zotero MetaFlow）
rule-correct-title-punctuation-quotes =
  .label = 直引号转换为弯引号


## correct-creators-punctuation
rule-correct-creators-punctuation =
  .label = 作者名中的符号应规范
rule-correct-creators-punctuation-menu-field =
  .label = 规范符号（Zotero MetaFlow）


## correct-shortTitle-sentence-case
rule-correct-shortTitle-sentence-case =
  .label = ShortTitle 也以句子式大写存储
rule-correct-shortTitle-sentence-case-description = 此规则与「{ rule-correct-title-sentence-case.label }」共享配置


## no-title-trailing-dot
rule-no-title-trailing-dot =
  .label = 标题不应以句号结尾


## correct-title-chemical-formula
rule-correct-title-chemical-formula =
  .label = 自动整理标题中的化学式上下标
rule-correct-title-chemical-formula-menu-item =
  .label = 自动整理化学式上下标
rule-correct-title-chemical-formula-menu-field =
  .label = 自动整理化学式上下标（Zotero MetaFlow）


## require-creators
rule-require-creators =
  .label = 作者不应为空


## correct-creators-case
rule-correct-creators-case =
  .label = 作者应以首字母大写方式存储
rule-correct-creators-case-menu-item =
  .label = 修正作者的大小写


## correct-creators-pinyin
rule-correct-creators-pinyin =
  .label = 作者中的中文拼音应被拆分（即 Zhang Sanfeng → Zhang San Feng）
rule-correct-creators-pinyin-menu-item =
  .label = 拆分作者拼音


## correct-date-format
rule-correct-date-format =
  .label = 日期应为 ISO YYYY-MM-DD 格式
rule-correct-date-format-menu-item =
  .label = 统一日期格式为 ISO 格式
rule-correct-date-format-menu-field =
  .label = 转为 ISO 格式（Zotero MetaFlow）


rule-correct-filing-date-format =
  .label = Filing Date 应为 ISO YYYY-MM-DD 格式
rule-correct-issue-date-format =
  .label = Issue Date 应为 ISO YYYY-MM-DD 格式
rule-correct-priority-date-format =
  .label = Priority Date 应为 ISO YYYY-MM-DD 格式



## correct-extra-order
rule-correct-extra-order =
  .label = 「额外」字段应有正确的顺序
rule-correct-extra-order-menu-item =
  .label = 修正「额外」字段的顺序
rule-correct-extra-order-menu-field =
  .label = 修正顺序 (Zotero MetaFlow)


## correct-publication-title-alias
rule-correct-publication-title-alias =
  .label = 期刊标题应去除别称
rule-correct-publication-title-alias-menu-item =
  .label = 修正期刊标题别称
rule-correct-publication-title-alias-menu-field =
  .label = 修正别称 (Zotero MetaFlow)


## correct-publication-title-case
rule-correct-publication-title-case =
  .label = 期刊标题应使用标题式大写
rule-correct-publication-title-case-menu-item =
  .label = 修正期刊标题大小写
rule-correct-publication-title-case-menu-field =
  .label = 修正大小写 (Zotero MetaFlow)


## require-journal-abbr
rule-require-journal-abbr =
  .label = 期刊缩写应不为空且为 ISO 4 格式
rule-require-journal-abbr-menu-item =
  .label = 自动填充期刊缩写
rule-require-journal-abbr-menu-field =
  .label = 查找缩写（Zotero MetaFlow）

rule-require-journal-abbr-option-infer =
  .label = 本地数据集没有期刊缩写时自动根据 ISO 4 规则推断缩写
rule-require-journal-abbr-option-with-dots =
  .label = 期刊缩写保留句点
rule-require-journal-abbr-option-usefull = 仍没有期刊缩写时使用全称代替：
rule-require-journal-abbr-option-usefull-en =
  .label = 英文期刊
rule-require-journal-abbr-option-usefull-zh =
  .label = 中文
rule-require-journal-abbr-option-custom-data-label = 自定义数据文件：
rule-require-journal-abbr-option-choose-custom-abbr-data-button =
  .label = 选择
rule-require-journal-abbr-option-choose-custom-abbr-data-input =
  .placeholder = 期刊缩写文件的路径
rule-require-journal-abbr-option-custom-data-desc =
  自定义缩写文件支持 JSON 格式和 CSV 格式。
  JSON 文件的格式为："publicationTitle": "abbreviation"。
  CSV 格式第一列填全称，第二列填简写，分隔符可以为逗号或分号，但须统一，不得为制表符。


## tool-query-esi
rule-tool-query-esi =
  .label = 校验期刊 ESI 学科识别（不写入字段）
rule-tool-query-esi-menu-item =
  .label = 获取期刊 ESI 学科
tool-query-nature-index =
  .label = 识别 Nature Index 期刊
tool-query-nature-index-menu-item =
  .label = 识别 Nature Index 名单期刊
tool-query-nature-index-description = 在独立侧栏和列表列显示期刊名单成员身份。不添加标签，不写入档案编号；期刊名单成员不代表该篇文章已被收录。

rule-tool-query-esi-option-format = 列表列显示格式：
rule-tool-query-esi-option-format-desc = 支持变量：{ "{" }subject{ "}" }（中文学科，如“物理学”）、{ "{" }category{ "}" }（英文学科大写，如“PHYSICS”）、{ "{" }en{ "}" }（英文学科，如“Physics”）。默认格式为：{ "{" }subject{ "}" }ESI（即“物理学 ESI”）。
rule-tool-query-esi-option-custom-data-label = 自定义数据文件：
rule-tool-query-esi-option-choose-custom-data-button =
  .label = 选择
rule-tool-query-esi-option-choose-custom-data-input =
  .placeholder = ESI 数据文件的路径
rule-tool-query-esi-option-custom-data-desc = 支持 JSON 和 CSV。内置 Clarivate 2026 年第 6 期主期刊表，含全部 22 个 ESI 学科和 12,245 个规范化刊名；自定义文件会替换内置名单。


## require-doi
rule-require-doi =
  .label = DOI 应填写完整
rule-require-doi-menu-item =
  .label = 根据标题查找 DOI
rule-require-doi-menu-field =
  .label = 查找 DOI（Zotero MetaFlow）


## no-doi-prefix
rule-no-doi-prefix =
  .label = DOI 无须保留网址前缀
rule-no-doi-prefix-menu-item =
  .label = 去除 DOI 网址前缀
rule-no-doi-prefix-menu-field =
  .label = 去除网址前缀（Zotero MetaFlow）


## correct-doi-long
rule-correct-doi-long =
  .label = DOI 应为长格式而非短格式


## correct-pages-connector
rule-correct-pages-connector =
  .label = 页码连接符应为 `-` 或 `,`


## correct-pages-range
rule-correct-pages-range =
  .label = 核对 PDF 推断的页码范围


## no-issue-extra-zeros
rule-no-issue-extra-zeros =
  .label = 期「issue」不应以 0 起始


## no-pages-extra-zeros
rule-no-pages-extra-zeros =
  .label = 页码不应以 0 起始


## no-volume-extra-zeros
rule-no-volume-extra-zeros =
  .label = 卷「volume」不应以 0 起始


## correct-conference-abbr
rule-correct-conference-abbr =
  .label = 会议名的缩写填入 extra.shortConferenceName 字段
rule-correct-conference-abbr-menu-item =
  .label = 自动填充会议缩写
rule-correct-conference-abbr-description = 此规则与「{ rule-require-journal-abbr.label }」共享配置


## correct-thesis-type
rule-correct-thesis-type =
  .label = 学位论文类别不可省略「学位论文」字样


## correct-university-punctuation
rule-correct-university-punctuation =
  .label = 中文大学中的括号应使用中文括号，反之应使用西文括号


## require-university-place
rule-require-university-place =
  .label = 高校所在地不可为空
rule-require-university-place-menu-item =
  .label = 填写高校所在地
rule-require-university-place-menu-field =
  .label = 查找（Zotero MetaFlow）


## correct-edition-numeral
rule-correct-edition-numeral =
  .label =  edition 应为纯数字


## correct-volume-numeral
rule-correct-volume-numeral =
  .label =  volume 应为纯数字


## correct-bookTitle-sentence-case
rule-correct-bookTitle-sentence-case =
  .label = 书籍标题应为句子式大写


## correct-proceedingsTitle-sentence-case
rule-correct-proceedingsTitle-sentence-case =
  .label = Proceedings title 应为句子式大写


## tool-title-guillemet
rule-tool-title-guillemet =
  .label = 转换标题中的尖括号「〈〉与《》」
rule-tool-title-guillemet-menu-item =
  .label = { rule-tool-title-guillemet.label  }


## tool-creators-ext
rule-tool-creators-ext =
  .label = 应用作者扩展信息
rule-tool-creators-ext-menu-item =
  .label = { rule-tool-creators-ext.label  }


## tool-set-language
rule-tool-set-language =
  .label = 手动设置条目语言
rule-tool-set-language-menu-item =
  .label = { rule-tool-set-language.label }


## tool-update-metadata
rule-tool-update-metadata =
  .label = 通过标识符更新元数据
rule-tool-update-metadata-menu-item =
  .label = Zotero MetaFlow：更新元数据
rule-tool-update-metadata-option-semanticScholarToken = Semantic Scholar API Key:
  .label = Semantic Scholar Token
  .placeholder = Semantic Scholar Token
rule-tool-update-metadata-option-semanticScholarToken-desc =
  当更新字段数据时，插件会从 Semantic Scholar 查询其题录数据。
  API Key 会保存在 Zotero 首选项中，并以密码形式显示。申请密钥可使用 Semantic Scholar 提供的认证配额。
rule-tool-update-metadata-option-semanticScholarToken-link = 申请

rule-tool-update-metadata-option-slient =
  .label = 使用默认设置直接更新，而不是每次操作都确认设置
rule-tool-update-metadata-dialog-title = 更新条目元数据
rule-tool-update-metadata-dialog-mode = 更新模式
rule-tool-update-metadata-dialog-mode-all =
  .label = 所有字段
rule-tool-update-metadata-dialog-mode-blank =
  .label = 仅空白字段
rule-tool-update-metadata-dialog-allow-type-changed =
  .label = 允许更改条目类型
rule-tool-update-metadata-dialog-notes = 说明
rule-tool-update-metadata-dialog-note-rate-limit = 某些 API 有速率限制；请避免批量处理。
rule-tool-update-metadata-dialog-note-type-change = 普通书目更新不改变条目类型；启用版本演进时保留预印本并关联正式版。


## tool-get-short-doi
rule-tool-get-short-doi-menu-item =
  .label = 获取短 DOI


## tool-csl-helper
rule-tool-csl-helper =
  .label = CSL-M 字段助手
rule-tool-csl-helper-menu-item =
  .label = { rule-tool-csl-helper.label }
rule-tool-csl-helper-menu-field =
  .label = { rule-tool-csl-helper.label }（Zotero MetaFlow）


## tool-clean-extra
rule-tool-clean-extra =
  .label = 清理「额外」字段
rule-tool-clean-extra-menu-item =
  .label = { rule-tool-clean-extra.label }
rule-tool-clean-extra-empty = 没有找到可清理的额外字段。
rule-tool-clean-extra-select = 选择要清理的额外字段

rule-correct-title-chemical-formula-option-normalize-spaces =
  .label = 修复化学式内部及异质结构分隔符两侧的多余空格
rule-correct-title-chemical-formula-description = 勾选后加入常规元数据检查和新条目自动整理；默认关闭，可通过右键菜单或 Ctrl+Alt+S 单独执行。支持 MoS2、Fe(NO3)3、Fe3+ 等，保留已有上下标和保持大小写标记。C4、P3 等含义不明确的缩写仍需人工复核。菜单显示开关不影响自动规则。
rule-no-article-webpage-report-action = 尝试更新元数据
rule-require-journal-abbr-custom-data-error = 自定义缩写数据不可用，已回退至内置数据：{ $error }
rule-tool-update-metadata-no-identifiers = 未找到可用的标识符或网址。
rule-tool-update-metadata-no-data = 未找到可用的元数据。{ $errors }
rule-tool-update-metadata-service-warning = 已通过 { $service } 更新元数据，部分服务失败：{ $errors }
rule-tool-update-metadata-invalid-date = 服务返回的访问日期无效，已保留原值。
rule-tool-update-metadata-invalid-creators = 服务返回的作者类型无效，已保留原作者列表。
rule-tool-update-metadata-type-change-loss = 更改条目类型会删除已有字段或改变作者角色。只补全空白字段模式已保留原类型，并补全兼容的空白字段。
rule-tool-query-esi-custom-data-error = 自定义 ESI 数据不可用，已回退至内置数据：{ $error }
rule-tool-update-easyscholar = 查询并保存期刊评级
rule-tool-update-easyscholar-description = 查询 EasyScholar 期刊评级并保存到 MetaFlow 本地索引，或按设置同时写入 Extra；可手动执行，也可明确启用新增条目自动查询。补充来源由独立开关控制。
rule-tool-update-easyscholar-menu-item = 查询 EasyScholar 期刊信息
rule-tool-update-easyscholar-no-title = 条目缺少期刊或会议名称，无法查询。
rule-tool-update-easyscholar-unconfigured = 请先在 MetaFlow 设置中填写 EasyScholar API 密钥。
rule-tool-update-easyscholar-not-found = EasyScholar 未返回“{ $title }”的评级信息。
rule-tool-update-easyscholar-no-fields = EasyScholar 返回了“{ $title }”的记录，但没有可写入的评级字段。
rule-tool-update-easyscholar-unchanged = “{ $title }”的已选 EasyScholar 字段与当前内容一致，无需更新。
rule-tool-update-easyscholar-failed = EasyScholar 查询失败：{ $error }
rule-tool-update-easyscholar-session-only = 期刊指标索引暂不可写，索引中的新结果仅在当前会话可用。请检查日志，并在重启 Zotero 后重试。
rule-tool-update-easyscholar-updated = 已获取“{ $title }”的 { $count } 项期刊字段并保存。
rule-tool-update-easyscholar-cleared = 已根据 EasyScholar 的最新结果，移除“{ $title }”中已失效的收录标记。
rule-no-field-misuse-review = 请检查 { $field }：“{ $value }”可能是其他工具写入的信息，也可能是有效内容，已保留原值。
rule-no-value-nullish-review = 请检查 { $field }：“{ $value }”可能是占位符或有效文字，已保留原值。
rule-tool-update-metadata-identity-conflict = { $service } 返回的作品身份与当前条目不一致或缺少可靠匹配依据，已跳过该结果。
rule-tool-update-metadata-incomplete = 更新后仍缺少以下核心信息，请核对：{ $fields }。
rule-tool-update-metadata-edited = 等待服务期间 { $field } 已发生变化，已保留当前值。
rule-tool-update-metadata-type-fields-preserved = 类型变更会移除以下已有字段，已保留原类型：{ $fields }。
rule-tool-update-metadata-type-roles-preserved = 类型变更会影响已有作者角色，已保留原类型。
rule-tool-update-metadata-field-source = { $field } 已更新，来源：{ $source }。
rule-require-creators-missing = 条目尚未记录作者，请核对文献来源。
rule-doi-unresolvable = 无法解析此 DOI。
rule-doi-missing = 此条目没有 DOI。
rule-doi-invalid = 此 DOI 格式无效。
rule-short-doi-failed = 短 DOI 请求失败：{ $status }。
rule-short-doi-empty = 服务未返回短 DOI。
tool-guillemet-choice = 转换方向
tool-guillemet-double = 将单书名号〈〉转为双书名号《》
tool-guillemet-single = 将双书名号《》转为单书名号〈〉
tool-guillemet-title = 转换标题书名号
tool-creators-mark = 标记符号
tool-creators-country = 国籍
tool-creators-country-hint = 留空时使用额外字段中的已有作者信息
tool-creators-title = 作者扩展信息
tool-language-choice = 选择语言
tool-language-input = 或手动输入语言
tool-language-title = 设置条目语言
tool-single-item-only = 请选中一个条目后使用此工具。
rule-rollback-failed = 失败规则的状态恢复异常，已停止处理和保存此条目，并尝试重新读取数据库中的原状态。

## Library maintenance tools
rule-tool-creators-style = 作者加粗、加星与清除标记
rule-tool-creators-style-menu-item = 作者加粗、加星与清除标记
    .label = 作者加粗、加星与清除标记
rule-tool-creators-swap = 交换作者姓和名
rule-tool-creators-swap-menu-item = 交换作者姓和名
    .label = 交换作者姓和名
rule-tool-title-replace = 文献题目查找替换
rule-tool-title-replace-menu-item = 文献题目查找替换
    .label = 文献题目查找替换
rule-tool-publication-replace = 期刊名称查找替换
rule-tool-publication-replace-menu-item = 期刊名称查找替换
    .label = 期刊名称查找替换
rule-tool-clear-all-extra = 清空所选条目的全部 Extra
rule-tool-clear-all-extra-menu-item = 清空所选条目的全部 Extra
    .label = 清空所选条目的全部 Extra
maintenance-author-action = 处理方式
maintenance-author-name = 作者姓名（留空处理全部作者）
maintenance-author-bold = 加粗
maintenance-author-star = 加星
maintenance-author-both = 同时加粗、加星
maintenance-author-removeBold = 清除加粗
maintenance-author-removeStar = 清除星号
maintenance-author-removeAll = 清除加粗和星号
maintenance-find = 查找文字（按字面匹配）
maintenance-replacement = 替换为（可以留空）
maintenance-replace-all = 替换每个字段中的全部匹配
maintenance-find-required = 查找文字不能为空，未修改任何条目。
maintenance-clear-extra-confirm = 将清空所选 { $count } 个条目的全部 Extra，包括手写备注和其他插件信息。是否继续？
metadata-auto-update-on-added = 新增条目时自动补充文章元数据
    .label = 新增条目时自动补充文章元数据
metadata-auto-update-description = 默认关闭。依赖新增条目自动检查；启用后按标识符联网补空，缺少标识符时仅在已有年份或作者可核验时按标题检索。遵守作者开关，不扫描 PDF，不改变条目类型。

rule-tool-update-easyscholar-supplemental-failed = 部分补充来源查询失败：{ $error }

rule-tool-update-easyscholar-disabled = 未启用任何期刊输出字段，已跳过查询。
rule-tool-update-easyscholar-source-deadline = EasyScholar 查询失败或超过独立来源时限。
rule-tool-update-easyscholar-summary = “{ $title }”：返回 { $returned } 项，选中 { $selected } 项；Extra 新增 { $added } 项、修改 { $updated } 项、移除 { $removed } 项。

rule-tool-update-easyscholar-no-selected-results = 查询已返回，但没有当前所选字段的可用数据；已保留原有信息。

abbr-match-ambiguous = 刊名宽松匹配存在多个不同缩写，已跳过自动替换；请使用精确刊名或自定义映射。
abbr-result = 期刊缩写：{ $value }；来源：{ $source }。
abbr-source-custom = 自定义映射
abbr-source-builtin = JabRef 内置映射
abbr-source-iso4 = 离线 ISO 4 推断
abbr-source-full = 全称回填
rule-fields-edited = 等待期间以下字段发生变化，已跳过延迟结果并保留当前值：{ $fields }。

rule-correct-pages-range-review = PDF 共 { $total } 页，候选页码为 { $range }。文件可能含封面或补充材料，请核对出版页码后手动填写；未自动修改。
rule-tool-review-metadata = 核验与补全文献
rule-tool-review-metadata-description = 核验 DOI、ISBN 或 arXiv 对应记录，从已索引 PDF 发现候选标识符，比较后逐字段采纳。
rule-tool-review-metadata-menu-item = 核验与补全文献…
rule-tool-review-preprint = arXiv 预印本转正
rule-tool-review-preprint-description = 根据 arXiv 关联 DOI 查找正式发表记录，将预印本无损转正为正式期刊/会议论文，或创建关联的正式版。
rule-tool-review-preprint-menu-item = arXiv 预印本转正（检查正式发表版本）…
preprint-card-description = 当前条目为 arXiv 预印本。MetaFlow 可自动检索官方出版 DOI，一键转正为期刊/会议论文并保留现有 PDF 批注与笔记。
preprint-converted-badge = 已由 arXiv 转正
snapshot-card-badge = 网页快照 / 剪藏条目
snapshot-card-description = 当前条目为剪藏网页快照。MetaFlow 可自动从本地 HTML 快照或原始网页中嗅探学术标识（DOI / arXiv ID / PMID），一键升级为正式学术文献条目并补齐元数据。
snapshot-card-button = 一键嗅探并复活为学术论文…
snapshot-revived-badge = 已由网页快照复活
rule-tool-review-duplicates = 重复条目决策
rule-tool-review-duplicates-description = 在同一文库中比较疑似重复条目，选择保留项和字段后合并，或建立关联。
rule-tool-review-duplicates-menu-item = 比较与处理重复条目…
review-source-item = 条目字段
review-source-pdf = PDF 全文缓存
review-source-snapshot-url = 快照 URL 学术指纹
review-source-snapshot-html = 快照 HTML 学术元数据
review-source-snapshot-live = 在线网页学术指纹
review-source-translator = Zotero 标识符转换器
review-snapshot-revived = 已将残缺快照（{ $from }）复活并升级为正式文献（{ $to }）
review-arxiv-mismatch = arXiv 返回的记录或版本与请求不符，已拒绝采纳。
review-no-data = 没有取得含标题的有效元数据。此结果不证明文献不存在。
review-doi-unresolved = 未能将 ShortDOI 解析为完整 DOI，请稍后重试或人工核查。
review-preprint-unpublished = arXiv 当前返回版本为 { $version }，未提供正式发表 DOI；本次没有修改条目。
review-field-itemType = 文献类型
review-field-creators = 作者与创作者
review-identifier = 选择待核验标识符
review-skip = 跳过
review-inspect = 查询并比较
review-cancel = 取消
review-blocked = 返回的标识符或文献类型不一致，已阻止采纳。请核查标识符后重新查询。
review-conflict = 存在差异：{ $fields }。我已核对来源，确认这是同一作品并接受所选修改。
review-action = 处理方式：
review-update = 更新当前条目的所选字段
review-create-related = 新建或关联正式发表条目
review-adopt = 采纳
review-field = 字段
review-before = 当前值
review-after = 来源建议值
review-apply = 应用已选操作
review-unchanged = 可比较字段没有差异。
review-skipped = 没有执行修改。
review-needs-acknowledgement = 有身份差异尚未确认，本条目没有修改。
review-version-required = 正式 DOI 与文献类型须一并采纳，否则不会更新版本。
review-stale = 条目在核对期间已被修改、删除或变为不可编辑。请保存当前编辑并重新检查。
review-invalid-type = 文献类型不适用于本次操作，未修改条目。
review-field-applied = 已采纳字段：{ $field }
review-published-duplicates = 文库中已有多个相同 DOI 的正式版，请先处理重复条目后再建立关联。
review-item-summary = 附件 { $attachments } · 笔记 { $notes } · 标签 { $tags } · 分类 { $collections }
review-duplicate-doi = 匹配依据：同一文库中 DOI 相同。
review-duplicate-title = 匹配依据：规范化标题、年份及首位创作者相同。这只是疑似重复，请核查。
review-duplicate-arxiv = 匹配依据：同一文库中 arXiv 基础标识符相同，版本可能不同。
review-merge-note = 仅确认是同一版本的重复记录后才合并。选择保留条目及各字段来源；附件、批注、笔记、标签、分类和引用重定向交由 Zotero 原生合并处理。每次处理一对，涉及已处理条目的其他候选需重新检查。
review-relate-note = 类型、版本或 DOI 有差异，可能是相关作品。本界面只允许建立关联，保留两条记录。
review-relate = 建立双向关联，保留两条记录
review-merge = 合并为所选保留条目
review-master = 保留条目：
review-keep-master = 使用保留条目的值
review-no-duplicates = 未找到与所选条目匹配的候选。当前依据为 DOI、arXiv 或标题＋年份＋首位创作者，不包含模糊标题检索。
review-no-arxiv = 没有找到 arXiv 标识符，本工具当前只处理 arXiv 到正式发表的版本关联。
review-no-identifier = 没有找到可用 DOI、arXiv 或有效 ISBN。可先索引 PDF，或补充条目标识符后重试。
review-use-command = 请通过 MetaFlow 的“比较与处理重复条目”菜单执行，以启用确认与事务合并流程。
review-result-merged = 已合并
review-result-related = 已建立关联
workflow-missing-doi = DOI 缺失。本地检查不联网推断；可使用“更新元数据”核验并补全。
review-source-title = 标题检索（需匹配核验）
duplicates-mark-not = 标记为不是重复条目
review-result-excluded = 已标记为非重复
review-operation-cancelled = 已停止核对；已完成的操作保留。
review-related-applied = 已建立与正式版条目 { $id } 的关联。

rule-correct-abstract-format =
    .label = 规范化摘要排版
rule-correct-abstract-format-description = 清理多余空白、合并段内断行，并修复独立断行的化学式片段，保留原意与分段。默认启用；开启“新增条目时自动检查并整理”时自动执行。已有条目可通过“检查并修复元数据”批量处理。
rule-correct-abstract-format-menu-field = 规范化摘要排版
