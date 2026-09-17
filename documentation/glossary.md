# Sefer glossary

This is the shared vocabulary for planning and implementation. Terms marked **agreed** describe boundaries we intend to preserve. Terms marked **provisional** are useful working names whose shape must remain open while the editor, parser, and proofreader are in flux.

| Term | Status | Meaning |
| --- | --- | --- |
| Source | agreed | The canonical, editable UTF-8 text for one document. It uses normalized LF line endings; parsed products and diagnostics are derived from it. |
| Disk bytes | agreed | The bytes read from or written to persistent storage, including their detected or selected newline style. They are converted at the storage boundary and are not the live editing authority. |
| Book | agreed | One addressable USFM document and its current Source revision. A Book is not a parser AST or a Git commit. |
| Project | agreed | A user-visible collection of Books and project metadata. Project ownership may span a Web session or a desktop directory. |
| Resource | provisional | A reference or supporting artifact associated with a Project, such as a source translation, glossary, or imported file. Identity and provenance still need a dedicated design. |
| Role | provisional | The declared relationship a Resource has to a Project or Book. It carries policy and provenance; it is not an implicit priority score. |
| Revision | agreed | A session-scoped identity for an accepted Source state. It guards against stale work; it is neither a content hash nor an ordered identity across sessions. |
| Snapshot | agreed | An immutable captured Source revision plus metadata required by one operation. A Snapshot can be saved, analyzed, or compared without becoming the live editor state. |
| Save | agreed | Writing a captured Source revision to its intended persistent file and returning a receipt tied to that capture. The editor may have accepted a newer revision when the write finishes. |
| Recovery | agreed | A durable local copy that protects unsaved work after a crash or failed save. It is not a successful Save. |
| Checkpoint | agreed | A named or Git-backed historical state used for navigation and comparison. It is not the editor's current revision. |
| Operation | agreed | A user-meaningful unit of work with an outcome and bounded evidence. Source-changing operations name their input Revision; operations such as boot need not. |
| Host | agreed | The environment providing platform capabilities: Web or Tauri desktop. Host composition supplies capabilities; core policy does not import either host. |
| Composition root | agreed | The small host/application boundary where concrete capabilities are assembled. The router chooses screens; it is not automatically the service container. |
| Effect program | provisional | A typed, scoped description of asynchronous or resource-owning work. Effect is a runtime tool, not a reason to create a service for every noun. |
| Galley | agreed | The engine that reads Source. ONE call returns both the structure and every problem it can see; parsing and proofreading are one pass, not two steps. |
| TOC | agreed | One Book's chapters and verses, from the engine — which chapter, which verse, and the offset each starts at. Available for any REGISTERED book without parsing it, so a sidebar or a chapter picker costs no CST. Not the editor's Structure. |
| Structure | agreed | The editor's view of the open document (`DocStructure`), backed by CodeMirror and refreshed per gesture. Only a seated Book has one; every registered Book has a TOC. |
| Book census | agreed | One row per Book — chapters, verses, error and warning counts — as the book-list page shows them. `ProjectAnalysis.bookCensus(project)`. Qualified because "census" alone is ambiguous: the engine calls the TOC buffer a census, and a full glyph enumeration is also called a Sous census upstream. Neither is this. |
| Analysis | agreed | What Galley returns for one Book, from that Book's Source alone: the reading AND its diagnostics. Not a list of errors, and not cross-book. |
| Corpus | agreed | Galley's registry of many Books' Source at once, so it can answer questions only true across Books. It is the SAME handle the per-book parse uses, in this process, on both hosts — not a port and not a second engine. One over IPC was tried and removed: the id doors answer off the text a handle retains, so a Corpus in another process is one the parse path cannot name. Not the Project, which is files on disk. |
| Publication | agreed | The Corpus packed into a buffer JS can decode — the engine's internal cross-book state, made readable, whole. Cross-book truth only holds all at once, so a Publication replaces the previous one entirely rather than updating it. |
| Finding | agreed | One thing worth telling the reader about one place in the Source. It comes from an Analysis or from a Publication. It is not necessarily an error, and it may be wrong. |
| Seat | agreed | A Book with an editor attached, so it can be typed in. Not a window: two windows over one Book share one Seat. |
| Satellite | agreed | A second view onto the same Seat, such as a note editor. Not a copy; it maps its own caret through the same edits. |
| Baseline | agreed | The Source as last written to disk, which is what "unsaved" is measured against. Not a Checkpoint: bytes can be on disk with no Checkpoint behind them. |
| Journal | agreed | The Recovery log of accepted edits not yet written to the file. Not a Save. |
| Gesture | agreed | One thing the person did: a keystroke, a click, a command. Not a transaction — one Gesture can produce several — and it is the unit an Operation covers. |
| Source stamp | agreed | A Source's freshness pair: its Revision and its length. Equal stamps mean equal text. Not a content hash and not a Checkpoint. |

## Naming rules

Use `Source` for canonical editable text, `Disk bytes` for persisted representation, `Revision` for a session identity, and `Snapshot` for a captured input. Say `Save`, `Recovery`, or `Checkpoint` explicitly when describing persistence. Avoid calling all three a “version.” The Record a version… command is product copy for one Save; it does not make “version” a term.

## Observability names

Every event the application records is named **`<thing>.<what happened to it>`**, where the thing is a term from the table above.

Not `<subsystem>.<function>`: `analyze.publish` named the module that happened to hold the code, where `corpus.publish` names what exists afterwards. When the code moves, the second name is still true. This matters most where the implementation can change underneath — the Corpus is reached over wasm in-process or over IPC depending on the host and the work, and `corpus.publish` is true of both where a name for either door would not be.

| Verb | Means |
| --- | --- |
| `open` / `close` | a lifetime began or ended |
| `read` / `write` | Disk bytes moved |
| `parse` | Source went into Galley, an Analysis came out |
| `analyze` | a Book's Analysis was replaced — whether Galley ran or the editor supplied one |
| `update` | a registry now holds this |
| `publish` | a whole snapshot was produced |
| `warm` | a product was built before anyone asked for it, so the asking is cheap |
| `apply` | an edit was accepted into a Book |
| `restore` / `discard` | Recovery state was used or dropped |

A refusal is a **verdict** on an event, never a name: one thing happened and a rule said no to it.

One word, one meaning, in events and in conversation. `analyze` previously meant four different things — a Book finished, a Publication produced, one Book registered, and Galley reading text — which is the confusion these rules exist to prevent.

When a boundary is still under review, keep the word provisional in the document rather than encoding it as a public class hierarchy. The parser, proofreader, and Git lifecycles may refine these terms without changing the core source authority.
