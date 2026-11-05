# Zotero MetaFlow 14.0.3

- Explain that the journal abbreviation database is already built in and custom imports are optional.
- Recognize provenance audit manifests and report a localized, actionable error instead of a generic mapping error. Audit metadata is not imported as journal abbreviations.
- Parent custom data file pickers to the settings window and show JSON/CSV together in the abbreviation filter.

Validation: 763 unit tests passed; 23 native settings/package tests passed; strict production build passed. The regression checks the picker parent window and recognizes the structure of the reported provenance file.
