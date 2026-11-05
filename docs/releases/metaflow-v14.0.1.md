# Zotero MetaFlow 14.0.1

- Remove duplicate TL;DR Fluent keys and use reflected boolean properties for native controls.
- Keep journal abbreviation provenance in the repository while excluding it from runtime packaging.
- Pin strict TypeScript compiler options and run type checking before bundling.
- Separate report/progress, batch dispatch, shortcut actions, field schema, canvas and title editing modules; move surname data to JSON.
- Enforce a 360-line ceiling across every TypeScript source and test, and unique Fluent keys across each locale.
- Coalesce window initialization with readyPromise and roll back closed/disposed bindings.
- Flush native string bundles on locale unload.

Validation: 762 unit tests, strict production build, and 23 native settings-panel / production-XPI tests passed, including the new level-one overview computed-style assertions at both window widths. Native verification evidence is recorded in the task output directory. Zotero 11/12 were not tested.
