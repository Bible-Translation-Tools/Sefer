# Resource metadata

Scripture Burrito `metadata.json` and Resource Container `manifest.yaml` describe what a resource is. Sefer may receive those bytes from the `effect/FileSystem` port or from a Rust command behind Tauri; either way what reaches the application is an untyped JSON value. `src/core/resources/` is the contract that turns such a value into a typed one, and it is nothing else: no reader, no I/O, no classification, no import flow.

Two Effect Schemas, with the same decode shape — a synchronous `Schema.decodeUnknownResult` wrapper that takes `unknown` and returns `Result<T, Schema.SchemaError>`, never an Effect, so a caller on any path can decode without a runtime.

- `burrito.ts` — `decodeBurritoMetadata`. Requires `format` (the literal `"scripture burrito"`), `meta`, `identification`, `type`, `languages`, and `ingredients`; `idAuthorities` and `localizedNames` are optional.
- `resourceContainer.ts` — `decodeResourceContainerManifest`. Requires `dublin_core` and `projects`; `checking` is optional. YAML parsing is out of scope and there is no YAML dependency: the caller hands over an already-parsed value.

Both model a subset — the fields the previous application actually read, plus enough to identify a resource. Both are open records: Effect Schema ignores excess properties by default, so a real Burrito or manifest carrying spec fields we do not model still decodes, and the unmodelled fields are simply not carried into the decoded value. Adding a field to a schema is how it becomes visible to the rest of the application.

A refusal is a `Schema.SchemaError` whose `message` names the failing path, for example `Missing key` followed by `at ["identification"]`. Fixtures live in `fixtures/resources/`; see that folder's README for what is real and what is constructed.
