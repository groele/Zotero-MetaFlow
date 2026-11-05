Version 10.2.3 applies the supplied layered origami wings branding to all plugin brand surfaces and native menus. See the [icon update guide](brand-icons-10.2.3.md).

Version 10.2.2 adds a hidden menu location, keeps detailed reports closed by default with an on-demand viewer, fixes access-date comparison, and adds consistent padding to detailed-rule cards. See the [quiet settings guide](quiet-settings-10.2.2.md).

Version 10.2.1 verifies all journal-ranking field controls, adds conference ranking display, and synchronizes automatic lookup outcomes into the journal pane. See the [journal settings audit](journal-options-audit-10.2.1.md).

# Features and Rules

Version 10.2.0 uses consistent collapsible settings cards, configurable top-level context-menu placement, and a combined checking workflow. Journal rankings appear in the item-pane journal section without a query report popup. The plugin search and section-jump controls have been removed. See the [settings and workflow guide](unified-settings-workflow-10.2.0.md).

This page outlines the rules supported (or planned) by this plugin. The purpose is to ensure the **existence, correctness, and accuracy** of all items and fields in a Zotero library.

Formatting rules apply direct fixes. Ambiguous field-misuse and free-text placeholder findings are reported for review while preserving the original values.

⚠️ Please note: due to technical limitations, the plugin can never fully replace human review. After automatic corrections, you should still carefully check each field for accuracy.

## Item-Level Rules

### No Duplicate Items (`no-item-duplication`)

Warns with a popup when an imported item duplicates an existing one in the library.

### Correct Item Type (`no-article-webpage`, `no-journal-preprint`)

- If an item is imported as `Webpage` but the URL points to a major journal publisher, it is likely that the Zotero Connector was not ready and misclassified the item. A warning popup is shown.
- If the item type is `journalArticle` but the URL or DOI identifies it as a supported preprint, the rule reports it and offers an action to try updating its metadata. Review any suggested item-type change before applying it.

_Todo:_ Automatically resolve identifiers from URLs and enforce metadata updates.

## Title Rules

### Require Title (`require-title`) _(planned)_

If the title is missing, try to retrieve it via DOI. Otherwise, show an error.

### Correct Sentence Case (`correct-title-sentence-case`, `correct-shortTitle-sentence-case`)

Zotero recommends storing titles in **Sentence case**, which makes it easier for CSL styles to apply “Title Case” transformations [^sentenceCase].

Zotero 7 has built-in sentence casing with exceptions, but this plugin extends it with better handling for chemical formulas, country names, and proper nouns.

[^sentenceCase]: <https://www.zotero.org/support/kb/sentence_casing>

### Rich Text in Titles

Zotero’s bibliography rich text requires raw HTML tags (see [^rich_text_bibliography]), which is not user-friendly. While Zotero has promised visual rich text editing, it has not materialized after years.

This plugin provides a toolbar and shortcuts to insert tags for **superscript, subscript, bold, italics, and nocase** formatting.

[^rich_text_bibliography]: <https://www.zotero.org/support/kb/rich_text_bibliography>

- **Shortcuts**
  - Superscript: `Ctrl` + `Shift` + `=`
  - Subscript: `Ctrl` + `=`
  - Bold: `Ctrl` + `B`
  - Italic: `Ctrl` + `I`
  - Nocase: `Ctrl` + `N`
  - Format chemical formulas for selected library items: `Ctrl` + `Alt` + `S`
  - Zotero MetaFlow: Check and Fix Metadata for selected library items: `Ctrl` + `Alt` + `L`

Shortcuts are configurable, can be disabled or reset, and reject duplicate bindings. Rich text shortcuts only act on title selections. On macOS, use Cmd and Option instead of Ctrl and Alt.

- **Toolbar**
  A floating toolbar appears when editing the title field. It can be disabled in preferences.

- **Preview**
  A preview of the title rich text is available when editing the title field.

### `correct-title-chemical-formula`

Automatically corrects chemical formulae in titles. Supports Charge Number (e.g. `Co2+` -> `Co<sup>2+</sup>`) and Stoichiometric Number (e.g. `Cu2O` → `Cu<sub>2</sub>O`)

Enable the rule in the Title preferences to include it in standard and automatic metadata checks. The rule is disabled by default; context menus and the dedicated shortcut can invoke it independently. Space repair has its own option. Existing scripts and nocase content are preserved. Formula formatting precedes short-title generation. See the [metadata workflow guide](metadata-workflow-zh.md) for the processing order and recognition limits.

## Author Rules

### Require Authors (`require-creators`)

Reports missing creators for regular items. This check does not retrieve author names automatically; use the metadata update tool or enter them manually.

### Correct Author Case (`correct-creators-case`)

Ensures that author names use **capitalized words**.

### Correct Full Author Names (`correct-creators-full`) _(planned)_

- If initials or abbreviations are found, query full names.
- For Chinese names, hyphenated pinyin (e.g., `Zhang Jian-Bei`) is supported, but an option can remove hyphens.
- For abbreviated names with `.` (e.g., `J.`), attempt to expand to full names.

### Correct Chinese Name Pinyin (`correct-creators-pinyin`)

Converts names such as `Zhang Jianbei` → `Zhang Jian Bei`.

This helps generate correct CSL abbreviations (`Zhang J. B.`).

## Language Rules

### Require Language (`require-language`)

CSL styles rely on the language field for localization (e.g., mixing _et al._ with“等”).
This rule infers language from the title and fills in the `language` field automatically.

By default, only **Simplified Chinese** and **English** are detected. You can disable the restriction or add other [ISO 639-1 codes].

[ISO 639-1 codes]: https://github.com/komodojp/tinyld/blob/develop/docs/langs.md

## Journal Rules

### Correct Journal Title (`correct-publication-title-alias`, `correct-publication-title-case`)

1. Unifies journal names to their official form.

   For example, `Applied Catalysis B-environmental` → `Applied Catalysis B: Environmental`.

2. Converts all-uppercase journal names to **capitalized words**, while keeping special words (e.g., acronyms) uppercase.

### Require ISO4 Abbreviation (`require-journal-abbr`)

Uses a built-in dataset (JabRef + Woodward Library) to look up journal abbreviations.

- If missing, infers abbreviation from the [ISSN LTWA list](https://www.issn.org/services/online-services/access-to-the-ltwa/).
- If still missing, defaults to full journal title (can be disabled).
- Abbreviations can retain or remove periods in settings.

### Independent ESI Discipline Insights (`tool-query-esi`)

Displays the journal's Essential Science Indicators (ESI) discipline in a dedicated Zotero MetaFlow item-pane section and list column. No item fields or tags are written.

- **Matching**: Matches journal items by print ISSN, electronic eISSN, full publication title, and abbreviation.
- **Customizable Format**: Supports formatting templates using `{subject}` (e.g., `物理学`), `{category}` (e.g., `PHYSICS`), and `{en}` (e.g., `Physics`). Default: `{subject}ESI`.
- **Custom Dataset**: Built-in support for all 22 ESI disciplines in the Clarivate 2026 Release 6 dataset, with the option to load custom datasets (JSON or CSV).
- **Preservation**: All existing fields and tags remain unchanged. Invalid custom data produces a warning and falls back to bundled data. Nature Index membership is also shown independently and does not imply article-level inclusion.

### EasyScholar Journal Rankings (`tool-update-easyscholar`)

Looks up journal or conference rankings with the EasyScholar Open API and saves selected results either to MetaFlow's local journal ranking index or, when enabled in preferences, to the item's Extra field.

- **Connection**: Store an API key in MetaFlow preferences, open EasyScholar's API documentation, or test the key from the preferences page.
- **Field selection**: Independently enable JCR/CAS and NewSharp rankings, impact factors, index/rating systems, university rankings, and supported EasyScholar custom datasets. The original 23 fields remain enabled by default; additional ranking, university, and custom-dataset fields are opt-in. Custom results are returned only when the dataset is enabled in the user's EasyScholar account.
- **Item-list columns**: Select which saved EasyScholar fields are registered as Zotero item-list columns. The columns read Extra and the local MetaFlow index and do not trigger network requests.
- **Automation and shortcut**: An optional setting queries journal articles and conference papers when new items are added; it is off by default and follows MetaFlow's existing automatic-added-item setting. The EasyScholar command also has an editable shortcut, defaulting to Ctrl+J on Windows/Linux and Cmd+J on macOS.
- **Storage**: By default, selected results are saved in `metaflow-journal-rankings-v1.json` in the Zotero profile and matched by ISSN, then normalized journal title. The “Also write to Extra” switch is off by default; when on, selected values are merged into Extra while unrelated text is preserved. Existing Extra values remain readable either way. The local index does not sync with Zotero libraries or other profiles.
- **Preservation**: Blank-only updates respect values already present in either storage. Overwrite mode updates only selected fields; unrelated Extra text and unselected local-index values are preserved. An explicit negative membership response removes the old positive marker in the chosen destination.
- **Privacy**: Queries run only when the user invokes the EasyScholar action, tests the connection, or explicitly enables automatic lookup for newly added journal/conference items.

### No Leading Zeros (`no-issue-extra-zeros`, `no-pages-extra-zeros`, `no-volume-extra-zeros`)

Removes leading zeros from issue, pages, and volume fields.

Example: `02-10` → `2-10`.

### Correct Page Connector (`correct-pages-connector`)

Replaces invalid connectors like `~` or `+` with `-` or `,`.

### Correct Page Range (`correct-pages-range`)

Pages should include both starting and ending page numbers, not just the starting page number.

This rule uses the PDF's indexed page count to complete a 1–3 digit positive starting page. It skips blank pages, article identifiers, decimals and existing ranges. The PDF must have a valid positive page count.

## Thesis Rules

### Require University Place (`require-university-place`)

For `thesis` items, fills in the university’s location automatically (based on built-in data).

This is GB/T 7714-2015 formatting requirements [^gb7714].

[^gb7714]: <http://www.cessp.org.cn/a258.html>

### Correct Thesis Type (`correct-thesis-type`)

Ensures full dissertation type names are set: `硕士学位论文`, `博士学位论文`, `Master thesis`, or `Doctoral dissertation`.

### Correct University Punctuation (`correct-university-punctuation`)

Normalizes university names.

For example, in Chinese entries, replaces half-width parentheses `()` with full-width ones `（）`.

## Book Rules

### Correct Edition/Volume Numeral (`correct-edition-numeral`)

Automatically normalizes the `edition` and `volume` field for books:

- Converts English ordinal words, numeric ordinals, Roman numerals, and Chinese ordinals to numbers.
- Converts incomplete names to full forms (`修订` → `修订版`, `Revised` → `Revised Edition`).
- Removes trailing `"ed."` or `"edition"`.

**Example**:

| Original        | Normalized |
| --------------- | ---------- |
| `first edition` | `1`        |
| `2nd ed.`       | `2`        |
| `III`           | `3`        |
| `第一版`        | `1`        |
| `修订`          | `修订版`   |

## Identifier Rules

### Require DOI (`require-doi`)

For `journalArticle`, DOI must exist.

If missing, attempt to retrieve it.

### No DOI Prefix (`no-doi-prefix`)

Removes URL prefixes like `https://doi.org/` and stores only the DOI string.

### Correct DOI to long form (`correct-doi-long`)

If DOI is short form (e.g. `10/p6kd`), converts it to long form (e.g. `10.1016/j.fuel.2022.126104`).

### Tool: Get Short DOI (`tool-get-short-doi`)

Retrieves short DOI from the DOI, and stores it in the `extra.short-doi` field.

## Other Field Rules

### Correct Date Format (`correct-date-format`)

Ensures ISO format: `YYYY-MM-DD`.

Example: `2023-01-01`.

## Metadata Update Tool (`tool-update-metadata`)

The Green Frog integration also provides opt-in automatic blank-field updates, author annotation and name-swap tools, literal title/journal replacements, directory commands, and optional supplemental journal sources. CNKI title search and its Chinese impact-factor proxy were removed in MetaFlow 14.0.0. See the [integration and validation record](greenfrog-integration-2026-10-16.md) for historical source boundaries and migration behavior.

The two core commands use one identity-validation pipeline and apply accepted metadata without confirmation or field-review windows. Update Metadata follows blank-only or overwrite mode; Check and Repair fills blanks. Explicit identifiers can be resolved directly; PDF and title candidates require independent local evidence. Missing year/creator evidence skips title fallback before any request. Ambiguous results preserve local values and record a reason.

The author switch applies to manual updates, automatic import enrichment and related publication creation. Automatic import fills blanks, does not scan PDFs or change item types, and uses title fallback only when existing year or author evidence can corroborate it. Optional arXiv publication lookup preserves the preprint and creates or reuses a related published item.

Repeated identifiers share in-flight results, including failures, within a command. A new command can retry failures. Provider preparation uses at most four workers and respects the configured batch concurrency and service throttles. Core workflows serialize complete operations; stopping a queued command does not cancel unrelated active work.

All standard rules use the shared batch save boundary. Failed rules roll back their own writes while healthy rules continue. Duplicate merges use Zotero's native transaction boundary. Bulk candidate storage preserves matching and mergeable connected groups without enumerating every dense-group pair; each donor is checked against its reviewed snapshot again before merging. Reports expose saved field changes and JSON export. See the [workflow guide](metadata-workflow-zh.md) and the [current readiness ledger](commercial-readiness-2026-10-18.md).
