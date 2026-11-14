# Third-party software, upstream provenance, and license review

This document accompanies [LICENSE](LICENSE), the **verbatim upstream [NOTICE](NOTICE)** and [CHANGES_FROM_UPSTREAM.md](CHANGES_FROM_UPSTREAM.md). It is a provenance register, not a blanket assertion that every embedded asset has been audited.

## Core derivative work
- **Linter for Zotero / zotero-format-metadata**, © 2023–2026 northword and contributors, https://github.com/northword/zotero-format-metadata — **AGPL-3.0-or-later**. MetaFlow's README states that this project originated as a derivative of this plugin. Retain upstream author attribution, applicable source headers, license, and original NOTICE. Modifications and independent contributions are described separately in CHANGES_FROM_UPSTREAM.md.
- MetaFlow as a combined derivative is declared **AGPL-3.0-or-later** in package.json. Original licensors retain their respective copyrights.

## Direct runtime dependencies declared in package.json
These names and version *ranges* were read from the MetaFlow package manifest on 2026-11-14; ranges are not necessarily the versions resolved for a particular release. Record exact versions, actual bundled status and the verified license text at build time using the lockfile and XPI contents.

| Package | Manifest requirement | License/status |
| --- | --- | --- |
| csvtojson | ^2.0.14 | MIT; verify resolved package's LICENSE |
| es-toolkit | ^1.52.0 | MIT; verify resolved package's LICENSE |
| p-throttle | ^8.1.0 | MIT; verify resolved package's LICENSE |
| quote-quote | ^1.4.0 | MIT; verify resolved package's LICENSE |
| tiny-pinyin | ^1.3.2 | MIT; verify resolved package's LICENSE |
| tinyld | ^1.3.4 | MIT; verify resolved package's LICENSE |
| zotero-plugin-toolkit | ^5.2.0 | MIT; verify resolved package's LICENSE |

The original upstream NOTICE also lists **abbrevIso** and **iso-locales** as dependencies of the upstream bundle. They are preserved in that historical notice, **not asserted here to be bundled in the current MetaFlow XPI**.

## Additional upstream projects and data sources named in README
The README credits the following projects for ideas, workflows or possible integrated functionality:
- zoushucai/zotero-journalabbr
- redleafnew/zotero-updateifsE
- ChenglongMa/zoplicate
- RoadToDream/ZotMeta
- bwiernik/zotero-shortdoi
- AllanChain/zotero-arxiv-workflow
- syt2/Zotero-TLDR
- Lyz-623/ZotAssets
- windingwind/zotero-plugin-template and zotero-plugin-toolkit
- northword/zotero-plugin-scaffold
- JabRef/abbrv.jabref.org, marcocorvi/abbreviso, ISO 639-3 mappings and university lists.

**Open verification:** determine separately for each named source whether MetaFlow (a) used an idea/API only, (b) copied/adapted source code, (c) bundled data, icons, fonts, translations or other assets, or (d) contains no identifiable material from the source. Inspect file-level provenance and each source's exact license/version before release. Acknowledgement alone does not satisfy license obligations for copied material. Do not imply all sources are covered by AGPL.

## External services
EasyScholar, Nature Index, Clarivate/JCR, Crossref, Semantic Scholar and DOI services are described as external data/service providers, **not** as software licensed for redistribution. Respect service terms, trademarks, API quotas, data permissions and attribution as applicable. Do not bundle proprietary journal ranking databases without permission.

## Release compliance checklist (not yet independently verified)
- [ ] Inventory every XPI file, vendored script, font, SVG, bundled dictionary and dataset, retaining exact source/version, license and attribution.
- [ ] Reconcile lockfile-resolved production dependencies with XPI; include required license/copyright notices for distributed copies.
- [ ] Preserve upstream copyright/SPDX headers and NOTICE where applicable; do not replace attribution with a sole groele copyright.
- [ ] Supply complete corresponding source for each distributed XPI version, including build/install instructions, consistent with AGPL obligations.
- [ ] Identify modified upstream files and significant changes in commit history or a maintained change register.
- [ ] Verify any imported data sets and journal abbreviation dictionaries separately for rights of redistribution.
- [ ] Ensure download/update endpoints still provide recipients the applicable licensing and source information.
- [ ] Re-run checks when dependencies, data files or bundles change.

This file documents known provenance and outstanding checks; it is not a legal certification.
