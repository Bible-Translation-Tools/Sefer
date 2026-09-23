# Documentation

This folder holds durable project guidance for humans and agents. Root `AGENTS.md` is a short entry point; detailed instructions belong in the document that owns the topic.

## Start here

- What each service is, what is wrong with it, and where to focus: [services at a glance](./services.md). The rules every module keeps: [invariants](./INVARIANTS.md).
- Choosing or changing tests: [testing strategy](./architecture/testing.md).
- Deciding whether a test double is justified: [test doubles](./architecture/test-doubles.md).
- Checking a feature in a running application: [agent verification](./agents/verification.md).
- Working with Solid or investigating reactivity: [Solid development and diagnostics](./architecture/solid.md).
- Understanding Web/Tauri composition: [composition](./architecture/composition.md).
- Knowing what `src/core` may depend on: [boundaries](./architecture/boundaries.md).
- Reading or writing files: [storage](./architecture/storage.md).
- Working with a book's canonical text or its stamp: [source and book](./architecture/source.md).
- Validating Scripture Burrito or Resource Container metadata, importing, or binding a library resource to a role: [resources](./architecture/resources.md).
- Parsing or proofreading USFM through the pinned engine: [Galley](./architecture/galley.md).
- Editing USFM — the editing phases, the editor-backed Book, windows and satellites: [editor](./architecture/editor.md).
- Reading a diagnostic or applying an offered repair: [findings and fixes](./architecture/findings.md).
- Reading how the project uses a character, or the Sous pattern table: [character inventory](./architecture/inventory.md).
- Reading the build-time environment and the per-channel endpoints: [configuration](./architecture/configuration.md).
- The project list, import sources, the Catalogue, and Create: [the landing screens](./architecture/landing.md).
- Key terms, the STET catalogue and guides: [key terms (STET)](./architecture/stet.md).
- Opening a folder of books, the four Book states, external changes: [project](./architecture/project.md).
- Asking the host for paths, settings, credentials, or a dialog: [host capabilities](./architecture/host.md).
- Working on the desktop app — Tauri plugins, the Rust commands, the updater, or a release: [desktop host](./architecture/desktop.md).
- Reviewing two copies, recording a version, reverting, conflicts, and the save model: [review](./architecture/review.md).
- What a project open asks about unsaved work, and what the reader is offered: [recovery](./architecture/recovery.md).
- Comparing against the saved baseline or running one command across books: [diff and multibook](./architecture/diff-and-multibook.md).
- Finding text across the project, and Replace all behind its Advanced setting: [search](./architecture/search.md).
- Committing receipts, reading history, project admin: [git](./architecture/git.md).
- Sharing a project online, reading the two clocks, or deciding what a Receive would change: [cloud sync](./architecture/sync.md).
- Composing the services, adding a command, a route, or a design token: [application shell](./architecture/shell.md).
- Building a screen, a reusable component, or reaching for a colour: [the UI layer](./architecture/ui.md).
- Prototyping a screen, deploying the design build, or pointing at a pixel and saying what is wrong with it: [the design surface](./architecture/design.md); the visual direction it works toward: [design direction](./architecture/design-direction.md); setting a designer's machine up: [designer setup](./agents/designer-setup.md).
- Using shared product terms: [glossary](./glossary.md).
- Adding logs, spans, or agent-visible runtime evidence: [observability shorthand](./architecture/observability.md).

## Scope and authority

Active architecture discussions live under [`planning/01-discussing`](../planning/01-discussing/); they are discussion, not working guidance.

The broader product and architecture authority is the sibling repository's `plans/editor-v2-rewrite-vision.md` in `scripture-editor-proto-2`. It is a vision, not an implementation plan. Keep parser and proofreader internals owned by their supplying repositories.

Current executable commands and dependencies live in `package.json` and runner configuration. Read those before running checks; report discrepancies rather than inventing a command from an intended workflow.

## Keeping guidance small

Add detail to the owning document and link to it by task. Create another document only when a separate topic earns it. Avoid duplicating rules, maintaining a source-file inventory, or adding empty framework folders.

Update guidance when its commands, contracts, or proof requirements change. Keep temporary investigation notes and generated evidence separate from durable instructions. New harness recipes become operational guidance only after someone has executed them successfully.
