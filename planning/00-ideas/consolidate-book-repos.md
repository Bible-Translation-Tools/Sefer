# Consolidating single-book repositories (BTT Writer migration) (2026-10-02)

**Status:** an idea, nothing authorized. Written from Will's description and a
probe of the Language API and the content host for `bwc` (Bwile) on
2026-10-02. Related: [resource kinds](resource-kinds.md), import
(`src/core/resources/import.ts`), intake (`src/core/git/intake.ts`), the
catalogue (`src/app/catalogue.ts`), [Review](../../documentation/architecture/review.md)
and [Cloud sync](../../documentation/architecture/sync.md).

## The ask

BTT Writer made one repository per book, in its own chunked shape. Sefer only
works on spec-compliant Resource Containers and Scripture Burritos. Today
someone builds the consolidated repository outside the app (for example
`Tech_Advance/bwc_reg`, one standard USFM file per book, from repositories
such as `mary_chishimba/bwc_1jn_text_reg`) and throws the history away. The
request is to do that consolidation in Sefer.

Will's constraints:

- **The book is the atomic unit.** The join key is the three-letter USFM book
  code. Book ids in one project are unique.
- **Keep the git history, layered in.** Not submodules: reshape the files,
  concatenate the chunks, and carry the commits.
- **Don't shape the app around the old tool.** BTT Writer is something we read
  once, not a mode of Sefer.
- **The same operation in two sizes:** assemble N repositories into a new
  project, or import one book into a project that already exists.

## What the data actually says (probed 2026-10-02, `bwc`)

**Listing.**

- `language(ietf_code: "bwc").contents` has 110 rows. One is consolidated
  (`Tech_Advance/bwc_reg`, git topic `consolidated`). The other 109 are
  single-book repositories named `bwc_<book>_text_<resource>`, and together
  they cover 66 books.
- Each book has 1 to 4 candidates, from different owners: 37 books have one,
  17 have two, 10 have three, and 2 have four.

**Status** (`wa_content_metadata.status`).

- Across the 109 rows: Primary 65, Active 6, Inactive 38.
- Every book has exactly one Primary except Ezekiel, which has only an Active
  one. So Primary is _meant_ as "the chosen one per book".

**One query lists a language's books, and is small.** Filter the renderings
in the query rather than fetching them all. Leaving out consolidated repos and
asking only for whole-book USFM renderings returns exactly one rendering per
repository, carrying `book_slug`: 38 KB for all of `bwc`.

```graphql
content(where: {
  language: { ietf_code: { _eq: $lang } }
  git_repo: { _not: { topics: { topic: { name: { _eq: "consolidated" } } } } }
}) {
  name modified_on resource_type
  wa_content_metadata { status }
  git_repo { username repo_url }
  rendered_contents(where: {
    file_type: { _eq: "usfm" }
    scriptural_rendering_metadata: { is_whole_book: { _eq: true } }
  }) { modified_on scriptural_rendering_metadata { book_slug } }
}
```

**The join key is (language, resource, book), not book alone.**

- `felix_sichies` has both `bwc_col_text_reg` and `bwc_col_text_ulb`.
- One row (`bwile_refinement/bwc_1jn_text_reg`) has an empty
  `resource_type`. The repository name and `manifest.json` still say `reg`.

**Fetching. Build on git, not on the rendered files.**

- These are blocked: `read.bibletranslationtools.org/u/…/source.usfm` and
  Gitea's `/raw/`. Both answer a non-browser client with a Cloudflare
  challenge.
- Gitea's `/api/v1/repos/…/contents` answered.
- Neither is ours. The git transport the app already clones through is.

**BTT Writer's shape.**

- `manifest.json` holds:
  - `package_version: 6`
  - `generator: ts-desktop`
  - `target_language`
  - `project.id` (`1jn`)
  - `resource.id` (`reg`)
  - `source_translations`
  - `translators`
  - `finished_chunks`
- Each chapter is a directory `NN/` of chunk files `NN.txt` holding inline
  USFM fragments (`\c 1 \v 1 …`), plus `title.txt`. `front/title.txt` holds
  the book's title.

**History.**

- 31 to 81 commits per book, and the messages are timestamps (BTT Writer
  autosaves).
- `Moffat_chola/bwc_1jn_text_reg` and `bwile_refinement/bwc_1jn_text_reg`
  are copies, not forks (`fork: false`). They share the root commit
  `37de5738`, and both have 81 commits.
- `bwc_reg` has 7 commits. Its root is "initial conversion and cleanup"
  (2026-08-19), and the history before that was dropped.
- `bwc_reg` holds only the New Testament (41–67), although 39 Old Testament
  books have a Primary repository.

**Primary pointed at the wrong text, twice.**

- `Moffat_chola`'s 1JN and 1PE, both Primary, open with Jude 1:1 ("Yuda,
  umusha wakwa Yesu Kristu…"). So do `bwc_reg`'s `63-1JN.usfm` and
  `61-1PE.usfm`.
- `63-1JN.usfm` has 123 `\v` markers, with v8–v10 repeated, so it is Jude and
  1 John interleaved.
- `mary_chishimba`'s 1JN and 1PE were created 2026-10-01, are Active, and open
  with the right books.
- So for these two books the consolidated file came from the Primary
  repository, not from mary_chishimba's, and the status chose the wrong text.
- A consolidator that trusts status reproduces this. The checks below exist
  for this case.

## The model

**Book candidate.** One repository that offers one book, for one (language,
resource). It carries:

- book code, owner, git URL, status, last modified;
- after fetching: the commit count, the rendered text, and its health.

**Consolidation plan.** At most one candidate per book, plus the project
metadata. The plan is an Effect Schema value whose `books` is a record keyed
by book code, so "book id must be unique" is the type, not a check.

**BTT Writer as an import shape, not a mode.** It sits beside `burrito`,
`resourceContainer` and `looseUsfm` in `import.ts`'s `Classification`, plus a
listing source on the catalogue. After assembly the project is an ordinary RC
(or Burrito) project. Nothing downstream knows where it came from except the
commit trailers.

## User flow

**Entry points.** All three use the same screen.

1. **Projects page → Import → "Assemble from book repositories".** Pick a
   language, then a resource if it has more than one.
2. **In a project → Books → "Add a book from a repository…".** The same table,
   already filtered to this project's language and resource. Books the project
   already has offer **Attach history** (below) instead of Add.
3. **Later: "Updates in the original repositories".** Translators are still
   committing in BTT Writer (`mary_chishimba`'s 1JN had commits on
   2026-10-01). This is a banner with the same shape as the sync check on open,
   not a new surface.

**The table: one row per book, in canonical order, OT and NT.** It reuses
`BookScope`'s grouping.

- **Book:** its name in the language, from `front/title.txt` once fetched, and
  the code.
- **Source:** a single-select `MultiSelect` of the candidates (owner, status
  badge, last modified, commit count), plus "Leave out".
- **Defaults:**
  - the one Primary;
  - otherwise the newest Active;
  - a book with only Inactive candidates is left out, and the row says why.
- **Health,** filled in once the candidate is fetched and rendered:
  - chapter and verse coverage against the versification (e.g. "1 ch, 25 v —
    1 Peter has 5 ch, 105 v");
  - duplicate verse numbers;
  - Galley's own findings count;
  - **the same text under two books:** a candidate whose opening verses match
    another book's candidate gets "This text also appears as Jude". That
    single check catches the 1JN/1PE case above.
- **Compare candidates.** For a book with more than one candidate, open
  Review's reader with one candidate on each side. Review already treats both
  sides as pickers (the `CompareSource` port), so this is reuse, not a new
  diff screen.

**Order of the work.** The listing is cheap, so the table draws
immediately from the Language API. Fetching costs a clone, so it starts for
the default picks only, a few at a time, with per-row progress. A change of
pick fetches that candidate. Health fills in per row, and nothing waits on
the whole set.

**Metadata.** One form, prefilled, for whatever the output is (an RC
`manifest.yaml`, like `bwc_reg`'s `rc0.2`, or a Burrito):

- language and direction from the API and the manifests;
- resource id and name;
- contributors: the union of each manifest's `translators` and the commit
  authors;
- `source`: the union of `source_translations`;
- title, rights and issued date.

**Assemble.** This writes the repository (below), opens the project, and
runs Findings. History shows every book's own commits. Nothing is sent: the
new project sends through ordinary sync, to a repository the person names.

## Architecture

| Piece             | Where                                  | What                                                                                                                                                                                        |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Book listing      | `src/app/catalogue.ts`                 | `bookCandidates(lang)`: the query above, decoded by Schema into `BookCandidate[]`. A second request on the service we already use; no Gitea API.                                            |
| Shape             | `src/core/migrate/bttWriter.ts` (pure) | `BttWriterManifest` Schema. `recognize(tree)`: the manifest decodes and the chapter directories exist. `render(tree) → USFM`. Pure over a path→bytes read, so it runs on ANY commit's tree. |
| Probe             | the existing clone into staging        | Classification gains `"bttWriter"`. The catalogue's status and book slug are hints, and the decoded manifest is the answer: its `project.id` must equal the row's book, or the row says so. |
| Health            | `src/core/migrate/health.ts`           | Coverage against versification, duplicates and cross-book openings, over Galley's parse.                                                                                                    |
| Plan and assembly | `src/core/migrate/consolidate.ts`      | Plan Schema → an Effect over `Git` and `FileSystem` that writes the repository. Same port discipline as `intake.ts`.                                                                        |
| Screen            | `src/app/ui/migrate/`                  | The table, the metadata form and the progress. It reuses `MultiSelect`, `BookScope`, `ReviewReader` and `VirtualList`.                                                                      |

**Observability:** one operation per step:

- `migrate.list`, with books and candidates;
- `migrate.fetch`, per book;
- `migrate.render`, with commits and skipped;
- `migrate.assemble`.

A failed book ends `refused` for that row, not for the whole run.

### Rendering a chunked book to USFM

1. `\id`, `\ide UTF-8`, `\h` and `\toc1–3`, and `\mt` from `front/title.txt`.
2. Then each chapter in numeric order: `\c N` once (dropping the `\c` the
   first chunk repeats), `\cl` from the chapter's `title.txt`, then the chunks
   in numeric order.

Match the ecosystem converter that built `bwc_reg`, so our output equals what
people already have. One way to test that: render each Primary repository and
diff it against `bwc_reg`'s file. The diff should be empty apart from the
"Field updates" commits.

### Layering the history

For each chosen book:

1. **Walk its first-parent history**, oldest first.
2. **Rewrite each commit `C` as `C′`:**
   - its tree is just `NN-BOOK.usfm = render(tree(C))`;
   - its parent is the previous `C′`;
   - author, committer and both dates come from `C`;
   - the message is `C`'s, plus trailers:
     `Imported-From: <url>`, `Imported-Commit: <sha>`, `Renderer: bttwriter/1`.
3. **Skip a commit whose render equals the previous one** (manifest-only
   saves).
4. **Join the book to the project** with one arrival commit that has two
   parents, `[project tip, last C′]`. Its tree is the tip's tree plus the
   book's file, and the manifest updated.

A fresh assembly is a root commit (manifest, LICENSE) and then one arrival per
book, in canonical order. Importing one book into an existing project is the
same arrival on the current tip. **One shape for both sizes.**

**Why this shape:**

- **`git log -- 61-1PE.usfm` and blame see the book's whole life,** in the
  file's real shape, because each `C′` already holds that file.
- **No rebase, no force push.** The project's existing history is never
  rewritten; it gains a merge, as our decision commit already does.
  Interleaving every book's commits by date into one line would read better,
  but it is only possible for a fresh project, and it gives the two sizes
  different shapes.
- **Rewriting is deterministic.** The same source commits with the same
  renderer version give the same `C′` SHAs. Two copies of one history
  (Moffat's and bwile_refinement's 1JN) rewrite to the same commits, so
  nothing is duplicated.
- **Not submodules or a subtree merge.** Those keep the original SHAs but in
  BTT Writer's shape, so the file the project has would have no history.

**Attach history** is for books already present, like every book in
`bwc_reg`. It is the same arrival, except that its tree is the tip's tree
**unchanged**: the text stays as it is, and the history appears behind it.

- If the chain's last render differs from the current file, the row says by
  how much.
- That difference is the "Field updates" work, and it stays.

**Later updates.** Find the newest `Imported-Commit` trailer for that book in
our history. Rewrite only the newer source commits on top of the existing
`C′` chain (determinism makes the chain match), and arrive again.

- If our file changed since the last arrival as well, this is a text conflict.
- Text is never merged automatically (`sync.md`). The incoming text goes to
  Review's decision units, as sync's incoming plan does.
- This also means no state is kept beside the history: the trailers are the
  record, and `.sefer/` stays out of it.

## Risks and costs

**Cost on the Web.** About 66 books × ~50 commits ≈ 3,300 renders. Each
render reads a tree of maybe 60–200 chunk blobs.

- Memoize by blob oid (most chunks do not change between autosaves) and by
  chapter-tree oid. Desktop's git2 will not notice the load.
- Measure first. If it is still slow, the plan can carry **History: keep /
  latest only** per book, with keep as the default.

**Merges in the History index.** Our Web history index and
`log(filepath)` have to follow the second parent through an arrival
commit, or the layered history is invisible in History.

- Check this before anything else.
- The `UnsafeFilepathError` lesson applies: old repositories have odd tree
  entries.

**The renderer is a contract.** A renderer change changes every `C′` SHA,
which is why the trailer carries `Renderer:` and why an update rewrites from
the source rather than diffing renders.

## Questions for Will

1. **Output format.** RC (`manifest.yaml`, as `bwc_reg` and the ecosystem
   code write it) or Burrito, or the person's choice?
2. **Status.** Is Primary meant as the person's choice of candidate, or should
   Sefer only show it? The 1JN/1PE case argues for showing status and judging
   by the text.
3. **The converter.** Which ecosystem converter built `bwc_reg` (the tX
   pipeline, or something of Garry's)? `render` should match it, or say where
   it differs and why.
4. **Retiring the old repositories.** After assembly, should Sefer do
   anything to them (a topic, an archive), or is that not ours?
5. **Your message was cut off** after "…you can see this:". What was it going
   to show?
