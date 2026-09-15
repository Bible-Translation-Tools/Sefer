# The application shell

The shell is the Solid layer above every module: it composes their Layers once, offers their operations as commands, and renders thin screens over them. It owns no domain logic — every screen is a synchronous read of something a module already holds, plus a button that calls back into it.

## Services: one composition, one file

`src/app/composition.ts` owns boot and Observability and stops there (see [composition](composition.md)). `src/app/services.ts` is the next ring out: `composeServices(composition)` merges the Web host's capabilities and every core module over the built composition and returns plain service values plus `run(effect)`.

Wiring facts that carry meaning, not taste:

- `run` provides the **application** scope (`runtime.scope`). `openProject` and `ProjectAnalysis.attach` require `Scope`; a per-call `Effect.scoped` would close the project the instant the call returned.
- `RecoveryLive` is provided **to** `SaveCoordinatorLive` (`Layer.provideMerge`). Save reads Recovery through `serviceOption`, so it only journals when Recovery is in its own context.
- The Save hasher is built with `Layer.unwrap` over `Galley`: core computes no content hash, and the hasher is a function that needs the built engine.
- `Observability` is merged back over the modules (`provideMerge`, not `provide`) because `run` may ask for the ring itself.
- The `seat` (`src/app/services.ts`) is how a plain Book becomes an `EditorBook`. It records each one it makes, which is how the shell reaches an `EditorBook` from a `Book` port with no type assertion. It gives each book a fresh `galley.memoize()`, and adds the **mountable** half of the editor (`commandsLayer`, `viewLayer()`) so a view can be constructed straight over `book.state`.
- Composition **rejects** if the engine will not load. There is no useful Sefer without Galley, and `ShellGate` renders that failure instead of an editor that refuses every parse.

`?fixture=1` in a dev build composes over the seeded `fixtures/small-nt` memory FileSystem instead of OPFS — the shortest route to a real project on screen.

## State: `src/app/ProjectContext.tsx`

The open `Project`, the focused book, the mode, the clipped chapter, the findings cursor and the status line live in one Solid context above the router. TanStack owns navigation, not lifetimes: a route match is destroyed on every navigation, and a Project owns Book lifetimes.

`shell.unsaved(book)` is exactly `SaveCoordinator.dirty(book)` plus a `tick()` read for reactivity. It
used to add a revision check of its own, because a book opened from disk had no baseline and so read
dirty untouched; the shell now tells Save what disk holds instead, with `adopt` at focus ([save](save.md)).

The context carries a stable handle — `useShellState()` (always available) and `useShell()` (only inside a `ShellGate`) — because a Solid 2 context value is read when the provider is created and cannot be swapped later.

## The Solid/Book boundary

**One subscription per book, in `src/app/ui/BookEditor.tsx`, and nowhere else.** That component creates the `EditorView` over `book.state`, routes every transaction through `book.fromView`, and in its `book.changes` callback does three things: writes a stamp signal, hands the editor's own `Analysis` to `ProjectAnalysis.supply` (so a keystroke costs no second wasm call), and calls `shell.bump()`.

`bump()` increments one signal. Every derived screen — the census, the dirty markers, the findings list, the stale badges — reads `shell.tick()` and re-reads its module. No other component subscribes to a Book, and nothing outside that file holds text.

Mode and chapter are dispatched into the canonical state through a compartment. Neither is a document change, so `fromView` ignores them: a projection is presentation and a clip is a view choice.

## How a book opens: the whole book, unless asked otherwise

A book opens **whole** — one scrolling document, no clip. A book is one document, and chapter-at-a-time
is a way of reading it, not its shape; the editor's clip (`pickChapter`) is dispatched into the
canonical state through a compartment, so un-clipped is simply `null`.

`editor.preferChapterView` (default `false`, "Open books one chapter at a time" on `/settings`) turns
that around for readers who want it. It is registered in `src/app/settings.ts` like every other shell
preference, and the shell is its second reader, so the keys are declared once there and memoised
against the `SettingsService` — registering a name twice is a programming error the service notes.
`ProjectContext` holds the value in a signal kept live by a forked fiber over `settings.changes`, so
turning it on takes effect immediately.

What each state means:

- **Off (the default).** `focus` opens on `null` — the whole book. The chapter picker still works:
  choosing a chapter clips, "Whole book" un-clips, and `editor.chapter.next/previous/whole` do the
  same from the palette. Navigation that names an offset (a finding, a search hit) leaves the book
  un-clipped and the offset is scrolled to.
- **On.** `focus` opens clipped — to the chapter the navigation asked for, or the first one.

Findings and search navigate by URL, and the route that lands calls `focus(bookId)` with no offset. So
the offset is left on the shell first: `shell.aim(bookId, from)` records it, `focus` reads it to
choose the opening chapter, and `shell.reveal()` keeps it for the editor surface to scroll to.

## The workspace chrome

Three components, in `src/app/ui/workspace/`, and one rule between them: the
RAIL answers "where in Sefer am I", the SIDEBAR answers "where in this project
am I", and the TOOLBAR answers "what am I looking at".

- **`IconRail`** is permanent and one tile wide. Its panel toggle collapses the
  sidebar and never itself. The mode tiles (Refine, Key terms, USFM) appear
  only while a project is open; Key terms is a navigation to `/find?mode=stet`
  and is lit from the URL, not from a signal. Findings, History and Settings
  are lit by a `pathname` prefix, which is also why `/start/*` lights the
  project chooser: it is the projects screen's second half.
- **`ProjectSidebar`** is the book list, the review pills from
  `ProjectAnalysis.census`, and the chapter grid of the FOCUSED book — the one
  place a chapter is chosen. There is no chapter `<select>` on the editor page.
  With no project open the panel shows `shell.recentProjects` instead (the
  `shell.recentProjects` preference the landing screen writes as it opens a
  root) plus an "All projects" link; with no project AND no history there is
  nothing to show, so `shell.sidebarShowing()` is false and the panel is off
  screen. That is separate from `shell.sidebarOpen()`, which stays exactly as
  the reader left it.
- **`Toolbar`** names the book — "Philemon (small-nt)" whole, "Philemon 1
  (small-nt)" clipped, "Philemon front (small-nt)" in the front matter — and
  every action on it is a `runCommand`.

The split itself is `Resizable` (`src/app/ui/primitives/Resizable.tsx`), which
does not implement collapsing: a collapsed pane is a different tree, so the
sidebar panel is HIDDEN rather than unmounted, because unmounting it would
renumber the split and rebuild the editor's `EditorView` beside it.

The chrome's own preferences, all declared in `src/app/settings.ts`:
`workspace.sidebarOpen` (the reader's toggle) and `workspace.sidebarWidth` (a
fraction of the row, written once the drag settles); `shell.theme`,
`shell.fontSize` and `shell.zoom`, applied to `<html>` by
`src/app/ui/theme.ts`; `editor.fontSize`, the scripture column's own size,
applied by the same module as `--editor-font-size` and kept live by a fiber
over `settings.changes` in `ProjectContext`; and `shell.recentProjects`, the
root → ISO-8601 record the sidebar and the landing screen share.

`shell.updateAvailable()` is one `Updater.check()` per session, on the desktop
host only, five seconds after the shell is built. The sidebar footer reads an
answer rather than asking one, which is what keeps a footer from making a
network request per render.

## The findings panel's filter

`/findings` renders the whole project's findings through a filter the reader owns. The policy is pure and lives in core (`src/core/findings/filter.ts` — `applyFilter`, `facets`, `groupBy`; see [findings](findings.md), "Filters and views"); the shell holds only the state and the chips. `src/app/ui/FindingsFilters.tsx` carries both halves of that state deliberately: `createFindingsFilter(services)` owns the value — seeded from `Settings.get`, written back through `Settings.set` on every click, kept live by a fiber over `settings.changes` like `editor.preferChapterView` — and `<FindingsFilters>` is the chip row that edits it, so the list, the counts and the keyboard cursor cannot disagree about what is being shown. Severity, producer and "hide stale" persist as `findings.filter`; the text box, the book selection and the view (by book, by code, by severity, flat) are session signals. The key is a `Schema.Struct`, and `/settings` draws one widget per `kind`, so it is registered in `shellKeys` but left out of `shellSettings` — the panel is its only editor. The route's `j`/`k`/arrows/Enter cursor is **local to the route** and honours the filter, while the shell's own findings cursor (`shell.finding`, `editor.findings.next` in the palette) still walks the unfiltered project: sharing one cursor would make a palette command jump according to a filter it never mentioned, and keeping them apart needs no change to `ProjectContext`.

## Commands

`src/app/commands.ts` holds the registry (`registerCommand`, `runCommand`, `commands()`), a `Mod-`-chord matcher on the document, and the core set. Each command has at least three callers — a button, a keystroke, and the palette — and `when()` is the "is this possible now?" question asked once. Commands reach the application only through `ShellBridge`, which is the honest list of what a command needs; a command that wants something not on it is telling us the shell owns state it has not admitted to owning.

An Effect-returning command is run on the app runtime by the runner `registerShellCommands` installs.

## Routes and tokens

`/projects`, `/start/create`, `/start/find`, `/project/$id`, `/project/$id/book/$book`, `/find`, `/findings`, `/history`, `/settings`, plus `/` and the dev-only `/dev/fixture`. `/find` owns its search params (`q`, `mode`, `scope`) and derives its whole state from them, so a link into it from the rail or the toolbar changes the screen that is already mounted. File routes under `src/routes`; `src/routeTree.gen.ts` is generated — never edit it.

`src/app/ui/tokens.css` is the design system as plain custom properties, ported from the v1 editor's vanilla-extract contract so the two read as one product, and it is also the Tailwind v4 configuration: an `@theme` block mints a utility from every semantic name. Components use the semantic names (`bg-surface-primary`), never the ramps. Dark is a token swap under `[data-theme="dark"]` and `prefers-color-scheme`, never Tailwind's `dark:` variant. The reusable components live in `src/app/ui/primitives/`, which is the only place corvu is imported. `src/app/ui/app.css` is the one global stylesheet and holds only the `<body>` ground and the CodeMirror frame. See [the UI layer](ui.md).

Every user-visible string goes through `t()` (`src/app/i18n.ts`) — an identity with `{param}` interpolation. The point is the seam; Lingui replaces the body later.

## What is stubbed

- **Opening an arbitrary folder on the Web host.** `WebDialogsLive.pickFolder` returns a picked handle's *name*, not a path the OPFS layer can read. `/projects` lists the OPFS subtree Sefer owns and says so.
- **Drafting** (`src/app/workflows/drafting.ts`) and **STET** (`src/app/workflows/stet.ts`) are typed stubs that `Effect.die`. Each file's header says what it composes and why the missing piece is domain vocabulary rather than code.
- **Replace, on the screen.** `src/core/search` has `replace`, `replaceInBook` and `planReplace`, and `/find` deliberately surfaces none of them for now: an edit happens through an excerpt's Edit button, in a satellite over the canonical Book, where the editing phases judge it like any other keystroke. Replace-all is a MultiBook operation with one Undo per book, and offering the button before that flow is wired would offer something we cannot take back.
- **Restoring a previous version.** `/history` shows a commit's bytes read-only; loading one into a Book is an edit and needs a diff and a confirmation.
- **The inline linter and its gutter**, for a reason outside the shell: the installed `@codemirror/lint` resolves its own copy of `@codemirror/state` (6.5.2) while the app uses 6.7.4, so `usfmLinter()`'s facets come from a different module instance and CodeMirror answers "Unrecognized extension value in extension set". Adding `resolve: { dedupe: ["@codemirror/state", "@codemirror/view"] }` to `vite.config.ts` fixes it (verified), after which `usfmLinter(), lintGutter()` can be appended to `mountable` in `src/app/services.ts`. The duplication affects `src/editor/recipes/lint.ts` for anyone who mounts it, so the fix belongs in the build config.
- **Scrolling to a target in an un-clipped book.** `shell.aim` and `shell.reveal()` carry the offset a
  finding or a search hit named, and `focus` already uses it to choose the opening chapter when chapter
  view is on. With chapter view off nothing scrolls to it yet: the scroll belongs in
  `src/app/ui/BookEditor.tsx`, the one component that holds the `EditorView`.
- **Settings enumeration.** `SettingsService` has no "list every registered key" — a key belongs to the module that declared it. `src/app/settings.ts` is the shell's own set, and `/settings` renders exactly those.
