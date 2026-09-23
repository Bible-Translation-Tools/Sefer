# Project

`src/core/project/` is one folder of books and the owner of their lifetimes. Nothing above Project holds Books: it hands out references and closes them. It is **not** a service registry, not a DI container, and not a home for project-wide features.

## The four states

| state | who holds the canonical text | where the transition lives |
| --- | --- | --- |
| Unloaded | nobody; paths known | `discoverBooks(fs, root)` |
| Plain | a `Source` in a plain `Book` | `openProject` — `openBook` per discovered path |
| Instantiated | the editor seat's CodeMirror state | `project.instantiate(id)` |
| Mounted | the same state, with a view bound | the editor; Project never sees a view |

`project.release(id)` goes Instantiated → Plain, rebuilding the plain Book from the seat's **current** text so unsaved edits survive. It is refused with `ProjectError { reason: "Refused" }` when the seat reports attached views.

## The seat port

Core cannot import CodeMirror (`pnpm boundaries`), so the editor layer supplies the factory:

```ts
openProject(root, { seat: (book: Book) => Seated })
interface Seated extends Book { attached?(): number; close?(): void }
```

Instantiating **replaces the object** that holds a book's canonical text, and Project cannot re-point subscribers registered against the old object — `book.changes` belongs to the Book. So Project keeps one mutable seat per id and publishes the swap to the listeners registered with `project.changed(fn)`; readers re-resolve through `project.book(id)` and re-subscribe. A permanent forwarding proxy was rejected: it would add a hop to the keystroke path. **Holding a `Book` reference across an `instantiate` or `release` is a bug in the holder.**

## Discovery order

Two sources, unioned: `*.usfm` / `*.USFM` / `*.sfm` directly under the root, plus — when `<root>/metadata.json` decodes through `decodeBurritoMetadata` — every ingredient whose mime type is `text/x-usfm` or `text/usfm`, or whose path ends in a book extension. Burrito ingredients are the only way a nested path becomes a book; there is no recursive walk. Metadata that is absent, unreadable, unparsable or not a burrito degrades to the extension scan and one `project.metadata declined` note.

Order is the leading number in the file name (`19-PSA.usfm` before `58-PHM.usfm`), then the name, in codepoint order; unnumbered files sort after every numbered one. `ProjectId` is the root path, plus `#<id>` when the project's metadata declares one — a burrito's primary id, or a Resource Container's `dublin_core.identifier`. The metadata (title, language, id) comes from `metadata.json` first and `manifest.yaml` otherwise (`src/core/project/discovery.ts`); only a burrito's ingredients add book paths.

## Failures

A path that cannot be read or decoded lands in `project.failed`, and the project still opens. Only three things fail the open: `NotADirectory`, `NoBooks`, and `Refused` when the root's directory listing itself fails. `fixtures/small-nt/99-BAD.usfm` is malformed **USFM**, not malformed bytes, so it decodes and opens as an ordinary Book with id `BAD` — `failed` is empty for the fixture. Two files claiming one `\id` would make `book(id)` ambiguous, so the first in canonical order keeps the id and the second is recorded in `failed`.

## External changes degrade

`externalChanges()` filters `fileSystem.watch(root)` to the project's known book paths and coalesces into 250 ms windows keeping the last event per path (`groupedWithin`, not `debounce`, which would drop every book but one when a checkout rewrites several files). `Create`/`Update` report `changed`, `Remove` reports `removed`.

`watch` is real on the Tauri and Node layers and unimplemented on the memory and OPFS layers. Any failure of the watch stream degrades to `Stream.empty` plus a `project.watch declined` note — the project keeps working with no external-change reporting rather than failing the stream into the UI. **Project never auto-merges**; resolving a change is Save's job, which holds the baseline Project does not.

`openProject` requires `Scope`; the scope closes the project, which releases seats and clears listeners.
