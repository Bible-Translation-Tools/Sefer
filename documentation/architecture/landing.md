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

The only state on the landing page is `reload`: a counter the import hub raises and `YourProjects` reads. That is the whole subscription between them — an import that finished shows up in the list without either component knowing what the other is.

## Your projects

`summaries.ts` answers what a row needs WITHOUT opening the project: opening one parses every book, seats it and attaches an analysis, and a list must not do that once per row. So it reads the two cheap things — the Burrito metadata (a name, a language) and a recursive directory listing (a `.usfm` count) — and degrades honestly: a folder with no `metadata.json` is still a project, and its name is its folder. `lastOpened` is the one field the filesystem cannot answer; it comes from the `shell.recentProjects` preference, which `open()` writes BEFORE it navigates, because a project you tried to open is one you were working on whether or not it opened.

A project whose metadata declares no language shows its folder id, muted, rather than a dash — the seeded fixture has no metadata at all, and a dash tells nobody anything.

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
