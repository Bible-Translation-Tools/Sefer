# The landing screens

Where a project comes from, and what each host can actually do about it. Everything here is `src/app/ui/landing/*` and the routes that mount it; the workspace itself begins once a project is open.

## The routes

| route | file | what it is |
|---|---|---|
| `/` and `/projects` | `src/routes/index.tsx`, `src/routes/projects.tsx` | both render `ProjectsLanding` — what is on this device, plus the three ways to add to it |
| `/start/find` | `src/routes/start/find.tsx` | the remote catalogue |
| `/start/create` | `src/routes/start/create.tsx` | the create form, which stops one step short of writing (below) |

`/` renders the landing rather than redirecting to `/projects`, because the composition reads `?fixture=1` off `location` before the router exists and a redirect that dropped the search would compose over OPFS instead of the seeded fixture. For the same reason every crumb and every tab switch passes `search: true`.

`ProjectsLanding` and `/start/find` share `LandingHeader`: the muted breadcrumb, then the two-way segmented control. The two halves are two ROUTES, not two signals — one lists this device and the other browses a service on the internet, and a reader who bookmarks the catalogue or presses Back should land where they expect. The trail ends in the tab, so it reads "Sefer / Projects / Find project" and the crumbs a screen passes are the ones ABOVE it.

The only state on the landing page is `reload`: a counter the import hub raises and `YourProjects` reads. That is the whole subscription between them — an import that finished shows up in the list without either component knowing what the other is. `YourProjects` keeps a second counter of its own for the writes it makes itself (a rename, a delete), read in the same effect.

Above the list sits the [recovery](recovery.md) banner, rendered only when a project is open and only when that project has work in the journal that never reached disk.

## Your projects

### The index

The table is drawn from `<projectsRoot>/.sefer/projects.json` — one row per project, `{ root, name, language, books, lastOpened }`, decoded through the Effect Schema in `src/core/project/projectIndex.ts`. One file read draws the whole screen.

The index is written at the moments a project's identity changes and at no other time: `recordProject` after an import or a clone, `touchProject` on open (beside the `shell.recentProjects` write the sidebar reads), `recordProject` again after a rename, `forgetProject` after a delete. It is then **assumed correct** — it is not a cache with an invalidation story, and nothing re-derives a row behind the reader's back.

What keeps it honest is `repairProjectIndex`, which costs one names-only `readDirectory` of the projects root: a folder with no row is described once (through `summarize`, below) and added; a row with no folder is dropped; a row whose folder exists is believed. Re-reading every project to check would be the rescan the index exists to avoid, and the cost of being wrong is a stale name until the next rename. A missing, unparsable or unknown-version index means the same thing to a reader — nothing is known — so the repair rebuilds it rather than the screen refusing to draw.

The seeded fixture is prepended to the list and written to no index: it lives in memory, per page, and a row for it would outlive the thing it describes. `.sefer/` under the projects root is the index's own home and is never listed as a project.

### Describing a project

`summaries.ts` answers what a row needs WITHOUT opening the project: opening one parses every book, seats it and attaches an analysis, and a list must not do that once per row. So it reads the two cheap things — the Burrito metadata (a name, a language) and a recursive directory listing (a `.usfm` count) — and degrades honestly: a folder with no `metadata.json` is still a project, and its name is its folder. `lastOpened` is the one field the filesystem cannot answer; it lives in the index, written BEFORE `open()` navigates — because a project you tried to open is one you were working on whether or not it opened — and falls back to the `shell.recentProjects` preference, which is still written for the sidebar and for rows an older build wrote.

A project whose metadata declares no language shows its folder id, muted, rather than a dash — the seeded fixture has no metadata at all, and a dash tells nobody anything.

### The kebab: rename, export, delete

Every row carries a kebab, and the three items are the `ProjectAdmin` calls that had no caller. The fixture has none: there is nothing on disk to act on, and a menu of things that would fail is worse than no menu.

- **Rename…** is `ProjectAdmin.rename`, which rewrites the burrito's `identification.name` in place (or `.sefer/project.json` when there is no burrito). It does NOT move the folder — that is a separate job with different consequences for open books and git remotes — so the root does not change, `shell.recentProjects` is keyed by root and has nothing to correct, and the dialog says as much. The index is re-read rather than patched, because a burrito rename may land in a different locale than the one the table displayed.
- **Export as zip** is `ProjectAdmin.archive`, handed to a download. Every entry sits under the project's own folder name, so the archive unzips to a folder and imports straight back through the zip card. Sefer's private files (`.sefer/`, a `.sefer-tmp` sibling, `.git`) are left out. The download itself is `src/app/ui/landing/download.ts`: one anchor with `download`, over an object URL. It is a download and not a save dialog because OPFS is Sefer's own storage that nothing outside the page can see, and the `Dialogs` port has no save picker to name a real path with — the day it grows one, `ProjectAdmin.export(root, "usfm-zip", picked)` is already the other half.
- **Delete…** asks with our own Dialog and passes the answer as the `Confirm` the port requires — the dialog IS the confirmation — then drops the index row and the preference entry.

`src/app/projectCommands.ts` registers `project.export` and `project.rename` against the same registry, and exports the plain functions the kebab calls, so a button does not have to go through the palette to do the same thing.

## Adding a project: what each source needs, per host

The rule the import hub is built around: a source this host cannot serve is rendered DISABLED with the reason in place of its explainer — never hidden, never offered-then-failed. `HostInfo.capabilities()` and `env` are asked before the button exists.

| source | web | Tauri | needs |
|---|---|---|---|
| Import zip | yes | yes | nothing: the archive is read in the page (`fflate`) and written into OPFS |
| Open folder | yes | yes | web copies the folder's files into its own storage; Tauri reads the real path |
| Clone from cloud | needs a proxy | yes | `VITE_SEFER_GITEA_WEB_HOST` (and `VITE_SEFER_GIT_CORS_PROXY_URL` for the web, whose fetches are cross-origin) |

Every source ends in the same pipeline — `stage → classify → commit` from `src/core/resources/import.ts`, run one step at a time so the dialog can name the step it is on. Nothing touches the project root until `commit`, so cancelling or failing leaves a staging directory and nothing else.

The two paths differ in the FIRST step only:

- **A native disk** hands back a real path, and `stage` copies it into staging.
- **A browser** has no path to hand back. `src/platform/web/intake.ts` is the bridge: it picks (`showDirectoryPicker` where it exists, a `webkitdirectory` input where it does not, a `.zip` input for an archive), reads the bytes, writes them into a fresh staging directory through the `FileSystem` port, and returns the same `Staged` value `stage` returns. `classify` and `commit` then run unchanged. It builds that value itself rather than calling `stage`, because `stage` copies with `FileSystem.copy` and the bytes are already in hand.

Intake also does the two things a picker leaves to its caller: it strips the one folder every entry shares (so a zipped `small-nt/…` classifies exactly as the folder `small-nt` does, with `metadata.json` at the root where the classifier looks), and it drops `__MACOSX`, `.DS_Store` and friends. It is reached through a **dynamic import**, so the zip decoder is fetched by the people who import something and never sits in the first load — and the desktop bundle never carries it at all.

The progress dialog counts files while the write runs, because an import of sixty-six books is long enough that a spinner is not an answer.

## Find project: the Catalogue port

`src/app/catalogue.ts` is a port in `src/app`, not a module in `src/core`, because it is not policy: it is one HTTP GET against a service Sefer does not own, and core may not name `fetch`.

`catalogueFor()` is the one place that decides the source. With `VITE_SEFER_LANGUAGE_API_URL` set it reads the Language API's consolidated-repos view; without it, it serves `SAMPLE_CATALOGUE` so the screen is real in development instead of empty. Either way the service says which one it gave you in `source`, and the screen shows that rather than implying live data.

The payload carries a code and a language name; it carries neither a region nor a date, so those columns print an em dash for a row that has none. Inventing a region would be worse than a blank column, and the day the API grows the fields the decoder reads them. `type` (translation or gateway) is derived from the owner — `wa-catalog` is the curated gateway set — and that mapping is stated in the port so the filter's meaning is readable rather than buried in a comparison inside a component.

Download reuses the clone flow: the catalogue row hands its `cloneUrl` to the same `cloneRepository` the import hub calls.

## Create project: where it stops, and why

`CreateProject` builds the Scripture Burrito metadata a new project WOULD have, decodes it through `src/core/resources/burrito.ts` — the same schema every reader in Sefer validates against — and shows the result. If the schema refuses, the form says why here rather than at first open.

It does not write. `ProjectAdmin` has `rename`, `delete`, `metadata`, `updateMetadata` and `export`, and no `create`; worse, `openProject` refuses a root with no books (`NoBooks`), so a project created from this form alone could not be opened until something put USFM in it. The missing piece is a decision about what an empty project contains — blank books for every selected id, or nothing until the first import — and that is domain vocabulary, not code.

So the seam is one TODO in `build()`, at the single line where the write belongs: one operation on `ProjectAdmin`, `create(root, metadata, books)`, that makes the directory, writes `metadata.json` atomically and seeds a book file per id in `currentScope`. Until it exists the primary button reads "Create (not available yet)" and is disabled with the reason beside it, and validating the metadata is the secondary action that does work. A form that looked like it saved would be the one unacceptable outcome.
