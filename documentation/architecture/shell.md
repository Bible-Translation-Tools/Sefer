# The application shell

The shell is the Solid layer above every module: it composes their Layers once, offers their operations as commands, and renders thin screens over them. It owns no domain logic — every screen is a synchronous read of something a module already holds, plus a button that calls back into it.

## Services: one composition, one file

`src/app/composition.ts` owns boot and Observability and stops there (see [composition](composition.md)). `src/app/services.ts` is the next ring out: `composeServices(composition)` merges the host's capabilities — the Web Layers, or on desktop the Tauri Layers loaded by dynamic import so a Web bundle never fetches `@tauri-apps/*` — and every core module over the built composition and returns plain service values plus `run(effect)`.

Wiring facts that carry meaning, not taste:

- `run` provides the **application** scope (`runtime.scope`). `openProject` and `ProjectAnalysis.attach` require `Scope`; a per-call `Effect.scoped` would close the project the instant the call returned.
- `RecoveryLive` is provided **to** `SaveCoordinatorLive` (`Layer.provideMerge`). Save reads Recovery through `serviceOption`, so it only journals when Recovery is in its own context.
- The Save hasher is built with `Layer.unwrap` over `Galley`: the book hash is the engine's, and the hasher is a function that needs the built engine.
- `Observability` is merged back over the modules (`provideMerge`, not `provide`) because `run` may ask for the ring itself.
- The `seat` (`src/app/services.ts`) is how a plain Book becomes an `EditorBook`. It records each one it makes, which is how the shell reaches an `EditorBook` from a `Book` port with no type assertion. It gives each book a fresh `galley.memoize()`, and adds the **mountable** half of the editor (`commandsLayer`, `viewLayer()`, `usfmLinter()`, `lintHoverGrace()`, `findingMarks()`, `noteEditing()`) so a view can be constructed straight over `book.state`.
- Composition **rejects** if the engine will not load. There is no useful Sefer without Galley, and `ShellGate` renders that failure instead of an editor that refuses every parse.

`?fixture=1` composes over the seeded `fixtures/small-nt` memory FileSystem instead of OPFS — the shortest route to a real project on screen. It is honoured in any build that carries the design surface (`__SEFER_DESIGN__`), so the deployed `dev` channel has it too.

## State: `src/app/ProjectContext.tsx`

The open `Project`, the focused book, the mode (with `lineByLine`, the device setting `editor.lineByLine` that picks Line by line over Reading; [editor](editor.md#line-by-line)), the clipped chapter and the findings cursor live in one Solid context above the router. `ProjectContext.tsx` assembles it from parts in `src/app/shell/`: preferences and layout (`preferences.ts`), slugs (`slugs.ts`), the update check, the reader's place (`reader.ts`), the project lifecycle — open, close, the recovery offer, seat edits (`lifecycle.ts`) — and findings navigation (`findingsNav.ts`). TanStack owns navigation, not lifetimes: a route match is destroyed on every navigation, and a Project owns Book lifetimes.

`shell.unsaved(book)` reads that book's row of the save-state store: `unsaved` when Save holds a
baseline for it and `SaveCoordinator.dirty(book)` says the text differs. The row is computed when an
event names the book, never during a render, because `dirty` can cost an engine hash. A book opened from
disk has its baseline `adopt`ed at focus, so an untouched book never reads dirty ([save](review.md)).

`shell.place()` is where the reader is as an Address — the unit of the open book the caret stands in (`PSA 1:3`, `PSA 1` at a chapter's head, `PSA intro`) — read from ProjectAnalysis' held analysis over Location's `addressAt` when that analysis describes the book's current stamp, and holding its last answer while the analysis is a pass behind. It is a signal and deliberately not a `ShellEvent` variant (Will, 2026-10-12): it moves no Book. Resource panes follow it ([resources](resources.md), "Resource kinds"). `shell.resources` opens a resource's handle once, on first need, and releases every handle when the project closes, because a handle can be costly to hold and a pane is remounted on every pick.

The context carries a stable handle — `useShellState()` (always available) and `useShell()` (only inside a `ShellGate`) — because a Solid 2 context value is read when the provider is created and cannot be swapped later.

## The Solid/Book boundary

**One subscription per book, in `src/app/ui/BookEditor.tsx`, and nowhere else.** That component creates the `EditorView` over `book.state`, routes every transaction through `book.fromView`, and in its `book.changes` callback does three things: writes a stamp signal, hands the editor's own `Analysis` to `ProjectAnalysis.supply` (so a keystroke costs no second wasm call), and calls `shell.changed({ kind: "book.apply", books: [book.id] })`.

`changed` is the one door into the shell's stores (`src/app/shellStores.ts`). Each `ShellEvent` (`src/app/shellEvent.ts`, a closed union) names the books it moved; the coordinator recomputes those books' rows — save state, stamp, undo depth — and a Publication replaces the findings, the census and the inventory. Every derived screen reads a store row, so an edit in one book leaves every other book's readers asleep. No other component subscribes to a Book, and nothing outside that file holds text.

Mode and chapter are dispatched into the canonical state through a compartment. Neither is a document change, so `fromView` ignores them: a projection is presentation and a clip is a view choice.

## How a book opens: the whole book, unless asked otherwise

A book opens **whole** — one scrolling document, no clip. A book is one document, and chapter-at-a-time
is a way of reading it, not its shape; the editor's clip (`pickChapter`) is dispatched into the
canonical state through a compartment, so un-clipped is simply `null`.

`editor.preferChapterView` (default `false`, "Open books one chapter at a time" in Settings) turns
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
middle of a page and is centred, and a chapter is the first line you read.

The front matter is row 0 of the engine's chapter table and has no `\c` number. It is a real place —
the identification, the table of contents, the main title — so the grid and the outline both offer it
as **Intro**, and only when the book actually has any.

Findings and search navigate by URL, and the route that lands calls `focus(bookId)` with no offset. So
the offset is left on the shell first: `shell.aim(bookId, from)` records it, `focus` reads it to
choose the opening chapter, and `shell.reveal()` keeps it for the editor surface to scroll to.
An aim moves the caret there, unless it says `caret: "keep"`: a click in a reference pane
(`mountReference`'s `onPlace`) aims the book at the clicked verse's pair — the caret's pairing read
the other way — and only brings it into view, so the caret, and the pair the pane marks for it, stay
where the person is typing and nothing bounces back.

## Where you were: `workspace.lastLocation`

Opening a project lands on the WORK, not on a census. `workspace.lastLocation` is a preference keyed by
project root holding `{ bookId, chapter, at }`; `focus` and every chapter change write it (debounced, like
the sidebar width — a record rewrite per click is a file write per click), and two places read it:

- **`/project/$slug`** is not a screen: it forwards to the remembered book as soon as the project is
  open. The book is checked against the project first, so a book that has since been removed falls
  back to the project's first book rather than to a not-found; a project with no books says so. Every
  "take me to my work" — `/`, the app bar's home, `BackToEditor` — goes through this one route, so
  the decision is made once.
- **`BackToEditor`** uses it as the way back from a full-page screen (settings, findings, history,
  review), returning to the remembered book.

`chapter` is the CLIP and `at` is the chapter that was at the top of the viewport. Both are needed,
because a book opens WHOLE by default: a reader who had scrolled down to Psalm 3 had a clip of `null`
and came back to the top of Psalms, which is landing on the right book and the wrong place.
`BookEditor` writes `at` through `shell.noteChapterAtTop`, from the one `watchLocation` subscription
the location bar already has — the shell keeps no viewport state of its own, because a viewport is a
fact about a view and two views over one book may honestly disagree. On open, `focus` scrolls that
chapter's `\c` anchor to the top, or clips to it when `editor.preferChapterView` is on.

An AIM still wins over a remembered place, because a finding or a search hit is a request and a
remembered scroll position is only the absence of one — but an aim is answered ONCE, so re-opening the
book an aim had named lands on the remembered place. A place still on its way counts as a request too: the
palette, a chapter tile and a link go through `showReference`, which leaves the place pending until the
book is open, so `shell.resumePlace(book)` — what `BookEditor` asks on mount — answers nothing while an
aim OR a pending place names the book. Without that, going from Settings to "Psalms 3" in the last book
remounted the editor at the remembered Psalm 2, and its next-frame re-scroll landed after the jump.

## The way back: `editor.back`

Every full-page route — findings, history, review, suggestions, find, inventory — replaces the editor
entirely. The way back is `src/app/ui/workspace/BackToEditor.tsx`, in two pieces: `useBackToEditor()`
is the behaviour, and `<BackToEditor />` is the default UI for it, a `data-testid="back-to-editor"` ×
button naming the book it returns to, with no position of its own.

The hook answers `undefined` off a project's routes (asked of the route, `useScreen().inProject`, never
of a pathname), so the projects list has no door; the app bar's Home is the way back from there.
Settings, under `/project/$slug/settings`, is a project route and has one. Inside them it answers the label and a `go`, and registers the `editor.back` command, so
the palette lists it on any screen that draws the door — registered there and not in the shell's core
set, because "is this a full-page screen" is the ROUTE's question and `ShellBridge` deliberately
carries no pathname.

A screen puts the button where it wants it. By default every page-level `PanelHeader` ends with it:
the `_app` layout hands `PanelHeader` the button through the `PageDoor` context, so a screen added
later still gets a door without knowing it exists. `door={false}` opts a header out, for a screen that
places it itself; a header that is not a `PanelHeader` (Review's) places it directly. It sits in the
header, so it scrolls with a screen whose header scrolls. All three doors navigate to `/project/$slug`, which forwards to the
remembered book, so they cannot disagree.

`editor.back` has no key. Escape belongs to whatever dialog is open on the screen (the Findings
search dialog closes on it), and a full-page screen closes only through its X button.

`installCommandKeys` skips a binding with no modifier while the reader is typing into an input, a
text area or a contenteditable — which is what `.cm-content` is, so the editor and the palette's own
search box are covered by one rule. Every other binding holds Mod, so the rule costs them nothing.

The recovery banner is mounted on the book route as well as the project route, for the same reason:
unsaved work found on open is the first thing to answer, and the project page is not where an open
lands.

## The workspace chrome

Three components, in `src/app/ui/workspace/`, and one rule between them: the
APP BAR answers "where in Sefer am I", the SIDEBAR answers "where in this project
am I", and the TOOLBAR answers "what am I looking at".

**Where the chrome is mounted is itself the rule.** It lives in
`src/routes/_app.tsx`, a PATHLESS layout, and a screen wears the frame exactly
when it sits under that layout — which is every route file under
`src/routes/_app/`. `_app` is part of the route ID and absent from the URL, so
`/projects` is still `/projects`; a comparison against `routeId()` has to say
`/_app/projects`, which is the one thing that changes for a caller.

`/design` is outside it on purpose: a designer judging a prototype must be able
to see it without this frame, and "is this screen inside the application frame"
is a structural fact rather than a query parameter somebody can mistype.

What `__root` keeps is what every screen needs whatever its frame: the head,
the one `<ProjectProvider>`, the theme side effect, and the design annotator.
A prototype outside the layout still has services, a theme and the comment
panel — but not the app bar, and not `installCommandKeys`, so it does not answer
the application's Mod-K for an application it is not part of.

- **`AppBar`** (`src/app/ui/workspace/AppBar.tsx`, testids `app-bar-*`) is permanent: a 72px bar across the top of the window in the
  theme's own surface (`surface-primary`, a hairline under it). Left, the mark
  and name — the Home button; centre, the two modes (Refine, Key terms) as a 48px
  `SegmentedControl` (`md`, `iconsWhenNarrow`), which drop to icons below `md`;
  right, 48px icon-only buttons. Everything on it is lit from the `pathname`,
  not from a signal, and every button but three is a plain navigation.
  **Sync** is the first row of the More menu, with a project open
  (`createSync`/`SyncPopover` in `cloud/SyncButton.tsx`, `app-bar-sync`): the
  row names where the project stands with the shared project, from the
  application's one sync reading (`syncWatch`), quiet until something waits on
  a person and with a popover where sync is done ([sync](sync.md), "One
  reading for every surface").
- **The project panel's show/hide** is not on the app bar. It is one button at
  the top of the panel itself (`SidebarButton`, `panel-toggle`, `book-fab`
  while hidden), on every project screen, named for what the panel holds
  (`claimSidebar`'s `show`/`hide`, else "books"). Hidden, the panel folds to a
  rail as wide as the button rather than going, so nothing floats over the page.
  Because the rail stays, it is also the way back. `Mod-b` does the same, and
  dragging the panel's edge well past its minimum closes it
  (`Resizable.Panel`'s `onCollapse`), keeping the width it had.

  The modes (Refine, Key terms) and the project screens (Character
  inventory, Compare — which goes to `/project/$slug/review` — and Cloud)
  appear only while a project is open: each is something you apply to a
  project, and offering one with nothing open is an affordance that answers
  nothing. The USFM mode is the Toolbar's Mode control, not a tile. Key terms
  goes to **`/project/$slug/terms`** — its own pane, because Find and Key terms
  are separate routes with similar UI rather than a mode toggle on one screen
  ([design direction](design-direction.md), gap list 5). Projects, Findings and
  History are always offered, and Settings whenever a project is open (it lives
  under one, and is disabled with none); Projects is lit on `/start/*` as
  well as `/projects`, because bringing a project in is the chooser's second
  half and `ProjectSidebar` reads the same two prefixes.

- **`ProjectSidebar`** is the book list and each open book's chapter grid —
  the one place a chapter is chosen. There is no chapter `<select>` on the
  editor page. It marks nothing about findings for now: the review pill and
  the red dots that replaced it were taken out until what a mark there means
  is decided. With no project open there is nothing to list, so
  `shell.sidebarShowing()` is false and the panel is off screen (`/`'s
  `EmptyWorkspace` draws its own, with the empty message). That is separate
  from `shell.sidebarOpen()`, which stays exactly as the reader left it.
- **The sidebar is a slot.** A screen whose job is a list of places claims it
  for as long as it is mounted (`claimSidebar` in
  `src/app/ui/workspace/sidebarSlot.ts`; the last claim wins and releasing
  restores the one before), and `ProjectSidebar` is what shows when nobody
  has. Find, Key terms and Findings claim it through `ExcerptList` for their
  results outline (`ResultsOutline`): one row per section with its count, and
  under a book its hits reduced to chapter tiles. On those screens the reader
  is navigating the results, not the project, and an outline column inside the
  page beside a book list outside it was the same answer in two columns. With
  the sidebar hidden, the list draws its own narrow column instead.
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

### The book screen

`src/routes/_app/project/$slug/book/$book.tsx` draws one white surface: the
toolbar, then the editor in its outlined panel (`EditorPanel`), whose action
bar holds "Show reference" on the left and the One chapter switch
(`editor.preferChapterView`, applied at once by `setChapterScope`) on the right.
The view is chosen elsewhere: Refine or Form Mode (line by line, design builds
only) in the app bar's mode control, and USFM as a switch in the editor's own bar, beside One chapter. The editor has no location strip of its own:
the project panel's chapter grid is the way between chapters.

**Joined** (the default) only the heart language is on screen. **Split**
(`workspace.referenceSplit`, remembered) puts the reference beside it as a
second `Resizable.Root`: `ReferenceColumn` straight on the page, under one
split dropdown — the language on the left, the text in it on the right — then
an edge handle that is the editor's own left border. Each text in it is a
read-only `EditorView` over the same book (see [resources](resources.md), "A
reference is a read-only editor, not a card"). "Show reference" is the only
way to show or hide it.

The width is `workspace.referenceWidth`, a fraction of the editor row, with
the same discipline as `workspace.sidebarWidth`: the signal moves at pointer
speed and the file is written once the drag settles (400ms), so a drag is one
write rather than one per frame. `REFERENCE_WIDTH` in `src/app/settings.ts`
holds the default and the range a drag may reach. It is a preference and not
session state, because reading beside a source is how a translator works all
day and re-making that decision on every navigation is the kind of small tax
that makes a pane not worth opening.

**No aligned scrolling on the book page.** The route provides
`AlignedProvider value={null}` — none, said explicitly: each side scrolls on
its own, and the reference catches up when the reader clicks in the heart
language, through the caret's paired-verse reveal. `createAlignedGroup` is
still what Review's Whole book uses for its two panes, over the shared
`LocationStrip` and `Crumbs` (`src/app/ui/workspace/Crumbs.tsx`).

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

`/findings` renders the whole project's findings through a filter the reader owns. The policy is pure and lives in core (`src/core/findings/filter.ts` — `applyFilter`; see [findings](findings.md), "Filters and views"); the shell holds only the state and the chips. `src/app/ui/panels/FindingsFilters.tsx` (with `panels/findingsFilter.ts`) carries both halves of that state deliberately: `createFindingsFilter(services)` owns the value — seeded from `Settings.get`, written back through `Settings.set` on every click, kept live by a fiber over `settings.changes` like `editor.preferChapterView` — and `<FindingsFilters>` is the chip row that edits it, so the list, the counts and the keyboard cursor cannot disagree about what is being shown. Severity, producer and "hide stale" persist as `findings.filter`; the text box, the book selection and the view (by book, by code, by severity, flat) are session signals. The key is a `Schema.Struct`, and Settings draws one widget per `kind`, so it is registered in `shellKeys` but left out of `shellSettings` — the panel is its only editor. The route's arrows/Enter cursor is **local to the route** and honours the filter, while the shell's own findings cursor (`shell.finding`, `findings.next`/`findings.previous` in the palette) still walks the unfiltered project: sharing one cursor would make a palette command jump according to a filter it never mentioned, and keeping them apart needs no change to `ProjectContext`.

## Commands

`src/app/commands.ts` holds the registry (`registerCommand`, `runCommand`, `availableCommands()`, `findCommand(id)`), a `Mod-`-chord matcher on the document, and the core set. Each command has at least three callers — a button, a keystroke, and the palette — and `when()` is the "is this possible now?" question asked once. Commands reach the application only through `ShellBridge`, which is the honest list of what a command needs; a command that wants something not on it is telling us the shell owns state it has not admitted to owning.

An Effect-returning command is run on the app runtime by the runner `registerShellCommands` installs.

`runCommand(id, argument?)` passes the argument straight to `run`. Almost nothing reads it; `project.rename` does, because the dialog that would ask for a name is another slice's surface and renaming a project to something nobody typed is not an option. Pressed with nothing, it says so.

**The editor's chords are bound twice.** `editor.insert.verse` / `.paragraph` / `.poetry` / `.footnote` are registered here with `Mod-Shift-v/p/l/n` _and_ inside CodeMirror's own keymap (`usfmKeys`), because an insertion needs the caret. The document listener skips an event the editor already consumed (`event.defaultPrevented`), so a chord fires once. The footnote is `Mod-Shift-n` — for **n**ote — and not `Mod-Shift-f`, which is `search.open`: one chord meaning "footnote" inside the editor and "find in project" outside it is two commands wearing one press. `editor.frontmatter.edit` has no chord and focuses the front matter card's first field. See [the editor](editor.md), "Structured entry".

## Tutorials and workflows: `src/app/tour/`

A tutorial is a list of steps run by one small machine (`machine.ts`), and the same machine is meant for workflows that drive the UI. A step is `go` (take the app there: navigate, run a command, scroll), `ready` (wait until it can be shown; by default, until its anchor is on screen; polled every 100 ms, so it reads a signal or the DOM alike, and gives up after 10 s, or the step's own `timeoutMs` for one that waits on the network, with a card that says so), and an effect: for a tutorial, a **spotlight**, a ring around an anchor and a card of explanation beside it. It then moves on when the person presses Next, or when its own `advance` condition holds. Every card has Back, Next (Done on the last) and Skip; Esc dismisses at any point.

**Tutorials fail open.** They are written against screens that are still being redesigned, and nothing at build time can tell that a selector or a route a step names has gone. So nothing a step does can stop the tutorial or the app: a `go`, `ready` or `advance` that throws (an anchor that is no longer a valid selector, a route that moved) is caught and counted as not ready; a step that is never ready times out to a card that says the app has probably changed, where Next skips it; an anchor that vanishes after its step showed leaves the card in the middle of the screen instead of taking every control away with the ring. Each miss is a failed `tour.step` event with `tour.id`, `tour.step` and `tour.anchor`, so `__sefer.observability.failures()` names the tutorial and step that drifted. Checked by breaking three steps of the findings tutorial on purpose (a throwing `go`, an invalid selector, a missing element): all three were recorded, and the tutorial ran to the end.

Steps reach the app through `TourContext` (the shell, `navigate`, `runCommand`) and through the DOM. No screen knows a tutorial exists beyond carrying a stable handle: `data-testid` where one exists, else `data-tour="…"` (the findings filters carry `data-tour="findings-filters"`). No state is lifted for a tutorial's sake; a step that has to ask the DOM is a hint that the state could be lifted later.

`TourOutlet.tsx` is mounted once in the `_app` chrome, so a tutorial can cross routes; it draws the ring and card and registers a palette command per tutorial ("Start tutorial: …"). A tutorial also starts from the URL: `?tour=<id>` on any screen, which is then taken off the address. It waits on `/r/…` (the share link hands its query on) and until the open project is the one the URL names (arriving from another project, the old one is still open for a moment and a step's `go` would navigate inside it), so `/r/owner/repo/book/JUD?tour=findings` opens the project and then starts. Settings lists every tutorial on its own tab, `/project/$slug/settings?tab=tutorials` (Preferences is the default and carries no `?tab=`). A tutorial written over one particular project names a `start` path, usually a share link; Start and the palette go there with `?tour=<id>` added (`beginTour`), so it opens, or downloads, that project first. Each tutorial is one file in `tours/`, registered in `tours/index.ts`; its strings are raw and translated where they are drawn, as Settings' group titles are, so a translation catalogue covers them with nothing tour-specific.

Five so far, all `audience: "internal"`, so only design builds carry them ([interface language](i18n.md)). **Translation Notes** (`tours/notes.ts`, six steps, needs no project) starts on `/projects` and goes straight to the Bisa Bible (the projects page's Notes section and its two download steps went 2026-10-15): the Bisa Bible opened through its share link with `host=` named (downloaded first where it is not on the device), choosing Translation Notes in the reference column (downloading English from Reference material › Translation Notes the first time), putting the caret in a verse, the notes following it to another verse (both steps advance on the notes pane's own `data-place`), and Find's **Search Translation Notes**. Its menu step anchors the whole reference column with `side: "right"`, so the card sits beside it: a card below the menu's button covered the menu it asked the person to open. Run end to end from a fresh browser profile on real OPFS, 2026-10-12, with no `tour.step` failure. **Working through findings** (`tours/findings.ts`, six steps): the bell, the Findings screen, its filters, a finding card, walking the list from the keyboard, and Alt+F8 from the editor. **Expect: catching spelling slips (Bisa demo)** (`tours/expect.ts`, nine steps) starts at `/r/Will_Kelly/leb-x-bisa_reg/find?q=Jesus&scope=reference`: Find in the English source, the count, turning on the Expect switch, typing the expected "Yesu", the split, the slips at Matthew 27:58 and John 14:6, a deliberate pronoun at Matthew 8:16, and that it works for any settled rendering ([search](search.md), "Expect"). Its steps reach a card through the results outline's chapter chips, because the list is virtualised and a card exists in the DOM only once scrolled to. **Marking findings fine, and approving key terms** (`tours/suppressions.ts`) walks the suppressions ([findings](findings.md#suppressions-this-is-fine)). **Line by line** (`tours/lineByLine.ts`) walks that view ([editor](editor.md#line-by-line)): the view control, Enter, Shift+Enter and Tab, what it keeps safe, and a verse number's menu; on the fixture it opens BAD chapter 2, the synthetic cases (`/project/small-nt/book/BAD?fixture=1&tour=line-by-line`).

### Workflows

A **workflow** is the same machine driving work rather than explaining a screen (`kind: "workflow"`). Its `steps` is a function, run when it starts, so its steps are the project's state at that moment; `startable` lets it wait (up to the step timeout) for that state to be ready first. A workflow step shows a **panel**, a card docked in the corner with no ring and no dimming, because the person is working in the screen underneath, and its buttons say Skip and Stop. A panel may carry **actions**, buttons that do the work (a label that answers undefined is not drawn, and it is read reactively). A step's `done` says the work looks finished: the card then says "Looks fixed" and Next replaces Skip, and it WAITS. It never moves on by itself, because the moment a problem disappears is often the middle of an edit: in the first cut it advanced the instant its finding vanished, so a Backspace on a repeated "3" jumped to the next step before the "4" was typed (Will, 2026-10-12: jumpy).

Escape stops a tutorial, not a workflow: the person works underneath a workflow, where Escape closes the editor's palettes and popovers all the time, so a workflow stops by its Stop button; and an Escape something else already handled (`defaultPrevented`) stops nothing unless it came from the card. A start that waits on `startable` clears whatever ran before, so no frozen card is left on screen while it waits.

Workflows are listed on Settings' own Workflows tab (`?tab=workflows`), start from `?workflow=<id>` on any URL (the same handling as `?tour=`), and are in the palette under their own name, not "Start tutorial: …", because a workflow is a thing to do.

The first is **Triage verse numbers** (`tours/verseNumbers.ts`): one step per finding about a verse number, Onion's (out of order, repeated, missing in sequence, no verse 1, no number, malformed) and Sous's comparison with the source text (missing, extra, empty), in canonical order. Each step aims the editor at the verse; once no finding with that code is left in that verse it says "Looks fixed" and waits for Next. The engine attaches no repair at these sites (the catalogue names one for `verse-duplicate` and `verse-out-of-order`, "renumber to the expected verse"; an ask for kitchen), so the workflow applies the catalogue's own answer from the finding alone: its span IS the verse number, and `Finding.expected` is the catalogue's `expectedNumber` aux, so **Renumber to 4** replaces the span with the expected number as one trusted edit (verse numbers are locked in the editor) and one undo step. Nothing reads the text to find the marker. It is offered only while the book is at the revision the finding was published against, as `Fixes.applyFix` refuses a stale fix. On the Bisa Bible's Numbers 25 and 27, eleven of the first twelve steps offer it; an extra verse offers nothing. It asks by ADDRESS, not by the finding's id, because the id carries offsets that any edit earlier in the book moves. It waits for the findings to settle before building its steps (not pending, and the same count for 2.5 s), because a project that has just opened publishes them in passes and `findingsPending` does not cover Sous's, which waits on the source text registering; without the wait a link straight into it built 97 steps of the Bisa Bible's 115. Checked on that project: 115 steps from Numbers 25:3; retyping the repeated `\v 3` there as `\v 4` held the step at "Looks fixed" through the Backspace and the typing, and Next moved to 25:4; Renumber to 4 did the same in one click. What counts as a verse-number problem is a first cut, and belongs to a Galley or Onion lint rule one day.

`format.book` and `format.project` apply Onion's own whole-book transaction through `Fixes.formatBook`/`applyFormat` — see [findings](findings.md), "Format". `format.project` and the every-book overlay run through the shell's one `MultiBook`: one instance over a thunk of the project's books, so the cross-book Undo offer has somewhere to live.

## Routes and tokens

Top level: `/`, `/projects`, `/settings` (a redirect to `/projects`: Settings live under a project), `/start/create`, the dev-only `/dev/fixture`, and `/design` (outside the `_app` chrome). Under `/project/$slug`: the index (a redirect to the work, above), `book/$book`, `find`, `findings`, `history` (`?review=1` redirects to `review`), `inventory`, `terms`, `review`, `suggestions`, `settings` and `playground`. Settings is under the project so reaching it never closes the project, and its Cloud section is that project's; the preferences on it are still the device's, for every project. The app bar's Settings is disabled with no project open. A project's slug is minted by `shell.slugFor(root)` and kept in the `projectSlugs` setting, so a bookmark keeps working (deleting a project forgets its slug, so an old link never opens a project made later in the same folder); slugs minted this session are also held in memory and read first by `rootForSlug`, because a setting only answers a new value once the settings file is written and a click mints and navigates in the same tick. `find` owns its search params and derives its whole state from them, so a link into it from the app bar or the toolbar changes the screen that is already mounted. File routes under `src/routes`; `src/routeTree.gen.ts` is generated — never edit it.

### Share links: `/r/$owner/$repo/…`

A slug is this device's name for a project, so it cannot be sent to anyone. A **share link** names the shared project instead: `/r/<owner>/<repo>/<place>?at=<commit>`, where `<place>` is everything after `/project/<slug>` (`/book/JUD`, `/terms?…`), `at` is the version the sender was looking at, and `host=` names the project's cloud, always: the sender's configured cloud says nothing about the receiver's (the dev channel's is WACS dev, production's is WACS), and a link that left it out for "the usual host" found nothing when opened on the other channel. A link without it is looked for on the receiver's configured host. `host=` is the bare host for the usual `https://<host>`, so every link made before still reads the same, and the whole base otherwise (`host=http://localhost:3000`, a Gitea served under a path with its prefix): a source is its base (scheme, host, path prefix) plus owner and repository, and two sources match on all three. The format is `src/core/project/shareLink.ts`; the device's half is `src/app/shareLinks.ts`; the route is `src/routes/_app/r/$owner/$repo/$.tsx` and its screen `src/app/ui/landing/OpenByLink.tsx`.

Arriving, the one question is whether this device holds a project whose `origin` is that shared project (`origin` is the shared project in both ways to work; [sync](sync.md)). Owner and repository compare without case, as Gitea does.

- **Held:** it opens at the same place under this device's own slug (the most recently opened copy, when the same shared project was downloaded twice). When `at` is given and HEAD is not that commit, a toast says how the copy stands: newer than the link, behind it, without that version, or (in a newest-only clone, which is how the Web clones) unable to tell. Without `at` there is no check.
- **Not held, and the host has it:** "Download" clones it as a project (`cloneArrival`) and then opens the place.
- **Not held, and the host does not answer for it:** the link cannot be opened here. Gitea answers 401 for a private project to someone not signed in, so "no project … that this device can see" covers both.

It never checks out the link's version: the copy may hold work of its own, and the sync popover is where it is brought up to date. **Copy a link to this place** (`project.copyLink`, in the palette) writes one from the address bar's place, the project's `origin` and HEAD. A project with no shared project has no link to share. The address bar keeps the slug form; a share link is only ever produced by that command. Desktop has no address bar to paste one into, and no `sefer://` scheme yet.

`src/app/ui/tokens.css` is the design system as plain custom properties, ported from the v1 editor's vanilla-extract contract so the two read as one product, and it is also the Tailwind v4 configuration: an `@theme` block mints a utility from every semantic name. Components use the semantic names (`bg-surface-primary`), never the ramps. Dark is a token swap under `[data-theme="dark"]` and `prefers-color-scheme`, never Tailwind's `dark:` variant. The reusable components live in `src/app/ui/primitives/`, which is the only place corvu is imported. `src/app/ui/app.css` is the one global stylesheet and holds only the `<body>` ground and the CodeMirror frame. See [the UI layer](ui.md).

**Waits look the same everywhere.** A pending route, the shell booting and a project or book opening all draw `DelayedSpinner` (`src/app/ui/primitives/DelayedSpinner.tsx`): blank for `PENDING_MS` (750ms), then a spinner, never a word. The router's `defaultPendingMs` is the same constant, but the component holds the delay itself, because a route chunk still loading suspends straight to the pending component without the router's timer.

New user-visible copy is a Paraglide message (`m.<id>()`); the old English-only `t()` (`src/app/i18n.ts`) goes screen by screen. See [interface language](i18n.md).

## What is stubbed

- **Opening an arbitrary folder on the Web host.** `WebDialogsLive.pickFolder` returns a picked handle's _name_, not a path the OPFS layer can read. `/projects` lists the OPFS subtree Sefer owns and says so.
- **Drafting** (`src/app/workflows/drafting.ts`) is a typed stub that `Effect.die`s. Its header says what it composes and why the missing piece is domain vocabulary rather than code.
- **Settings enumeration.** `SettingsService` has no "list every registered key" — a key belongs to the module that declared it. `src/app/settings.ts` is the shell's own set, and Settings renders exactly those.
