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

`shell.unsaved(book)` reads that book's row of the save-state store: `unsaved` when Save holds a
baseline for it and `SaveCoordinator.dirty(book)` says the text differs. The row is computed when an
event names the book, never during a render, because `dirty` can cost an engine hash. A book opened from
disk has its baseline `adopt`ed at focus, so an untouched book never reads dirty ([save](review.md)).

The context carries a stable handle — `useShellState()` (always available) and `useShell()` (only inside a `ShellGate`) — because a Solid 2 context value is read when the provider is created and cannot be swapped later.

## The Solid/Book boundary

**One subscription per book, in `src/app/ui/BookEditor.tsx`, and nowhere else.** That component creates the `EditorView` over `book.state`, routes every transaction through `book.fromView`, and in its `book.changes` callback does three things: writes a stamp signal, hands the editor's own `Analysis` to `ProjectAnalysis.supply` (so a keystroke costs no second wasm call), and calls `shell.changed({ kind: "book.apply", books: [book.id] })`.

`changed` is the one door into the shell's stores (`src/app/shellStores.ts`). Each `ShellEvent` (`src/app/shellEvent.ts`, a closed union) names the books it moved; the coordinator recomputes those books' rows — save state, stamp, undo depth — and a Publication replaces the findings, the census and the inventory. Every derived screen reads a store row, so an edit in one book leaves every other book's readers asleep. No other component subscribes to a Book, and nothing outside that file holds text. (This replaced a single `bump()`/`tick()` counter that woke every reader on every event; see `planning/01-discussing/ui-state-stores-2026-09-16.md`.)

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

**Going to a chapter is one call, and the preference decides what it means.** `shell.showChapter(ordinal)`
is what the sidebar's chapter grid, the location bar's outline and its two arrows all call. With the
preference ON it clips; with it OFF it drops any clip and scrolls that chapter's `\c` anchor to the
TOP of the page. That is what `reveal.at` distinguishes: a finding or a search hit is a point in the
middle of a page and is centred, and a chapter is the first line you read. Before this the grid always
clipped, so a reader who had never asked for chapter view lost the rest of the book by clicking a
number.

The front matter is row 0 of the engine's chapter table and has no `\c` number. It is a real place —
the identification, the table of contents, the main title — so the grid and the outline both offer it
as **Intro**, and only when the book actually has any.

Findings and search navigate by URL, and the route that lands calls `focus(bookId)` with no offset. So
the offset is left on the shell first: `shell.aim(bookId, from)` records it, `focus` reads it to
choose the opening chapter, and `shell.reveal()` keeps it for the editor surface to scroll to.

## Where you were: `workspace.lastLocation`

Opening a project lands on the WORK, not on a census. `workspace.lastLocation` is a preference keyed by
project root holding `{ bookId, chapter, at }`; `focus` and every chapter change write it (debounced, like
the sidebar width — a record rewrite per click is a file write per click), and two places read it:

- **`/project/$id`** forwards to `shell.landingPath(root)` as soon as the project is open, unless the
  URL carries `?books=1`. The book is checked against the project first, so a book that has since been
  removed falls back to the census rather than to a not-found.
- **The rail's panel tile** uses it as the way back. On a project route the tile is the panel toggle it
  always was; on a full-page screen (settings, findings, history, compare) there is no panel to toggle,
  so it opens the panel and returns to the remembered book. Pressing it on `/settings` used to appear
  to do nothing.

The census is reachable from the location bar's book crumb, which navigates with `?books=1` — a door
that bounced you straight back out would not be one.

`chapter` is the CLIP and `at` is the chapter that was at the top of the viewport. Both are needed,
because a book opens WHOLE by default: a reader who had scrolled down to Psalm 3 had a clip of `null`
and came back to the top of Psalms, which is landing on the right book and the wrong place.
`BookEditor` writes `at` through `shell.noteChapterAtTop`, from the one `watchLocation` subscription
the location bar already has — the shell keeps no viewport state of its own, because a viewport is a
fact about a view and two views over one book may honestly disagree. On open, `focus` scrolls that
chapter's `\c` anchor to the top, or clips to it when `editor.preferChapterView` is on.

An AIM still wins over a remembered place, because a finding or a search hit is a request and a
remembered scroll position is only the absence of one — but an aim is answered ONCE. Re-opening the
book an aim had named used to replay that scroll forever, which is what kept the remembered place out
of reach even after it was written down.

## The way back: `editor.back`

Every full-page route — findings, history, review, compare, find, terms, inventory, cloud, settings,
the projects list — replaces the editor entirely. The rail's panel tile is one way back and reads as a
panel toggle, so there is an explicit one as well: `src/app/ui/workspace/BackToEditor.tsx`, one
`data-testid="back-to-editor"` button pinned to the top-right of the routed content, naming the book it
returns to.

It is rendered ONCE, by the `_app` layout chrome above its `<Outlet/>` and outside the scroller, rather than by
each page: a screen added later gets the door without knowing it exists, no page can forget it or spell
it differently, and it does not scroll away with the content. The same component registers the
`editor.back` command, so the palette lists it and Escape performs it — registered there and not in the
shell's core set, because "is this a full-page screen" is the ROUTE's question and `ShellBridge`
deliberately carries no pathname. All three doors go to `shell.landingPath(root)`, so they cannot
disagree.

Escape works because `installCommandKeys` now skips a binding with no modifier while the reader is
typing into an input, a text area or a contenteditable — which is what `.cm-content` is, so the editor
and the palette's own search box are covered by one rule. Every other binding holds Mod, so the rule
costs them nothing.

The recovery banner is mounted on the book route as well as the project route, for the same reason:
unsaved work found on open is the first thing to answer, and after this change the project page is not
where an open lands.


## The workspace chrome

Three components, in `src/app/ui/workspace/`, and one rule between them: the
RAIL answers "where in Sefer am I", the SIDEBAR answers "where in this project
am I", and the TOOLBAR answers "what am I looking at".

**Where the chrome is mounted is itself the rule.** It lives in
`src/routes/_app.tsx`, a PATHLESS layout, and a screen wears the frame exactly
when it sits under that layout — which is every route file under
`src/routes/_app/`. `_app` is part of the route ID and absent from the URL, so
`/projects` is still `/projects`; a comparison against `routeId()` has to say
`/_app/projects`, which is the one thing that changes for a caller.

Until 2026-09-22 the chrome was in `__root.tsx`, so EVERY route rendered inside
the rail — `/design` included. That is right for a workspace screen and wrong
for a prototype: a designer judging a screen could only ever see it wearing
this frame. The alternative considered was a runtime dial (`?chrome=0`) and was
rejected, because "is this screen inside the application frame" is a structural
fact and a query parameter answers it from a URL somebody can mistype.

What `__root` keeps is what every screen needs whatever its frame: the head,
the one `<ProjectProvider>`, the theme side effect, and the design annotator.
A prototype outside the layout still has services, a theme and the comment
panel — but not the rail, and not `installCommandKeys`, so it does not answer
the application's Mod-K for an application it is not part of.

- **`IconRail`** is permanent and one tile wide. Its panel toggle collapses the
  sidebar and never itself. Everything below the toggle is lit from the
  `pathname`, not from a signal, and every tile but three is a plain
  navigation.

  The mode tiles (Refine, Key terms, USFM) and the project screens (Character
  inventory, Compare) appear only while a project is open: each is something
  you apply to a project, and offering one with nothing open is an affordance
  that answers nothing. Key terms goes to **`/terms`** — its own pane, not
  `/find?mode=stet`, because Find and Key terms are separate routes with
  similar UI rather than a mode toggle on one screen
  (`planning/03-ui/design-direction.md`, gap list 5). Projects, Findings,
  History and Settings are always offered; Projects is lit on `/start/*` as
  well as `/projects`, because bringing a project in is the chooser's second
  half and `ProjectSidebar` reads the same two prefixes.

  `/terms` and `/compare` are navigated to with the usual typed-route cast:
  the generated tree does not hold them yet, so until those routes land the
  tiles answer through the root's not-found boundary, which is a 404 page and
  not a crash.
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
  every action on it is a `runCommand`. Its kebab holds Save, Save & Review,
  Character inventory, Format book, Format project, Export as zip and Rename
  project. Those last four are NOT gated on `findCommand(id)`: `runCommand`
  already answers for an id the registry does not hold — an unknown command,
  or one whose `when()` refuses, is a documented no-op — so the menu names the
  intention and the registry decides whether it happens. A menu that hid or
  disabled every id it could not see would be the toolbar guessing at the
  registry's answer instead of asking for it. Save is the exception, because
  its `can()` is a real "there is nothing to save right now".

The split itself is `Resizable` (`src/app/ui/primitives/Resizable.tsx`), which
does not implement collapsing: a collapsed pane is a different tree, so the
sidebar panel is HIDDEN rather than unmounted, because unmounting it would
renumber the split and rebuild the editor's `EditorView` beside it.

### The book screen is a second split

`src/routes/_app/project/$id/book/$book.tsx` is its own `Resizable.Root`: the
reference pane, a visible handle, then the editor. The pane is
`ReferenceColumn`, and each bound resource inside it is a read-only
`EditorView` over the same book (see [resources](resources.md), "A reference
is a read-only editor, not a card"). Two or more references stack **vertically
inside the pane** as a nested `Resizable.Root orientation="vertical"` with
their own handles, so the reader decides how the pane is divided as well as
how wide it is.

The width is `workspace.referenceWidth`, a fraction of the editor row, with
the same discipline as `workspace.sidebarWidth`: the signal moves at pointer
speed and the file is written once the drag settles (400ms), so a drag is one
write rather than one per frame. `REFERENCE_WIDTH` in `src/app/settings.ts`
holds the default and the range a drag may reach. It is a preference and not
session state, because reading beside a source is how a translator works all
day and re-making that decision on every navigation is the kind of small tax
that makes a pane not worth opening.

**Collapsed** is the state with nothing bound: the panel takes a fixed narrow
basis (`13rem`), the handle is hidden, and the editor takes the row back with
an inline-beating `grow!`/`[flex-basis:auto]!`. Both the panel and the handle
stay MOUNTED for the reason the sidebar's do — `Resizable` registers panels
during render and has no unregister, so an unmounted panel renumbers the split.
The route learns the count from the column's `onBound` callback rather than
asking the Library a second time: the split is the route's, so the route is
told.

The panes themselves are remounted rather than reconciled whenever the binding
set or the open book changes (`<Show keyed>` over the entries array), which is
the same constraint said once more — a panel list that changes length has to
be a new split, and each of those changes is already a reason to rebuild every
pane.

The chrome's own preferences, all declared in `src/app/settings.ts`:
`workspace.sidebarOpen` (the reader's toggle), `workspace.sidebarWidth` and
`workspace.referenceWidth` (fractions of their row, written once the drag
settles); `shell.theme`,
`shell.fontSize` and `shell.zoom`, applied to `<html>` by
`src/app/ui/theme.ts`; `editor.fontSize`, the scripture column's own size,
applied by the same module as `--editor-font-size` and kept live by a fiber
over `settings.changes` in `ProjectContext`; and `shell.recentProjects`, the
root → ISO-8601 record the sidebar and the landing screen share; and
`workspace.lastLocation`, above.

`shell.updateAvailable()` is one `Updater.check()` per session, on the desktop
host only, five seconds after the shell is built. The sidebar footer reads an
answer rather than asking one, which is what keeps a footer from making a
network request per render.

## The findings panel's filter

`/findings` renders the whole project's findings through a filter the reader owns. The policy is pure and lives in core (`src/core/findings/filter.ts` — `applyFilter`; see [findings](findings.md), "Filters and views"); the shell holds only the state and the chips. `src/app/ui/FindingsFilters.tsx` carries both halves of that state deliberately: `createFindingsFilter(services)` owns the value — seeded from `Settings.get`, written back through `Settings.set` on every click, kept live by a fiber over `settings.changes` like `editor.preferChapterView` — and `<FindingsFilters>` is the chip row that edits it, so the list, the counts and the keyboard cursor cannot disagree about what is being shown. Severity, producer and "hide stale" persist as `findings.filter`; the text box, the book selection and the view (by book, by code, by severity, flat) are session signals. The key is a `Schema.Struct`, and `/settings` draws one widget per `kind`, so it is registered in `shellKeys` but left out of `shellSettings` — the panel is its only editor. The route's `j`/`k`/arrows/Enter cursor is **local to the route** and honours the filter, while the shell's own findings cursor (`shell.finding`, `editor.findings.next` in the palette) still walks the unfiltered project: sharing one cursor would make a palette command jump according to a filter it never mentioned, and keeping them apart needs no change to `ProjectContext`.

## Commands

`src/app/commands.ts` holds the registry (`registerCommand`, `runCommand`, `commands()`), a `Mod-`-chord matcher on the document, and the core set. Each command has at least three callers — a button, a keystroke, and the palette — and `when()` is the "is this possible now?" question asked once. Commands reach the application only through `ShellBridge`, which is the honest list of what a command needs; a command that wants something not on it is telling us the shell owns state it has not admitted to owning.

An Effect-returning command is run on the app runtime by the runner `registerShellCommands` installs.

`runCommand(id, argument?)` passes the argument straight to `run`. Almost nothing reads it; `project.rename` does, because the dialog that would ask for a name is another slice's surface and renaming a project to something nobody typed is not an option. Pressed with nothing, it says so.

**The editor's chords are bound twice.** `editor.insert.verse` / `.paragraph` / `.poetry` / `.footnote` are registered here with `Mod-Shift-v/p/l/n` *and* inside CodeMirror's own keymap (`usfmKeys`), because an insertion needs the caret. The document listener skips an event the editor already consumed (`event.defaultPrevented`), so a chord fires once. The footnote is `Mod-Shift-n` — for **n**ote — and not `Mod-Shift-f`, which is `search.open`: one chord meaning "footnote" inside the editor and "find in project" outside it is two commands wearing one press. `editor.frontmatter.edit` has no chord and focuses the front matter card's first field. See [the editor](editor.md), "Structured entry".

`format.book` and `format.project` apply Onion's own whole-book transaction through `Fixes.formatBook`/`applyFormat` — see [findings](findings.md), "Format". `format.project` is the shell's only `MultiBook`: one instance over a thunk of the project's books, so the cross-book Undo offer has somewhere to live.

## Routes and tokens

`/projects`, `/start/create`, `/start/find`, `/project/$id`, `/project/$id/book/$book`, `/find`, `/findings`, `/history`, `/inventory`, `/settings`, plus `/` and the dev-only `/dev/fixture`. `/find` owns its search params (`q`, `mode`, `scope`) and derives its whole state from them, so a link into it from the rail or the toolbar changes the screen that is already mounted. The rail and the toolbar also point at `/terms` and `/compare`, which are being built alongside the chrome; until they land the router answers them through the root's not-found boundary. File routes under `src/routes`; `src/routeTree.gen.ts` is generated — never edit it.

`src/app/ui/tokens.css` is the design system as plain custom properties, ported from the v1 editor's vanilla-extract contract so the two read as one product, and it is also the Tailwind v4 configuration: an `@theme` block mints a utility from every semantic name. Components use the semantic names (`bg-surface-primary`), never the ramps. Dark is a token swap under `[data-theme="dark"]` and `prefers-color-scheme`, never Tailwind's `dark:` variant. The reusable components live in `src/app/ui/primitives/`, which is the only place corvu is imported. `src/app/ui/app.css` is the one global stylesheet and holds only the `<body>` ground and the CodeMirror frame. See [the UI layer](ui.md).

Every user-visible string goes through `t()` (`src/app/i18n.ts`) — an identity with `{param}` interpolation. The point is the seam; Lingui replaces the body later.

## What is stubbed

- **Opening an arbitrary folder on the Web host.** `WebDialogsLive.pickFolder` returns a picked handle's *name*, not a path the OPFS layer can read. `/projects` lists the OPFS subtree Sefer owns and says so.
- **Drafting** (`src/app/workflows/drafting.ts`) and **STET** (`src/app/workflows/stet.ts`) are typed stubs that `Effect.die`. Each file's header says what it composes and why the missing piece is domain vocabulary rather than code.
- **Restoring a previous version.** `/history` shows a commit's bytes read-only; loading one into a Book is an edit and needs a diff and a confirmation.
- **The inline linter and its gutter**, for a reason outside the shell: the installed `@codemirror/lint` resolves its own copy of `@codemirror/state` (6.5.2) while the app uses 6.7.4, so `usfmLinter()`'s facets come from a different module instance and CodeMirror answers "Unrecognized extension value in extension set". Adding `resolve: { dedupe: ["@codemirror/state", "@codemirror/view"] }` to `vite.config.ts` fixes it (verified), after which `usfmLinter(), lintGutter()` can be appended to `mountable` in `src/app/services.ts`. The duplication affects `src/editor/recipes/lint.ts` for anyone who mounts it, so the fix belongs in the build config.
- **Scrolling to a target in an un-clipped book.** `shell.aim` and `shell.reveal()` carry the offset a
  finding or a search hit named, and `focus` already uses it to choose the opening chapter when chapter
  view is on. With chapter view off nothing scrolls to it yet: the scroll belongs in
  `src/app/ui/BookEditor.tsx`, the one component that holds the `EditorView`.
- **Settings enumeration.** `SettingsService` has no "list every registered key" — a key belongs to the module that declared it. `src/app/settings.ts` is the shell's own set, and `/settings` renders exactly those.
