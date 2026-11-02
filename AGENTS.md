# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Overview

"Zotero MetaFlow" (package name `zotero-metaflow`, add-on ID `metaflow@groele`) is a Zotero plugin that validates and formats item metadata. It is built on the [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) and [zotero-plugin-scaffold](https://github.com/northword/zotero-plugin-scaffold) toolchain, and bundled with esbuild into an ESM script loaded by Zotero (a Firefox/Gecko `firefox140` runtime — not Node).

Target: Developed and perfected based on Zotero 10, forward-looking for future versions and upcoming platform features, with declared compatibility across Zotero 10.0-12.* (`strict_min_version: "10.0"`, `strict_max_version: "12.*"`). Build output targets Firefox 140 / Gecko 153 modern architecture. Package manager: **pnpm** (12.3.4, pinned in package.json). Node v22+ required for development.

## Repository source of truth

The maintained MetaFlow source is the repository root, on local `main` tracking `origin/main`. `.scaffold/` contains ignored build and test artifacts, not another maintained checkout. The historical workspace and nested publishing worktree were compared, their useful HTTP regression tests were retained, and the old workspace was archived outside the project. GitHub keeps only `main` after integration and cleanup; remove temporary development branches when their useful changes are integrated. See [`docs/repository-mainline.md`](docs/repository-mainline.md) and [`docs/workspace-consolidation-2026-10-19.md`](docs/workspace-consolidation-2026-10-19.md) for the source layout and comparison evidence.

Zotero 11 / Firefox 153 migration work is tracked in `docs/zotero11-compatibility.md`. The manifest and update metadata use `strict_max_version: 12.*` as requested. Zotero 11 and 12 compatibility is covered in development and build configurations; rerun isolated tests after host changes. Internal `metaref` resources, `Zotero.MetaRef`, and `extensions.zotero.metaref` preferences are retained for settings continuity. Set `METAREF_TEST_PLATFORM=153` or `140` to assert the runtime platform during isolated E2E tests.

## Commands

```bash
pnpm install              # install deps (also installs husky via prepare)
cp .env.example .env      # then set ZOTERO_PLUGIN_ZOTERO_BIN_PATH / ZOTERO_PLUGIN_PROFILE_PATH

pnpm start                # zotero-plugin serve — build + launch Zotero with hot reload
pnpm build                # zotero-plugin build + tsc --noEmit; output in .scaffold/build/
pnpm lint:check           # eslint . && autocorrect --lint
pnpm lint:fix            # eslint . --fix && autocorrect --fix

pnpm test                 # unit (vitest) then e2e (zotero-plugin test)
pnpm test:unit            # Run vitest unit tests (files matching **/*.test.ts)
pnpm test:e2e             # Build production XPI, run live Zotero tests, then install and validate the XPI
pnpm coverage             # vitest run --coverage (covers src/modules/rules/*.ts)

pnpm update-data          # refresh built-in journal-abbr / related data (git submodule + Python)
pnpm release              # zotero-plugin release (version bump + GitHub release in CI)
```

Run a single unit test: `pnpm exec vitest run src/modules/rules/no-extra-zeros.test.ts` (or `vitest -t "<test name>"`).

Before running `pnpm start`, copy `.env.example` to `.env` and set `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` and `ZOTERO_PLUGIN_PROFILE_PATH`. On Windows escape path separators with `\\`.

Two test tiers exist because plugin code depends on the Zotero global runtime:

- **Unit tests** (`*.test.ts`, vitest) — for pure logic that does not touch the `Zotero` global (e.g. string/pinyin/numeral helpers).
- **E2E tests** (`test/tests/*.spec.ts`, mocha+chai driven by `zotero-plugin test`) — run inside a live Zotero.

## Architecture

### Lifecycle: Bootstrap → sandbox globals → hooks

1. `addon/bootstrap.js` is the XPCOM bootstrap. On startup it loads the bundled script `content/scripts/metaref.js` (from `src/index.ts` via esbuild) into a sandbox `ctx` that also acts as `_globalThis`.
2. `src/index.ts` bootstraps globals (`Zotero`, `ztoolkit`, `addon`) and instantiates the `Addon` class (`src/addon.ts`), which holds shared `data` and the singleton `LintRunner`.
3. `src/hooks.ts` implements Zotero lifecycle hooks (`onStartup`, `onMainWindowLoad`, `onNotify`, `onShortcuts`, `onLintInBatch`, etc.). `onNotify` auto-lints newly added items when pref `lint.onAdded` is set.
4. `src/addon.ts` holds shared `data` (config, env, ztoolkit, locale, prefs window, dialogs), lifecycle `hooks`, small public `api`, and the `LintRunner`.
5. UI registration is split across `src/modules/`: `menu.ts` (context menus), `item-tree.ts` (extra columns), `rich-text.ts` (title rich-text toolbar), `preference.ts`, `shortcuts.ts`, `notifier.ts`.
6. Reused browser/Zotero globals (`Zotero`, `ztoolkit`, `rootURI`, `__env__`, `_globalThis`) are ambient — see `typings/`.

Prefer changing behavior through rules/runner/hooks rather than bootstrap.

### Rule system (the core abstraction)

Everything the plugin does is expressed as a **Rule**. Rules live in `src/modules/rules/` and are defined with `defineRule()` from `rule-base.ts`. A rule declares:

- `id` — kebab-case, following `<category>-<target>-<attribute>` (see CONTRIBUTING.md for the naming taxonomy). `category` ∈ `no` | `require` | `correct` | `tool`.
- `scope` — `"item"` (operates on whole item) or `"field"` (operates on one field; requires `targetItemField`). `"tag"`/`"attachment"` are declared but unimplemented.
- `category`: `"rule"` (default) or `"tool"`. `category: "tool"` rules are user-invoked utilities (never auto-run); standard rules are toggleable via preferences and can run automatically.
- `targetItemTypes` / `ignoreItemTypes` — restrict which Zotero item types the rule applies to.
- `apply({ item, options, debug, report })` — the handler. Mutate the item with `item.setField(...)`; the runner calls `item.saveTx()` once after all rules run. Call `report({ level, message, action })` to surface a finding in the results dialog.
- `prepare({ items, debug })` — optional; runs once before the batch, returns `options` passed to every `apply` call. Returning `false` skips the rule entirely (used e.g. to abort when a dialog is cancelled).
- `cooldown` — min ms between executions; `defineRule` wraps `apply` in `withThrottle` to rate-limit external API calls.

### Rule registration

`src/modules/rules/index.ts` holds the `register` array — **order in this array is execution order**. The `Rules` class exposes `getAll()`, `getStandard()` (non-tool), `getEnabledStandard()` (filtered by `getPref('rule.${id}')`), `getTool()`, `getByID()`, `getByType()`. To add a rule: copy `_template.ts`, implement it, import + add it to `register` at the correct position, then add prefs in `addon/prefs.js` and l10n in `addon/locale/**/rules.ftl` as needed.

Rule IDs are the source of truth for the `ID` type: `zotero-plugin.config.ts`'s `build:bundle` hook imports the registered rules and generates `typings/rules.d.ts` (an `ID` union of all rule ids) at build time. New rules won't be in the `ID` type until a build regenerates that file (`defineRule` accepts a `string` id to suppress the type error meanwhile).

### Runner

`src/modules/runner.ts` (`LintRunner`) orchestrates a batch. It:

1. Calls each rule's `prepare` to build an `optionsMap`.
2. Queues batches serially and processes items with bounded workers (1–16, from pref `lint.numConcurrent`).
3. For each item, iterates rules, skipping via `shouldApplyRule` (item-type + field-validity checks), wraps each `apply` in a 60s timeout, and collects errors without aborting sibling rules. Modified items are saved together; a failed transaction reloads and restores snapshots before individual retries.
4. Aggregates results into a report shown via `reporter.ts` (`ProgressUI` + results dialog).

Entry points into a batch run go through `addon.hooks.onLintInBatch(ruleIDs, items)` in `hooks.ts`.

### Dual-pipeline architecture: Local offline check & repair vs. Online metadata update

MetaFlow strictly decouples its core processing into two independent pipelines with zero cross-contamination:

1. **「检查并修复元数据」（Check & Repair Metadata / Local Pipeline）**:
   - **Zero-Network Guarantee**: 100% offline execution using local algorithms, regex, and built-in dictionary databases. Absolutely no HTTP/HTTPS, DNS lookups, or external API calls are allowed. Must execute instantly and reliably in offline environments or air-gapped networks.
   - **Included Capabilities**: Title case/sentence case normalization, punctuation and trailing period cleaning, chemical/molecular subscript formatting, author name & pinyin validation, publication/journal ISO 4 offline abbreviation deduction (via built-in `data/` assets), date parsing, extra field sorting, local duplicate detection, and attachment role decoupling with safe renaming (ZotAssets: Manuscript vs. SI).
   - **Implementation**: Managed via `addon.hooks.onLintInBatch("standard", items)` and `runCoreWorkflow("check")`. Any rule historically carrying remote network branches (e.g. `require-doi`, `correct-doi-long` defined in `REMOTE_STANDARD_RULES`) is strictly filtered out of local execution and replaced with pure local regex guards (`localDOICheck`).

2. **「更新元数据」（Update Metadata / Online Pipeline）**:
   - **Centralized Network Hub**: All external network requests, online API calls, and remote academic data enhancements must reside exclusively in this pipeline.
   - **Included Capabilities**: Official Crossref bibliographic synchronization, arXiv preprint publication status detection & formal journal migration, Semantic Scholar TL;DR (撷论) & citation count retrieval, EasyScholar 61-dimension journal ranking & impact factor fetching, web snapshot academic revival, and ShortDOI remote resolution.
   - **Implementation**: Governed via `tool-update-metadata` / `tool-update-easyscholar` and `runCoreWorkflow("update")`. Uses `MetadataService` (`services/base-service.ts`) with strict `AbortSignal` timeout limits, retry backoff, persistent local caching, and cooperative batch cancellation. Fails gracefully without corrupting or deleting existing local metadata.

3. **User Preference Controls**:
   - Both pipelines and all individual atomic rules/services must provide independent, explicit toggle switches in the preferences window (`addon/content/preferences.xhtml`).
   - The plugin must never perform silent or unsolicited network requests without explicit user activation.

### Metadata update services

`src/modules/rules/tool-update-metadata/` implements metadata fetching from external APIs (CrossRef via translate, Semantic Scholar, arXiv). Each API is a `MetadataService` (`services/base-service.ts`, defined with `defineService`) with `shouldApply` / `updateIdentifiers` / `fetch` / `transform` methods. This is a mini-plugin architecture nested inside the rule system.

### Built-in data

Large reference datasets (journal abbreviations, conference abbreviations, university→place map, ISO language maps) live in `data/` and are bundled as assets (see `zotero-plugin.config.ts` `build.assets`). At runtime they are loaded lazily and cached via `src/utils/data-loader.ts` (`DataLoader.load(key, ...)`), resolving paths under `${rootURI}data/...`. Immutable built-in data and indexes survive batches; custom-file caches are cleared after each batch. Explicit database reload clears the full cache. Regenerate these files with `pnpm update-data`, not by hand.

## Conventions

### Preferences UI hierarchy and edge distance specification (三级层级与边缘距离规范)

All preference cards in `addon/content/preferences.xhtml` and `addon/content/preferences.css` follow the workspace-wide 3-level alignment standard based on `16px` card horizontal padding:

- **Level 1 (一级)**: Card headings (`.metaref-card-heading` / `summary`) and top overview text (`.metaref-collapsible-card > p`) start at **`16px`** from the card outer border.
- **Level 2 (二级)**: Main option checkbox/radio icons start at **`16px`** from the card outer border; option text starts at **`40px`** (`16px + 16px icon + 8px gap`), establishing the **40px vertical alignment guide line**.
- **Level 3 (三级)**: Sub-headings (e.g. `元数据来源优先级`), subordinate descriptions (`description`, `.metaref-pref-description`), and sub-checkbox/radio icons (`#metaref-metadata-source-priority-container`, `.indented-pref`, `#metaref-tldr-options`) MUST align their left edges at **`40px`** from the card outer border (`margin-inline-start: 24px`), **flush with Level 2 text**. Sub-control text labels start at **`64px`** (`40px + 16px + 8px`).
- **Nested Service Cards (嵌套服务配置子卡片)**: Inner horizontal padding is strictly **`padding: 12px 16px;`** (outer border at `16px`, inner text at `32px` from outer card border); arbitrary paddings such as `10px 14px` are prohibited.

- ESLint config is `@antfu/eslint-config` + `@zotero-plugin/eslint-config` (double quotes, semicolons — see `eslint.config.mjs`). `autocorrect` fixes CJK/Latin spacing in text. Both run on staged files via husky + lint-staged.
- Preference keys follow `rule.${id}.option-name`; read with `getPref` from `src/utils/prefs.ts`.
- Fluent (l10n) message IDs: rule name `rule-${id}`, option `rule-${id}-option-${name}`, menu items `rule-${id}-menu-item` / `rule-${id}-menu-field`. Files in `addon/locale/{en-US,zh-CN}/`.
- Commits: Conventional Commits (e.g. `feat:`, `fix:`, `chore(deps):`,
  `refactor:`, `ci:`). Scopes are used (e.g. `fix(notify):`).
- Some source comments and commit history are in Chinese; keep new user-facing strings in the l10n files rather than hardcoding.
- Try not to remove the existing comments; only add comments that you truly believe are necessary for clarification.
- Reduce the use of defensive code, and only use `try` blocks when absolutely necessary.
