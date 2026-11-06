# Zotero MetaFlow

> **Clean, trustworthy, searchable metadata — for every item in your library.**

_Connect each step of research._

`59 governance rules` · `Offline ISO 4 abbreviations` · `Journal Insights` · `Lossless deduplication` · `arXiv conversion` · `TL;DR takeaways` · `Snapshot reviver` · `Manuscript / SI decoupling`

[简体中文](README.md) · [English](README.en.md)

[![Version](https://img.shields.io/badge/version-16.0.0-245ac7?style=flat-square)](https://github.com/groele/Zotero-MetaFlow/releases/tag/v16.0.0)
[![Zotero Compatibility](https://img.shields.io/badge/Zotero-10.0--12.*-brightgreen?style=flat-square)](https://www.zotero.org/)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-orange?style=flat-square)](LICENSE)
[![Tests Passing](https://img.shields.io/badge/tests-763%20unit%20%7C%2023%20scoped%20e2e-success?style=flat-square)](https://github.com/groele/Zotero-MetaFlow)

[📦 Installation](#installation) · [✨ Key Highlights](#highlights) · [🛠️ Feature Matrix](#features) · [🚀 Quick Start](#quick-start) · [⚙️ Settings Guide](#settings) · [🛡️ Architecture & Safety](#architecture) · [🌐 Compatibility](#compatibility) · [❓ Troubleshooting & FAQ](#troubleshooting) · [🔗 Flow Series](#series) · [📄 Credits & License](#license)

---

## 📖 Vision & Product Overview

In academic research, item metadata imported from web databases (e.g., Web of Science, IEEE Xplore, PubMed, arXiv, Google Scholar) or captured through web translators and DOI lookups is often flawed: all-caps or all-lowercase titles, destroyed chemical formulas and sub/superscripts, reversed author names, absent ISO 4 journal abbreviations, missing Impact Factor / quartile rankings, and clutter from duplicate entries.

**Zotero MetaFlow** (part of the Zotero Flow Series productivity suite) is engineered for scholars who demand rigorous reference quality. Grounded in the **modern Zotero 10 ~ 12 architecture**, it unifies **59 automated metadata governance rules**, an **offline ISO 4 LTWA journal abbreviation engine**, **61 EasyScholar academic ranking indicators**, an exclusive **one-click native bulk deduplication workflow**, **Manuscript vs. Supplementary Information (SI) attachment role decoupling (ZotAssets engine)**, and an all-new **zero-residual-margin collapsible Journal Insights sidebar panel** to maintain an immaculate, insight-rich research library.

> [!NOTE]
> Zotero MetaFlow is fully standalone and can be used on its own or seamlessly combined with other tools in the Zotero Flow Series (such as RefFlow, MindFlow, ViewFlow, etc.).

---

<a id="highlights"></a>

## ✨ Key Highlights

> **Two pipelines, one entry point.** Every reference entering the **Zotero MetaFlow dual-core engine** is routed into two isolated paths: offline governance is **100% network-free**, while online enrichment is **centralized and credential-safe**.

**① Import / Select** → **② Dual-Core Engine** → **③ Pipelines** → **④ Capability Cards**

<sub>① Browser clipping · DOI import · PDF capture · manual selection | ② Single dispatch point, zero cross-talk | ③ Two expandable cards below | ④ Each card maps to an independent toggle; details in sections 1–9</sub>

<details open>
<summary><b>🔒 Pipeline A · Local Offline Governance</b> · Check &amp; Repair · 100% offline / zero network / airplane-mode ready</summary>

<br>

<table>
  <tr>
    <td align="center" width="50%"><br>🧹<br><br><b>59 Governance Rules</b><br><sub>Casing · formulas · authors · pages · DOI</sub><br><br></td>
    <td align="center" width="50%"><br>📚<br><br><b>ISO 4 Abbreviations</b><br><sub>JabRef dataset + offline LTWA stemmer</sub><br><br></td>
  </tr>
  <tr>
    <td align="center"><br>📑<br><br><b>Attachment Decoupling</b><br><sub>Manuscript / SI detection + safe renaming</sub><br><br></td>
    <td align="center"><br>⚡<br><br><b>Native Bulk Deduplication</b><br><sub>One-click lossless merge · smart master choice</sub><br><br></td>
  </tr>
</table>

</details>

<details open>
<summary><b>🌐 Pipeline B · Online Academic Enrichment</b> · Update Metadata · per-feature toggles / centralized / credential-redacted</summary>

<br>

<table>
  <tr>
    <td align="center" width="50%"><br>📊<br><br><b>Journal Insights</b><br><sub>JCR / CAS / IF / CCF / ESI / Nature Index</sub><br><br></td>
    <td align="center" width="50%"><br>📄<br><br><b>arXiv Preprint Conversion</b><br><sub>Published DOI detection · lossless upgrade</sub><br><br></td>
  </tr>
  <tr>
    <td align="center"><br>💡<br><br><b>TL;DR Takeaways</b><br><sub>Semantic Scholar 1–2 sentence summary</sub><br><br></td>
    <td align="center"><br>🌐<br><br><b>Web Snapshot Reviver</b><br><sub>Bare Webpage → structured journal paper</sub><br><br></td>
  </tr>
  <tr>
    <td align="center"><br>🏛️<br><br><b>Official Metadata Calibration</b><br><sub>Crossref multi-source cross-verification</sub><br><br></td>
    <td align="center"><br>🔁<br><br><b>Chained Local Rules</b><br><sub>Sequential handoff · zero cross-contamination</sub><br><br></td>
  </tr>
</table>

</details>

> [!IMPORTANT]
> The two pipelines are **isolated by default**: A never issues a network request; B centralizes every external call, triggers only on explicit user action, and carries credentials through a privileged redacted transport.

### 1. 📊 Holistic Journal Insights (Integrated Sidebar Profile)

- **Instant Academic Standing**: Directly embedded in Zotero's right-hand item pane, presenting journal cover badges, normalized full publication names, and standard ISO 4 abbreviations.
- **Multi-Dimensional Authority Coverage**:
  - **Clarivate JCR Quartiles**: Q1 / Q2 / Q3 / Q4;
  - **CAS Journal Ranking (Upgrade & Classic Editions)**: Major / Minor tier partitions and Top Journal certification;
  - **Academic Impact Metrics**: Impact Factor (IF), 5-Year Impact Factor;
  - **Domain-Specific Tiers**: CCF (China Computer Federation) Ranking (Category A / B / C) & Top Conference badges;
  - **Frontier Indexing**: ESI Global Subject Categorization & Nature Index local recognition.
- **Modern Zero-Residual Collapsible Architecture**:
  - Completely eliminates residual blank space and rogue container paddings when collapsed; folding **achieves true 0px height and zero margin**, smoothly adapting when expanded;
  - Automatically hides when no data is available (Empty-State Self-Healing) and encapsulates a fine-grained Error Boundary to prevent any host rendering disruption.
- **Immediate Item Binding & Lifecycle Guard**:
  - Powered by native `section.item` accessors and `await win.ZoteroPane.itemSelected()` event synchronization, preventing stale item rendering when switching references rapidly.

### 2. 📄 arXiv Preprint-to-Published Workflow

- **Inspired by AllanChain/zotero-arxiv-workflow**: Resolves the ubiquitous academic pattern of depositing preprints on arXiv prior to peer-reviewed publication.
- **Integrated into "Update Metadata" & Sidebar Cards**:
  - Automatically identifies arXiv preprints via `arxiv.org` URLs, `archiveID`, or `arXiv:` prefixes;
  - **Seamless Context Menu Integration**: Integrated directly into "Update Metadata", dynamically activating preprint conversion only when an unconverted preprint is selected;
  - **Sidebar Quick Action**: Displays a dedicated **arXiv Preprint Card** in the right-hand sidebar with direct link navigation and a one-click button: **"⚡ Check & Upgrade to Published Version…"**.
- **Dual Conversion Strategies (Fully Configurable)**:
  - **In-Place Upgrade**: Queries arXiv Atom API & Crossref to extract published DOI and journal details. Upgrades item type to `journalArticle` while **preserving 100% of PDF attachments, annotations, notes, bidirectional relations, and tags**, appending audit provenance in `Extra`;
  - **Create Related Publication**: Keeps the original preprint intact, creates a new published item, and establishes a native bidirectional Zotero relationship.
- **Visual Pedigree Badge**: Converted papers display a green **"arXiv Converted"** badge in the sidebar.

### 3. ⚡ One-Click Native Lossless Bulk Deduplication

- **Native Zotero Ecosystem Integration**: Embeds directly into Zotero's native "Duplicate Items" view with a top-level bulk merge action button.
- **Safe Global Merge Strategy**:
  - **Single Global Authorization**: Merge all duplicate groups across the entire library in one operation without repetitive prompt clicks;
  - **Intelligent Master Item Selection**: Selects master item by oldest date added (default), newest added, most recently modified, or most complete metadata;
  - **Lossless Asset Inheritance**: All attachments (PDFs, snapshots), notes, tags, collection memberships, and relations are safely preserved with native Undo support.
- **Non-Intrusive Progress Feedback**: Monitored via a lightweight native progress notification with cancel support.

### 4. 💡 Semantic Scholar TL;DR Core Takeaways Extraction

- **Inspired by syt2/Zotero-TLDR**: Pulls AI-generated 1-to-2 sentence summary takeaways from Semantic Scholar.
- **Multi-Target Flexible Backfill**:
  - **Independent Child Note (Recommended)**: Automatically creates/updates an elegant child note (`💡 TL;DR Core Takeaway (Semantic Scholar)`);
  - **Extra Field**: Writes `TLDR: ...` for instant list column visibility;
  - **Custom Column "Takeaway (TL;DR)"**: Custom item tree column displays core innovations at a glance with live cache invalidation;
  - **Sidebar Highlight Card**: Immersive card in the Journal Insights sidebar allows instant reading without opening notes.

### 5. 🌐 Web Snapshot & Blog Reviver

- **Inspired by Snapshot Reviver & metadata-hunter**: Converts bare "Webpage" items created by browser clipping into fully structured academic papers.
- **Three-Tier Cascade Fingerprint Discovery**:
  - Scans URL patterns for direct DOIs, Nature/Nature News paths, arXiv IDs, and PubMed PMIDs;
  - Analyzes attached HTML `<head>` meta tags (`citation_doi`, `dc.identifier.doi`, etc.);
  - Resolves metadata via Crossref and Semantic Scholar, upgrading the item type and populating authors, dates, journal, volume, issue, and pages.

### 6. 📑 Manuscript vs. Supplementary Information (SI) Decoupling (ZotAssets Engine)

- **Solves Top-Journal Multi-Attachment Clutter**:
  - Top papers (_Nature_, _Science_, _Cell_, _JACS_) store critical experimental procedures and spectra in multi-page Supplementary Information (SI) files, often downloaded with cryptic filenames;
  - Automatically classifies attachments using publisher naming heuristics, PDF first-page structure inspection, and item metadata matching.
- **Cross-Platform Safe Renaming**:
  - Renames files using customizable templates (e.g., `{author}_{year}_{title}_{role}`) while stripping illegal filesystem characters and Windows reserved names;
  - Automatically synchronizes attachment titles in the item tree to `[Main] Paper Title` and `[Supplementary 1] Paper Title`.
- **100% Offline & Network-Independent**:
  - Runs entirely on local heuristic engines with zero network requests.

### 7. 🧹 59-Rule Comprehensive Metadata Cleaning Pipeline

- **Title Formatting**: Sentence case / Title Case conversion, chemical formula subscript preservation ($\text{CO}_2$, $\text{MoS}_2$), gene symbols and proper noun protection.
- **Abstract Cleanup**: Removes soft breaks and paragraph splits while joining broken hyphenated words and scientific notations.
- **Author Normalization**: Inverts reversed names, cleans invalid pinyin tone marks, and standardizes corporate author fields.
- **Identifier Sanitation**: Extracts clean DOIs, expands ShortDOIs, normalizes publication dates to ISO 8601, and standardizes page ranges with publication En-dashes (`–`).

### 8. 📚 Authoritative Journal Abbreviations & Offline ISO 4 Engine

- **Dual-Engine Precision**: Matches JabRef's curated dataset and infers ISO 4 abbreviations offline using the international LTWA dictionary.
- **Zero Network Required**: Standardizes journal names and abbreviations even in airplane mode.

### 9. ✍️ Rich-Text Title Toolbar

- Embedded helper above title input fields provides one-click insertion of `<i>` (italics), `<b>` (bold), `<sub>` (subscript), `<sup>` (superscript), and `<span class="nocase">` (case protection) tags.

---

<a id="features"></a>

## 🛠️ Feature Matrix

| Feature Module                        | Capabilities                                                             | Core Problem Solved                                           | Access Location                                  |
| ------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------ |
| **Journal Insights**                  | JCR Quartiles, CAS Partitions, IF, CCF, Nature Index, ESI                | Instant academic standing without leaving Zotero              | Sidebar · Journal Insights Panel                 |
| **arXiv Preprint Conversion**         | Discovers published DOI, upgrades item type, preserves notes/annotations | Outdated preprints losing annotations during manual re-import | Sidebar arXiv Card / "Update Metadata"           |
| **TL;DR Takeaways**                   | Extracts Semantic Scholar 1-2 sentence core contribution summaries       | Digesting core paper innovations quickly in large libraries   | "Update Metadata" / Sidebar Card / Custom Column |
| **Web Snapshot Reviver**              | Deeply inspects URLs and HTML heads to convert bare webpages into papers | Rescues incomplete clipped bookmarks and web items            | "Update Metadata" (Toggleable in Settings)       |
| **Native Bulk Deduplication**         | Global merge, master item heuristics, lossless asset inheritance         | Eliminates manual entry-by-entry duplicate resolution         | "Duplicate Items" Collection · Top Header Button |
| **Title Formatting**                  | Sentence case / Title Case, protects chemical formulas and symbols       | Inconsistent title formats across databases                   | Item Context Menu / Auto-clean on Import         |
| **Abstract Cleanup**                  | Cleans soft line breaks, spaces, and broken chemical equations           | Fixes messy abstracts extracted from PDFs                     | Item Context Menu / Pipeline                     |
| **Author Normalization**              | Resolves reversed name orders, strips invalid pinyin symbols             | Prevents citation generation errors (e.g., "San, Zhang")      | Context Menu · Check & Repair Metadata           |
| **Journal Abbreviations**             | JabRef dataset matching + ISO 4 offline LTWA inference                   | Complies with diverse journal submission citation standards   | Context Menu · Journal Formatting                |
| **Identifier Normalization**          | Extracts clean DOIs, resolves ShortDOIs, validates ISSNs                 | Fixes broken DOI URLs and citation link failures              | Context Menu · Standardize Identifiers           |
| **Attachment Decoupling (ZotAssets)** | Classifies Manuscript vs SI, cleans filenames, tags item tree            | Untangles multi-PDF downloads from top-tier journals          | Context Menu · Decouple Attachments / Pipeline   |

---

<a id="quick-start"></a>

## 🚀 Quick Start Guide

### 1. View Instant Journal Rankings

Select any journal article in your library. The right-hand sidebar immediately renders the **Zotero MetaFlow Journal Insights** panel with JCR/CAS partitions, impact factor, and CCF rankings.

### 2. Clean & Normalize References (100% Offline)

Select one or multiple references, right-click, and choose **Zotero MetaFlow ➔ Check & Repair Metadata**. Titles, formulas, authors, DOIs, and page ranges are standardized instantly without issuing a single network request.

### 3. Bulk Merge Duplicate Entries

Navigate to the native **Duplicate Items** collection in the left-hand library tree. Click **"Merge All Duplicate Groups"** in the top right to safely consolidate duplicates while preserving all notes and attachments.

### 4. Upgrade arXiv Preprints to Published Papers

Select an arXiv preprint item. In the sidebar's **arXiv Preprint Card**, click **"⚡ Check & Upgrade to Published Version…"** to detect the official publication DOI and upgrade the reference seamlessly.

### 5. Fetch AI Takeaways (TL;DR)

Right-click an item and select **Zotero MetaFlow ➔ Update Metadata**. MetaFlow queries Semantic Scholar for core takeaways and saves them to a structured child note and custom column.

### 6. Decouple Manuscript & Supplementary Attachments

Right-click a paper with multiple PDFs and select **Zotero MetaFlow ➔ Decouple Manuscript & SI Attachments**. MetaFlow inspects the files, assigns safe filenames, and labels them in the item tree as `[Main]` and `[Supplementary 1]`.

---

<a id="settings"></a>

## ⚙️ Settings Overview

Open **Edit ➔ Settings** (or **Zotero ➔ Settings** on macOS) and navigate to the **Zotero MetaFlow** pane. Adhering to the **First-Card-Only Disclosure Iron Rule**, the panel cleanly organizes options into 11 collapsible sections with only the first section opened by default:

1. **General & Automation**: Auto-linting on new items (`lint.onAdded`), group library write guard, import delay buffers, and concurrent task limits.
2. **Core Workflows (Dual-Core Decoupling)**:
   - **Pipeline A (Check & Repair)**: 100% offline rule toggles and execution steps;
   - **Pipeline B (Update Metadata)**: Centralized toggles for Crossref verification, arXiv conversion, snapshot revival, TL;DR extraction, and EasyScholar metrics;
   - **Context Menu Visibility**: Customize placement for all 33 commands across top-level and submenu slots.
3. **Detailed Rule Categories (7 Collapsible Cards)**:
   - Items & Attachments (ZotAssets settings, PDF renaming template);
   - Languages, Titles, Authors, Identifiers, Journals/Conferences, and Page Ranges.
4. **On-Demand Tools**: Quick triggers for swap author names, book title marks, clearing extra fields, and manual index lookups.
5. **Duplicate Governance**: Default actions (`cancel`/`keep`/`discard`), master item selection rules, cross-type protection, and persistent whitelist management.
6. **Journal Rankings & EasyScholar**: Credential input with redacted privacy, 61 metric field toggles, and column exports.
7. **Data Policies & Shortcuts**: Offline ESI/Nature Index paths, cache quotas, and rich-text toolbar shortcut keybindings.

---

<a id="architecture"></a>

## 🛡️ Modern Architecture & Safety Guarantees (v16.0.0)

1. **Modular Coordinator & 360-Line Ceiling**:
   - Replaced monolithic coordinator with a strict four-layer inheritance chain:
     $$\text{RunnerState} \longrightarrow \text{RuleExecution} \longrightarrow \text{BatchPersistence} \longrightarrow \text{LintRunner}$$
   - Verified by automated tests against method shadowing and physical line limits ($\le 360$ lines).
2. **Privileged Anonymous Credential Transport (`credential-request.ts`)**:
   - Requests carrying API keys/tokens bypass standard host HTTP loggers to prevent credential leaks, featuring 15s timeout bounds and query redaction.
3. **Read-Only & Trash Guard (`item-write-policy.ts`)**:
   - Enforces `item.isEditable()` and verifies item status before persistence and after async operations, safeguarding read-only group libraries and trashed items.
4. **Detached Window DOM Traversal (`getAllItemDocuments`)**:
   - Enumerates active windows across detached PDF reader tabs using Gecko's `Services.wm.getEnumerator("")`.
5. **Web Components Standards & Symmetrical Labeling**:
   - Custom item pane rows feature triple-layer symmetrical attributes (`.meta-row-[field]`, `.meta-label-[field]`, `.meta-value-[field]`) with automatic Dark Theme and High-Contrast inheritance.

---

<a id="installation"></a>

## 📦 Installation & Auto-Update

### Manual Installation

1. Download the latest release package **[zotero-metaflow.xpi](https://github.com/groele/Zotero-MetaFlow/releases/download/v16.0.0/zotero-metaflow.xpi)** from [GitHub Releases](https://github.com/groele/Zotero-MetaFlow/releases).
2. In Zotero, navigate to **Tools ➔ Plugins** (or **Tools ➔ Add-ons**).
3. Click the gear icon ⚙️ in the upper-right corner and choose **Install Add-on From File...**.
4. Select the downloaded `.xpi` file, confirm the installation, and restart Zotero.

### Automatic Updates

The extension includes configured update manifests ([dist/update.json](https://github.com/groele/Zotero-MetaFlow/blob/main/dist/update.json)). Zotero will automatically notify you when subsequent releases become available.

---

<a id="compatibility"></a>

## 🌐 Compatibility & Environment

| Environment           | Supported Range                                                          | Description                                                       |
| --------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| **Zotero Host**       | **Zotero 10.0 ～ 12.*** (Gecko 153+ / Firefox 140)                       | Developed on Zotero 10, forward-compatible through Zotero 11 & 12 |
| **Operating Systems** | Windows 10/11, macOS (Intel & Apple Silicon), Linux                      | Cross-platform native performance and filesystem safety           |
| **Test Coverage**     | **763 Unit Tests + 23 Scoped Native Settings/Package Tests** (100% Pass) | Verified against live Zotero runtime and SQLite transactions      |
| **Plugin Version**    | **v16.0.0**                                                              | [View v16.0.0 Release Notes](docs/releases/metaflow-v16.0.0.md)   |

---

<a id="troubleshooting"></a>

## ❓ Troubleshooting & FAQ

<details>
<summary><b>Q1: Why aren't journal metrics appearing in the sidebar?</b></summary>
Ensure the article has a valid "Publication" or "DOI". For online rankings (CAS, CCF, JCR), check that your EasyScholar Secret Key is configured under Settings ➔ Zotero MetaFlow ➔ Academic Indicators. Nature Index and ESI metrics resolve offline against built-in datasets.
</details>

<details>
<summary><b>Q2: Will bulk merging duplicates delete my notes or PDFs?</b></summary>
No. Merging delegates to Zotero's native transactional merge engine. All notes, tags, attachments, and collections from secondary entries are transferred to the primary item, with native Undo support.
</details>

<details>
<summary><b>Q3: Why didn't a chemical formula get lowercased during sentence casing?</b></summary>
MetaFlow includes a built-in scientific dictionary protecting formulas ($\text{CO}_2$, $\text{MoS}_2$, $\text{mRNA}$, $\text{pH}$) and gene symbols from destructive casing conversions.
</details>

---

<a id="series"></a>

## 🔗 Zotero Flow Series

Zotero MetaFlow is part of the **Zotero Flow Series** academic productivity suite:

| Plugin                                                             | Role & Scope                                                 | Synergistic Workflow                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| [**Zotero MetaFlow**](https://github.com/groele/Zotero-MetaFlow)   | **Metadata Cleaning · Journal Insights · Deduplication**     | First station for newly imported references                  |
| [**Zotero RefFlow**](https://github.com/groele/Zotero-RefFlow)     | **Citation Discovery · Reference Parsing · Quick Import**    | Explore citation graphs and import directly into MetaFlow    |
| [**Zotero ViewFlow**](https://github.com/groele/Zotero-ViewFlow)   | **Reading Sidebar Preview · Formatted Citations**            | Preview references while reading PDFs                        |
| [**Zotero MindFlow**](https://github.com/groele/Zotero-MindFlow)   | **Knowledge Graph · Outlining · Literature Mindmaps**        | Map clean references into structured visual knowledge graphs |
| [**Zotero TaskFlow**](https://github.com/groele/Zotero-TaskFlow)   | **Reading Progress · Kanban · Research Schedules**           | Track reading task completion and milestones                 |
| [**Zotero CiteFlow**](https://github.com/groele/Zotero-CiteFlow)   | **Citation Tracing · Word Integration · Reference Matching** | Connect writing documents directly to your Zotero library    |
| [**Zotero PaperFlow**](https://github.com/groele/Zotero-PaperFlow) | **Manuscript Submissions · Peer Review Archive · Versions**  | Manage manuscript revisions and referee response letters     |

---

<a id="license"></a>

## 📄 Credits & License

### Upstream Inspiration & Acknowledgments

- **[northword/zotero-format-metadata](https://github.com/northword/zotero-format-metadata)** (by @northword): Foundational rule engine and linter pipeline.
- **[zoushucai/zotero-journalabbr](https://github.com/zoushucai/zotero-journalabbr)** (by @zoushucai): Journal abbreviation datasets and mappings.
- **[redleafnew/zotero-updateifsE](https://github.com/redleafnew/zotero-updateifsE)** (by @redleafnew): EasyScholar integration and metric card design.
- **[ChenglongMa/zoplicate](https://github.com/ChenglongMa/zoplicate)** (by @ChenglongMa): Duplicate grouping algorithms and merge workflows.
- **[AllanChain/zotero-arxiv-workflow](https://github.com/AllanChain/zotero-arxiv-workflow)** (by @AllanChain): Preprint-to-published conversion logic.
- **[syt2/Zotero-TLDR](https://github.com/syt2/Zotero-TLDR)** (by @syt2): Semantic Scholar AI summary extraction.
- **[Lyz-623/ZotAssets](https://github.com/Lyz-623/ZotAssets)** (by @Lyz-623): Manuscript vs. SI attachment role decoupling and safe file naming.
- **[JabRef](https://github.com/JabRef/abbrv.jabref.org)** & **[abbreviso](https://github.com/marcocorvi/abbreviso)**: ISO 4 LTWA abbreviation datasets and stemmers.

### License & Disclaimer

- **License**: Distributed under the **[AGPL-3.0-or-later](LICENSE)** license.
- **Disclaimer**: Zotero is a trademark of the Corporation for Digital Scholarship. This project is independently developed and maintained.
