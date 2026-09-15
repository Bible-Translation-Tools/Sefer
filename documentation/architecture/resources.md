# Resource metadata

Scripture Burrito `metadata.json` and Resource Container `manifest.yaml` describe what a resource is. Sefer may receive those bytes from the `effect/FileSystem` port or from a Rust command behind Tauri; either way what reaches the application is an untyped JSON value. `src/core/resources/` is the contract that turns such a value into a typed one, and it is nothing else: no reader, no I/O, no classification, no import flow.

Two Effect Schemas, with the same decode shape — a synchronous `Schema.decodeUnknownResult` wrapper that takes `unknown` and returns `Result<T, Schema.SchemaError>`, never an Effect, so a caller on any path can decode without a runtime.

- `burrito.ts` — `decodeBurritoMetadata`. Requires `format` (the literal `"scripture burrito"`), `meta`, `identification`, `type`, `languages`, and `ingredients`; `idAuthorities` and `localizedNames` are optional.
- `resourceContainer.ts` — `decodeResourceContainerManifest`. Requires `dublin_core` and `projects`; `checking` is optional. YAML parsing is out of scope and there is no YAML dependency: the caller hands over an already-parsed value.

Both model a subset — the fields the previous application actually read, plus enough to identify a resource. Both are open records: Effect Schema ignores excess properties by default, so a real Burrito or manifest carrying spec fields we do not model still decodes, and the unmodelled fields are simply not carried into the decoded value. Adding a field to a schema is how it becomes visible to the rest of the application.

A refusal is a `Schema.SchemaError` whose `message` names the failing path, for example `Missing key` followed by `at ["identification"]`. Fixtures live in `fixtures/resources/`; see that folder's README for what is real and what is constructed.

## Checksums

A Burrito ingredient carries the md5 and the size of the file it names, which
means every save of a book makes `metadata.json` wrong about that book.
`src/core/resources/checksum.ts` is what makes it right again, and it holds an
md5 of Sefer's own: Web Crypto deliberately does not implement md5 — it is
broken as a security primitive and the browsers will not grow it — and core may
not import `node:crypto`. Burrito uses md5 as a content FINGERPRINT, not as a
signature, so the weakness is not ours to fix; we only have to produce the same
digits every other Burrito reader produces. RFC 1321 is sixty lines of
arithmetic, and a package for it would be a supply-chain surface for nothing.

`refreshIngredientChecksums(metadata, readBytes, names?)` is the policy: it
recomputes the named ingredients (every one by default) through a reader the
caller supplies, leaves an ingredient whose bytes it cannot read exactly as it
is — a missing file is a fact about the project, not a reason to invent a
checksum — and reports which rows moved, so nothing is written when nothing
changed.

Where it is called: `ProjectAdmin.refreshChecksums(root, names?)` wraps it over
the `FileSystem` port and writes through the same schema gate as every other
metadata edit, and composition hangs that off `SaveCoordinatorOptions.onSaved`
(`src/app/services.ts`). Save must not know what a burrito is and ProjectAdmin
must not know when a save happened, so the two meet in composition;
`ingredientFor(fileSystem, path)` answers which project a written path belongs
to and what the ingredient is called inside it, by walking up at most four
levels to the nearest `metadata.json`. A path under none is a folder of loose
USFM, and nothing happens.

## Import and Library

Two modules sit on top of those schemas. Neither redefines what a Burrito or a Resource Container is; both decide things _about_ a folder of files, through the `effect/FileSystem` port only.

`src/core/resources/import.ts` is the three-step path from foreign bytes to a project, and the steps are separate so that nothing unvalidated ever lands in a project.

- `stage(fileSystem, paths, stagingRoot)` copies what the user picked into a fresh `<stagingRoot>/<stageId>/`. A picked directory contributes its _contents_, so a Resource Container folder puts `manifest.yaml` at the staging root; a picked file contributes itself. The staging directory comes from the port's `makeTempDirectory`, which is how core gets a fresh name without owning a source of randomness.
- `classify(fileSystem, { root })` answers `burrito | resourceContainer | looseUsfm | unknown` and never fails: an unreadable or undecodable candidate simply is not that kind. A `metadata.json` that decodes as Burrito is a Burrito; a `manifest.json` that decodes as a Resource Container manifest is one. There is no YAML parser in Sefer and adding one to decide a classification would be a large dependency for a small question, so a `manifest.yaml` counts only on textual evidence — its first lines declare `dublin_core:` at column zero. Otherwise, any `.usfm` file under the root makes it `looseUsfm`, and nothing makes it `unknown`. The Library calls the same function, so classification lives in one place.
- `commit(fileSystem, staged, { root })` validates every staged `.usfm` file through `decode` from `src/core/source/source.ts`, records provenance, copies the staged files into the project and removes the staging directory — a move. It refuses before writing: `Unclassified` when the staging directory is not one of the three kinds or holds no book, `InvalidBook` when a book is not canonical UTF-8 text. Provenance is a JSON list at `<root>/.sefer/provenance.json`, written with `writeFileAtomic`, one record per import: `stageId`, the source paths, the classification, an ISO timestamp and the committed book paths. It records **no content hash** — text identity is the engine's xxh3 at the Galley boundary, never core's.

`src/core/resources/library.ts` is the registry, and it keeps the vision's two independent facts apart (§15.2): a resource's semantic _kind_ is what it is, its _role_ in a project is what it is for.

- `Resource { id; kind; root; title; language? }`. The id is the root path: a resource is where it lives, and nothing in core mints identifiers. `add(root)` classifies through `classify` and reads `title`/`language` from the metadata it already knows is there (`identification.name` and `languages[0].tag` for a Burrito, `dublin_core.title`/`dublin_core.language.identifier` for a Resource Container, the folder name for loose USFM).
- `bind(projectId, role, resourceId)` adds a resource to the set holding `role`; `unbind` removes one; `resolve(projectId, role)` returns every resource bound to the role in binding order, and `bound(projectId)` returns all of a project's bindings so a shell can lay out panes without knowing the roles up front. `Role` names the well-known roles (`source`, `notes`, `reference`, `glossary`; `ROLES` also spells `tn`, `tw`, `tq`) and stays an open string, so a project can bind a role Sefer has no surface for yet. A role holds many resources on purpose — two source texts side by side is ordinary. An empty result is explicit, never substituted. The same resource can be a source in one project and a reference in another; binding changes nothing about the resource. Each resource also carries `subject` — the Burrito flavor or the Resource Container subject — so a surface can choose a renderer.
- `lookup(resourceId, ref)` returns `Option<Passage>` — the raw USFM of a verse (or a whole chapter when `ref.verse` is absent). It finds the book file as the first `.usfm` path whose name contains the book code, then slices by scanning `\c` and `\v` markers with a regex. That is deliberately provisional: it knows nothing about verse bridges, `\va` numbers or nested markers, and exists so the Library can answer before the engine is wired in. The Galley TOC (`Dish.toc`) and ProjectAnalysis will give exact, stamped spans; when they do, that scan is deleted.
- The registry is `<libraryRoot>/library.json` — the resource list and `{ [projectId]: { [role]: resourceId[] } }` — decoded through its own Effect Schema, held in memory for the life of the Layer and rewritten with `writeFileAtomic` on each mutation. A registry that does not decode is not a reason to refuse to start: the library comes up empty, says `library.load declined` in telemetry, and the resources are still on disk to add again. `LibraryLive({ libraryRoot })` is a `Layer<Library, never, FileSystem>`.

## Binding a reference, and where the binding lives

The Library had no surface, which made "how is a reference Bible supposed to work?" a fair question: the port could bind, and nothing could call it. The reference column
(`src/app/ui/workspace/ReferenceColumn.tsx`) is that surface, and it is the only one.

The column is two SLOTS, not one list, because the distinction is the project's and not the reader's. **Source** is the text this translation is made from, there is one of it, and it is shown first; **Reference** is everything else kept open beside it, of which there may be several. Each slot offers a picker — `Add source…`, `Add reference…` — and each bound resource is a card showing the passage at the chapter the editor is on, with an `×` that unbinds it.

What the picker lists is every project on this device except the open one, read from the project index the landing screen already uses (`readProjectIndex` through `listProjects`), minus what is already bound. That is the important decision: **a reference Bible on this device IS another project** — the same folder of USFM, imported through the same zip or folder import — so there is no second importer here, no second idea of what a resource is, and nothing to keep in step. Choosing one calls `Library.add(root)` (idempotent: it re-reads the metadata and replaces the entry) and then `Library.bind(project.id, role, resource.id)`.

Where the binding lives: `<appData>/library/library.json`, under `bindings[projectId][role]`, written atomically by the Library on each mutation — never inside either project. That is what lets the same resource be a source in one project and a reference in another, and what makes `×` an UNBIND and not a delete: the resource stays registered, and every other project's binding to it is untouched.

Which passage a card shows is the chapter at the TOP OF THE VIEWPORT, not the clip: `workspace.lastLocation`'s `at` (see [the shell](shell.md)) is what the editor measures for the location bar, so the cards follow a free scroll and not only a chapter view. The chapter NUMBER is read off the chapter row's own label rather than counted, because the engine's first row is the front matter and carries no number. `lookup` still answers with raw USFM — see above — so the column strips the markers for display; the day `lookup` returns spans the engine measured, that stripping goes with the scan.
