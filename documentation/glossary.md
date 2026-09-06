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

## Naming rules

Use `Source` for canonical editable text, `Disk bytes` for persisted representation, `Revision` for a session identity, and `Snapshot` for a captured input. Say `Save`, `Recovery`, or `Checkpoint` explicitly when describing persistence. Avoid calling all three a “version.”

When a boundary is still under review, keep the word provisional in the document rather than encoding it as a public class hierarchy. The parser, proofreader, and Git lifecycles may refine these terms without changing the core source authority.
