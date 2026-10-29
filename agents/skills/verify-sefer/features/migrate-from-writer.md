# Migrate from Writer

BTT Writer made one project per book, often several copies of a book by
different people. A person picks a language, Sefer opens and checks every
copy, they choose one per book (or let Sefer recommend), and **Assemble**
writes one project with every Writer save kept as a version, then opens it.
The project keeps following those Writer projects until told to stop.

## Sub-features

- `languages` the projects page's **Writer repos** lists languages with Writer projects; search by code or the start of a word in a name.
- `books` `/migrate` lists the language's books by testament, each marked checking, the owner, `choose · N`, or refused.
- `choose` a book's copies as rows (who, status, updated, health, passages that differ); a radio picks one; **Compare** reads two.
- `recommended` "Use the recommended one for N books": Primary, else newest Active, never Inactive.
- `assemble` "Assemble N books" writes the project and opens it.
- `history` History holds every Writer save that changed text, under its own author and date.
- `add-book` a project's Books → **Add a book…** opens the same screen for books it lacks.
- `follow` Settings → Writer projects: following, and **Stop following Writer projects…**

## How to get to it (user POV)

- Projects page → **Writer repos** (in "Projects Available on WACS") → a language row.
- Projects page drop zone → "import individual Writer projects".
- `/migrate` directly; `/migrate?language=<code>` lists that language's books on arrival.
- From a project: the sidebar's **Add a book…** (`/migrate?into=<root>`).
- Offline: on `/migrate`, **Folder of Writer projects** or **Zip of Writer projects**.

## Driving it with agent-browser

Preconditions:

- A `verify:launch` instance, a fresh `--session verify` (nothing on its
  storage), and the network: the Writer list comes from the Language API
  (`VITE_SEFER_CATALOGUE_URL` in `.env`) and the copies from WACS. No sign-in.
- `bwc` (Bwile) is a good language: 66 books, 26 with more than one copy.

- **Writer repos.** Open `<url>/projects`, then choose **Writer repos**
  (`find text "Writer repos" click`). `[data-writer-language]` rows appear.
- **Language.** Fill the search box with `bwc`; one row,
  `[data-writer-language=bwc]`, reads "bwc Bwile Southern Africa". Click it.
  The path is `/migrate`.
- **Books.** Wait until `[data-testid=migrate-summary]` stops saying
  "checking N more…" (about 25 s for bwc). It reads "26 books need a choice".
  Rows are `[data-testid=migrate-row-<BOOK>]`.
- **Choose.** The pane shows the first book needing a choice. Its rows are
  `[data-testid^=candidate-]`, each with a radio and a **Compare** button.
- **Recommended.** Click `[data-testid=migrate-recommended]`. It disappears,
  and the summary reads "66 books ready".
- **Assemble.** Click `[data-testid=migrate-next]` ("Assemble 66 books"). It
  reads "Writing N books' history…", then the path becomes
  `/project/<language>-<resource>/book/<BOOK>` (bwc: `/project/bwc-reg/…`, about 20 s).
- **Proof.** Go to `/project/<slug>/history`: `[data-commits]` is in the
  thousands (bwc: 8,777), the newest is the assembly, and older ones carry
  Writer authors and messages like "TIT 1:6–7". Settings shows
  `[data-cloud-card=writer]` ("66 books follow the BTT Writer projects…").
  `errors()` is `[]`.

## Gotchas

- Leaving `/migrate` abandons the run; there is no way back to the table
  once a language is picked.
- A second migration of the same language lands in `<name>-2`; the
  projects page then names the folder beside each card.
- The Language API lags WACS. A project too new for the list comes in
  through "Add a Writer project…" → From a URL.
- History's `[data-commits]` is `0` while the log loads; wait for a number.
- **Add a book…** is in the book sidebar, not on the History screen.

Last walked end to end: 2026-10-27, Web, `bwc`, through the "From BTT Writer"
tour on the `tutorials` branch. Not walked: folder and zip, From a URL,
Compare's reader, Add a book's write, Stop following, desktop.
