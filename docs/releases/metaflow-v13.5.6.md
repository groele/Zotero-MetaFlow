# Zotero MetaFlow 13.5.6

Status: local candidate; not published.

## Changes

- Refresh journal/index/TL;DR values by invalidating native row caches and broadcasting a row redraw. Value updates no longer rebuild column definitions, which could asynchronously restore a previously selected item.
- Resolve journal sections using their own public `item` property. Remove private `_item` and global active-window fallbacks, and reject stale asynchronous renders after a selection change or section disconnection.
- Split journal-pane rendering into index cards, preprint/snapshot quick actions, sharing controls, and section context. Each journal-pane domain module stays within 360 lines, enforced by an architecture test.
- Replace temporary forced test failures and private host assignments with public selection synchronization. Add native assertions for selection preservation, actual cached cell updates, and delayed API responses after switching items.

## Validation boundaries

All 100 unit-test files / 703 cases pass, together with TypeScript, ESLint and AutoCorrect. Final isolated Zotero 10.0.7 acceptance passes 10/10 (nine journal-pane tests plus production XPI installation), including a primed native row cache and delayed response after selection changes. The broader native run reports 211 pass / 6 fail; these remaining failures are listed in the workspace report and are not claimed resolved. That broader run preceded the final row-cache invalidation addition; the final code/package has the separate 10-case acceptance result.

Results and remaining full-suite failures are recorded separately in the workspace follow-up report. No claim is made about Zotero 11/12 execution, real provider access, the user's main profile, or automatic updates. Published update feeds and release assets remain unchanged.
