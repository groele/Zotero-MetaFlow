# Zotero MetaFlow 14.1.0

- Add a localized Use built-in abbreviations button beside the file selector.
- Materialize the complete built-in table atomically into the plugin-managed profile directory and show its real path by default.
- Refresh the managed table and restore built-in lookup on click. Preserve selected custom paths until the user explicitly restores built-in data.
- Clear custom paths back to the visible built-in path; keep built-in source profiles and source tags independent of the displayed managed file.

Validation: 763 unit tests, strict build and 23 native settings/package tests. Native checks read the exported JSON, verify more than 44,000 mappings and Nano Letters, and assert the default path stays visible.
