# Zotero MetaFlow 13.5.7

Status: unreleased candidate.

- Recheck write eligibility after asynchronous rules and inside persistence transactions, including deleted, trashed and read-only items. Preserve unrelated concurrent edits during recovery.
- Keep query/header credentials out of the native HTTP debug logger through a privileged anonymous request transport, with redacted failures and real timeout/cancellation/rate-limit tests. The production API does not expose test transport overrides.
- Route explicit core metadata updates through the complete workflow queue, coalescing repeated clicks.
- Propagate cancellation through TLDR, native translation, CNKI document loading and attachment processing. Bound native adapter waits to 15 seconds without claiming physical cancellation of host operations already issued.
- Preserve legacy Extra text until a TLDR note is durable. Recheck the source after awaits and propagate note save/delete failures. Split TLDR parsing and migration into domain modules.
- Release DOM observers per document, drain active import processing before persistence shutdown, and synchronize preference dependencies with external changes and pane disposal.
- Separate attachment role/naming policy and item-pane DOM traversal from their coordinators.

Validation evidence and remaining architectural/compatibility limitations are recorded in the workspace deep-audit report. This candidate does not update the published feed, create a release, or install into the user's main profile.
