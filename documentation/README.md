# Documentation

This folder holds durable project guidance for humans and agents. Root `AGENTS.md` is a short entry point; detailed instructions belong in the document that owns the topic.

## Start here

- Choosing or changing tests: [testing strategy](./architecture/testing.md).
- Deciding whether a test double is justified: [nearly no mocks proposal](../planning/00-ideas/nearly-no-mocks-testing.md).
- Checking a feature in a running application: [agent verification](./agents/verification.md).
- Working with Solid or investigating reactivity: [Solid development and diagnostics](./architecture/solid.md).
- Understanding Web/Tauri composition: [composition](./architecture/composition.md).
- Knowing what `src/core` may depend on: [boundaries](./architecture/boundaries.md).
- Reading or writing files: [storage](./architecture/storage.md).
- Working with a book's canonical text or its stamp: [source and book](./architecture/source.md).
- Validating Scripture Burrito or Resource Container metadata, importing, or binding a library resource to a role: [resources](./architecture/resources.md).
- Parsing or proofreading USFM through the pinned engine: [Galley](./architecture/galley.md).
- Opening a folder of books, the four Book states, external changes: [project](./architecture/project.md).
- Asking the host for paths, settings, credentials, or a dialog: [host capabilities](./architecture/host.md).
- Saving, autosave, conflicts, and crash recovery: [save and recovery](./architecture/save.md).
- Comparing against the saved baseline or running one command across books: [diff and multibook](./architecture/diff-and-multibook.md).
- Finding text and replacing one match: [search](./architecture/search.md).
- Committing receipts, reading history, project admin: [git](./architecture/git.md).
- Using shared product terms: [glossary](./glossary.md).
- Adding logs, spans, or agent-visible runtime evidence: [observability shorthand](./architecture/observability.md).

## Scope and authority

The testing and verification direction records the agreed starting approach for Sefer. This checkout is the new Sefer application scaffold using Solid 2 release-candidate packages. An agreed approach does not mean every harness is installed or working, and these documents do not authorize application implementation.

Active architecture discussions live under [`planning/01-discussing`](../planning/01-discussing/). The isomorphic-git filesystem and traced lifecycle proposal remains a discussion rather than working guidance.

The broader product and architecture authority is the sibling repository's `plans/editor-v2-rewrite-vision.md` in `scripture-editor-proto-2`. It is a vision, not an implementation plan. Keep parser and proofreader internals owned by their supplying repositories.

Current executable commands and dependencies live in `package.json` and runner configuration. Read those before running checks; report discrepancies rather than inventing a command from an intended workflow.

## Keeping guidance small

Add detail to the owning document and link to it by task. Create another document only when a separate topic earns it. Avoid duplicating rules, maintaining a source-file inventory, or adding empty framework folders.

Update guidance when its commands, contracts, or proof requirements change. Keep temporary investigation notes and generated evidence separate from durable instructions. New harness recipes become operational guidance only after someone has executed them successfully.
