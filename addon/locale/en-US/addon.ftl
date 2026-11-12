## General
prefs-title = Zotero MetaFlow

## Item tree
field-abbr = Abbr
    .value = Abbr
    .label = Abbr
field-tldr = TL;DR Takeaway
    .value = TL;DR Takeaway
    .label = TL;DR Takeaway
info-row-tldr = TL;DR Takeaway
    .value = TL;DR Takeaway
    .label = TL;DR Takeaway

## batch
info-batch-init = Preparing...
info-batch-no-selected = No selected items or rules
info-batch-running = Checking metadata...
info-batch-finish = Finished
info-batch-break = Click here to stop this process
info-batch-stop-next = Will stop when current item is complete
info-batch-has-error = Error exists, please check in the console

## dialog
confirm = Confirm
cancel = Cancel
subscript = Subscript
supscript = Supscript
bold = Bold
italic = Italic
no-case = Maintain case
small-caps = Small Caps
unimplemented = This feature is unimplemented.

info-batch-pending-save = Pending save...
info-batch-saving = Saving...
undo-action-lint-metadata = { $count ->
    [one] Organize Metadata
   *[other] Organize Metadata for { $count } Items
}
info-batch-cancelled = Stopped: processed { $processed }, skipped { $skipped }
info-batch-duration = Finished in { $seconds } seconds
report-export = Export report and field changes
report-export-failed = Export failed. Click to retry.
report-prepare-failed = Rule preparation failed
report-save-conflict = This item changed before the save retry. Current library data was preserved and this item's changes were not written. Review it before running again. Conflicting fields: { $fields }.
info-batch-details = Saved { $saved }; unchanged { $unchanged }; not applicable { $notApplicable }; warnings { $warnings }.

completion-notice-open = Click to view the report · Closes automatically after 5 seconds

report-search = Search title, item ID, rule or message
report-filter = Filter report items
report-filter-all = All items
report-filter-warning = Items with warnings
report-filter-error = Items with errors
report-filter-changed = Items with field changes
report-previous = Previous
report-next = Next
report-page = Page { $page } of { $pages } · { $count } items

native-duplicates-merge-all = Merge all duplicates in this library
native-duplicates-start = Start batch merge
native-duplicates-dismiss = Dismiss results
native-duplicates-scanning = Scanning all native duplicate groups in this library…
native-duplicates-empty = There are no duplicate groups to process in this library.
native-duplicates-confirmation = { $groups } groups, { $items } items. Master strategy: { $strategy }. Empty fields are filled; conflicting fields keep the master value. Zotero's native merge preserves attachments, notes, tags, collections and relations. Groups with different types, non-duplicate decisions or intervening edits are skipped. Start merging?
native-duplicates-progress = Processed { $completed }/{ $total } groups; merged { $merged } duplicate items; skipped { $skipped } groups; failed { $failed } groups.
native-duplicates-stopped = Stopped: processed { $completed }/{ $total } groups; merged { $merged } duplicate items; skipped { $skipped } groups; failed { $failed } groups. Completed merges are retained.
native-duplicates-error = Batch merge failed: { $error }

diag-missing-doi-url = DOI field is empty (extractable from URL: { $doi })
diag-missing-doi = Missing official scholarly DOI identifier
diag-non-standard-doi = DOI field contains an extra URL prefix or leading label
diag-missing-creators = Creators field is empty; author information is missing
diag-placeholder-creators = Creators field contains only unresolved placeholders (such as (姓), (名))
diag-contaminated-title = Title contains web/publisher scraping suffix (such as Wiley or ScienceDirect)
diag-trailing-dot-title = Title ends with an unnecessary trailing period
diag-missing-publication = Missing Publication Title
diag-missing-date = Missing publication date or year
diag-missing-pagination = Missing locator fields ({ $fields })
diag-field-volume = Volume
diag-field-issue = Issue
diag-field-pages = Pages
diag-missing-abstract = Missing abstract
