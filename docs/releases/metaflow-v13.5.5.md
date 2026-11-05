# Zotero MetaFlow 13.5.5

Status: local candidate; not published.

## Changes

- Align the settings XHTML template with the first-card-only disclosure policy: only the first of its 11 cards declares `open="open"`. Keep the existing runtime card organization and user-controlled expansion behavior.
- Split the batch runner into queue orchestration, rule execution, transactional persistence, shared state/results, and type contracts. Keep the existing `LintRunner` API and `BatchResult` import path.
- Add architecture guards for the runner modules' 360-line ceiling and method uniqueness, plus a regression check for template disclosure defaults.
- Preserve existing rule preparation, owner cancellation, cooperative scheduling, timeout isolation, mutation rollback, conflict rebasing, history and progress behavior.

## Validation

- All 97 unit-test files / 695 cases pass.
- TypeScript, ESLint and AutoCorrect pass; production XPI builds successfully using the installed scaffold API.
- Static settings audit: 296 defaults / 130 visible bindings, no missing defaults, duplicate static bindings or unresolved visible bindings.
- All 17 extracted method/function bodies match the pre-change implementation after whitespace normalization.
- Targeted Zotero 10.0.7 acceptance: 12/12 pass, including production XPI installation, transaction recovery and light/dark, normal/narrow settings checks with pane re-entry.
- Full native suite: 200 pass / 17 fail. Fourteen business failures reproduce with the pre-change runner; two journal-pane failures do not reproduce in the targeted baseline and remain unresolved. The initial package-path setup failure is corrected and the production installation test passes on rerun. Full host regression is not claimed as passing.

## Boundaries

Other historical oversized modules remain incremental follow-up work. This change does not certify Zotero 11/12, real provider availability, the user's main profile, or automatic updates. Published `update.json` and `dist/` remain at the released version until a separate authorized release.
