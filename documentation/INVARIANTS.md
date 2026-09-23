# Invariants

The rules every module keeps. Each one is short on purpose; the chapter that owns the detail is linked. If a change needs to break one, that is a decision to write down here first, not a side effect.

## Text

- **Text flows one way.** bytes → `Source` → `Book` → (EditorBook when mounted) → Galley `analyze` → findings, fixes, search, project analysis. Nothing below Book re-parses USFM; USFM knowledge lives in the engine. → [source](architecture/source.md), [galley](architecture/galley.md)
- **Every edit goes through one funnel.** Typing, paste, satellites, fixes, format, replace, revert, recovery and multi-book operations all end in `Book.apply(changes, origin, trust)` and get a Receipt or a Refusal. There is no second write path and no second editable copy of a book. → [editor](architecture/editor.md)
- **Every derived product is stamped,** and every consumer checks the stamp before acting. No module trusts a length. → [source](architecture/source.md), [findings](architecture/findings.md)
- **Diffs are sid-aligned.** Comparison goes through the engine's decision units, never a line diff. (The legacy line diff in `core/diff/diff.ts` is the known exception being retired; see [services](services.md#diff).)

## Disk

- **Only Save writes a book.** Everything automatic is the recovery journal of the dirty buffer. Save writes back the file's dominant EOL and BOM. → [review](architecture/review.md), [recovery](architecture/recovery.md)
- **Durable modules never touch the editor.** Save takes a Book and returns a receipt; Recovery journals changes; Git commits files. They see stamps, not CodeMirror.
- **Scripture text is never merged automatically.** → [sync](architecture/sync.md)

## Hosts and Effect

- **Effect at the edges.** Effect owns host capabilities, engine lifetime, I/O, Git and observability. The editor interaction path (admission → analysis → mutation → publication) is synchronous and never a fiber. → [composition](architecture/composition.md)
- **Host Layers are the only place a host is named.** `src/core` imports nothing framework- or host-specific; `pnpm boundaries` enforces it. → [boundaries](architecture/boundaries.md)
- **One composition.** `composeApplication()` runs once; components reach services through `useComposition()`. → [shell](architecture/shell.md)

## Evidence

- **Observability sits at operation boundaries** (things that own a lifetime, an I/O call, or a decision). Pure functions carry no spans. Event text is capped, so no event carries a payload. → [observability](architecture/observability.md)
- **Local evidence only.** A bounded ring and JSONL export; no phone-home telemetry, no capture-session ceremony.
- **Nearly no mocks.** Real engine, real CodeMirror, real Effect programs, temporary directories and isolated browser storage. A double needs a stated reason. → [test doubles](architecture/test-doubles.md), [testing](architecture/testing.md)
- **Prove at runtime before pinning with a test** while behaviour is still moving. → [verification](agents/verification.md)

## Budget

- **Ordinary editing fits in a frame.** A 60 Hz frame is ~16.7 ms and the editor does not own all of it. Investigate only a measured over-budget owner; prefer indexed queries, less duplicate work and viewport limits before workers or caches. → [solid](architecture/solid.md)

## Design surface

- **`__SEFER_DESIGN__` is never on in production,** and no environment variable turns it on. → [design](architecture/design.md)
