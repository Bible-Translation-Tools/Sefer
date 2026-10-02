# Assembling a Bible from single-book projects (BTT Writer migration) (2026-10-02)

**Status:** idea, second pass. Will agreed the direction on 2026-10-02 (see
"Decided" below), and nothing is authorized to build yet. Written from Will's
description and a live probe of the Language API and the content host for
`bwc` (Bwile). The first pass covered one network source; this pass makes
folder, zip and network three sources behind one contract.

**This supersedes**
[WACS language downloads](../01-discussing/wacs-language-downloads-2026-09-24.md),
in both wording and plan. That note's catalogue half has shipped
(`src/app/catalogue.ts` is on GraphQL). Its legacy half is this note. It
parked rival copies in `.sefer/candidates/`; this note resolves them up front.

**Related:**

- [resource kinds](resource-kinds.md)
- import (`src/core/resources/import.ts`)
- intake (`src/core/git/intake.ts`)
- [Review](../../documentation/architecture/review.md)
- [Cloud sync](../../documentation/architecture/sync.md)

## The ask

BTT Writer made one project per book, in its own chunked shape. Sefer only
works on spec-compliant Resource Containers and Scripture Burritos.

Today someone assembles the consolidated repository outside the app, and
throws the history away. For example, `Tech_Advance/bwc_reg` is one standard
USFM file per book, assembled from repositories such as
`mary_chishimba/bwc_1jn_text_reg`. The request is to do that assembly in
Sefer.

## Decided (Will, 2026-10-02)

**The unit:**

- **The book is the atomic unit.** The join key is the three-letter USFM book
  code.
- **No Bible prints John twice.** Book ids in a project are unique, and that
  is the sanity rule everything else checks against.

**One operation, every source, two sizes:**

- **Two sizes of one operation.** Assemble N books into a new project, or
  bring one book into an existing project. Conceptually it is the same thing.
- **Offline first; the network is one more source.** A folder, a zip (made
  locally, or carried over Bluetooth or a USB stick), or a BTT Writer working
  directory has to work with no network at all.
- **The code path is shared.** Unzipping, or reading a folder, feeds the same
  rendering pipeline as a clone.
- **Keep the git history.** Wherever a source carries history, from the
  network or from a folder, layer it in. That means reshaping and
  concatenating the files, not adding submodules.

**What we read and what we trust:**

- **Don't build the app around the old tool.** BTT Writer is a shape we read
  on the way in, not a mode of Sefer. The verb is open: "migrate from Writer"
  is Will's working phrase.
- **Be lenient on `manifest.json`.** Don't fail on `package_version` or
  `generator`. Carry `source_translations` into the project, following the
  existing convention (below).
- **Trust the API, then check.** We expect the API to tell the truth ("this is
  John"). The same validation layer that checks a zip or a folder checks what
  we pull, and a candidate that turns out not to be one book of the claimed id
  is refused.
- **The whole Bible, not only the NT.** Show clearly which testament each book
  is in, but don't limit to one.

**Choosing between candidates:**

- **Hide the Inactive candidates by default.** Show Primary and Active where a
  book has more than one.
- **Primary means promoted.** It is the repository chosen for Bible in Every
  Language (BIEL). Nobody is sure what Active means.
- **Resolve the choice up front, before the editor.** The designer's "Choose a
  Repository" mockup is the starting shape, and the diff view helps the
  person choose.

**Checks:**

- **Health is coverage against the versification**, plus USFM checks only.
  Leave out the proofreading checks (Sous).

**The network as a tap, and sources as a prerequisite:**

- **The network as a "tap"**, in Homebrew's sense. It is a place that offers
  books, opt-in because it is network-heavy.
  - Mostly the consolidated project is the one place that matters.
  - During a migration, checking the tap for newer BTT Writer commits is
    useful, and those commits go through the same diff code.
- **Auto-pull source texts** that a project's manifest lists (below). This may
  come first, because it builds the resolver this plan also needs.

## What the data says (probed 2026-10-02, `bwc`)

**The listing:**

- **110 rows** for `bwc`. One is consolidated (`Tech_Advance/bwc_reg`, with
  the topic `consolidated`). The other 109 are single-book repositories named
  `bwc_<book>_text_<resource>`, and together they cover 66 books.
- **Candidates per book:** 37 books have one, 17 have two, 10 have three, and
  2 have four.
- **Status:** Primary 65, Active 6, Inactive 38. Every book has exactly one
  Primary except Ezekiel, which has only an Active one.
- **Across the API** (the 2026-09-24 note): of 862 non-gateway languages, 53
  have a consolidated repository and 809 do not. **Migration is the main case,
  not the edge case.**

**One small query lists a language's books.** Filter the renderings inside the
query, so it returns one whole-book USFM rendering per repository, carrying
`book_slug`: 38 KB for all of `bwc`.

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

**The key is (language, resource, book), not the book alone:**

- `felix_sichies` has both `bwc_col_text_reg` and `bwc_col_text_ulb`.
- `bwile_refinement/bwc_1jn_text_reg` has an empty `resource_type`, although
  its name and manifest say `reg`.

**Fetch through git:**

- The rendered `source.usfm` on `read.bibletranslationtools.org`, and Gitea's
  `/raw/`, both answer a non-browser client with a Cloudflare challenge.
- Gitea's `/api/v1/…/contents` answers, but rate-limits (HTTP 429).
- The git transport is the one we already clone through.

**BTT Writer's shape:**

- **`manifest.json`** holds:
  - `package_version: 6`
  - `generator: ts-desktop`
  - `target_language { id, name, direction }`
  - `project { id: "1jn", name }`
  - `resource { id: "reg" }`
  - `source_translations[]`, each with `language_id`, `resource_id`,
    `version` and `checking_level`
  - `translators[]`
  - `finished_chunks[]`
- **Each chapter** is a directory `NN/` of chunk files `NN.txt`, which hold
  inline USFM fragments (`\c 1 \v 1 …`), plus a `title.txt`.
- **`front/title.txt`** holds the book's title.

**The history:**

- 31 to 81 commits per book, and the messages are timestamps (BTT Writer
  autosaves).
- `Moffat_chola`'s and `bwile_refinement`'s 1JN are copies, not forks
  (`fork: false`). They share the root commit `37de5738`, and both have 81
  commits.
- `bwc_reg` has 7 commits, with the root "initial conversion and cleanup"
  (2026-08-19). It holds only the NT, although 39 OT books have a Primary.

**Primary points at the wrong text, twice.**

- `Moffat_chola`'s 1JN and 1PE are both Primary, and both open with Jude 1:1
  ("Yuda, umusha wakwa Yesu Kristu…"). So do `bwc_reg`'s `63-1JN.usfm` and
  `61-1PE.usfm`.
- `63-1JN.usfm` has 123 `\v` markers, with v8–v10 repeated: Jude and 1 John
  interleaved.
- `mary_chishimba`'s 1JN and 1PE were created 2026-10-01, are Active, and
  open with the right books.
- A tool that trusts status reproduces this. Every check below exists for this
  case.

### The existing convention: `bwc_reg`'s `manifest.yaml`

This is what the output should look like.

- **`dublin_core`:**
  - `conformsto: rc0.2`, `type: bundle`, `format: text/usfm`;
  - `identifier: reg`;
  - `language {identifier, title, direction}`;
  - `relation: [bwc/reg]`.
- **`contributor`:** a flat list, merged by hand from each book's translators
  (names, accounts and team lists, with duplicates).
- **`source`:** one entry per distinct source, as `{identifier: ulb,
language: en, version: 24-02}` and `{… version: 21-05}`. **Two ULB
  versions are kept, not chosen between.** That is the union of every book's
  `source_translations`, so the convention is: concatenate and de-duplicate.
- **`checking`:** `checking_level: '1'`. BTT Writer's `checking_level: "3"` is
  the SOURCE's level, not ours, so it does not carry over.
- **`projects[]`, one per book:**
  - `title` (from `front/title.txt`, e.g. "Yohane");
  - `identifier` (lowercase);
  - `path: ./44-JHN.usfm`;
  - `sort`;
  - `categories: [bible-nt]` or `[bible-ot]`;
  - `versification: ufw`.

## The contract: a book offer

The neutral shape is "here is a book, with its text and maybe its history". The
ecosystem-specific parts are only in who makes offers.

```ts
interface BookOffer {
  readonly book: BookCode; // claimed: from the manifest, or the API's book_slug
  readonly language: string;
  readonly resource: string;
  readonly origin: Origin; // { kind: "tap", tap, owner, repo, url } | { kind: "folder" | "zip", name }
  readonly hints: { status?: "Primary" | "Active" | "Inactive"; modified?: string };
  readonly open: Effect<StagedBook, OfferError>; // the bytes, and the history when there is any
}
```

**Three producers:**

| Producer   | How it makes offers                                                                                                                                | Network |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Folder** | A BTT Writer project directory, or many of them. BTT Writer's working copies carry a `.git`.                                                       | none    |
| **Zip**    | One zip, or several. Each entry is one project, or the zip is one project. The `.tstudio` backup is a zip; whether it carries `.git` is to verify. | none    |
| **Tap**    | The Language API query above, one offer per row. `open` clones into staging.                                                                       | yes     |

**One door after `open`.** Every offer goes through one recognizer and one
validator, wherever it came from.

1. **`recognize(tree)`** decides the shape. BTT Writer joins `burrito`,
   `resourceContainer` and `looseUsfm` in `import.ts`'s `Classification`.
   - For BTT Writer, it decodes `manifest.json` with a lenient Effect Schema.
   - It **requires** only `project.id` (the book), `target_language.id` and a
     resource id: `resource.id`, else the folder name.
   - Everything else is optional and carried along.
2. **`render(tree) → USFM`**, pure. It runs on any commit's tree, which is
   what makes layering the history possible.
3. **`validate(usfm, claimedBook)`** refuses the offer (that offer only, not
   the run) when:
   - the parse is not exactly one book;
   - the `\id` disagrees with the claim;
   - the manifest's `project.id` disagrees with the API's `book_slug`.

   This is "we expect the API to tell the truth, and blow up when it doesn't".

4. **`health(usfm)`** never refuses; it informs the choice:
   - coverage against the versification ("1 ch, 25 v; 1 Peter has 5 ch,
     105 v");
   - duplicate verses;
   - the onion (USFM) findings count.

**The cross-book check.** Validation can't catch the 1JN/1PE case: BTT Writer
chunks carry no `\id`, so we stamp the claimed one, and the text parses fine
as "1 John". What catches it is health plus one comparison across all
offers: **a book whose opening verses match another book's offer** ("this
text also appears as Jude"). That needs every offer rendered, so it runs on
the assembly screen, not per offer.

## User flow

**The way in.** Projects page → Import → **Migrate from Writer** (working
name).

- **Pick the books.** It offers three tiles: Folder, Zip, and "From the
  catalogue (online)". Several inputs can be combined in one run, for example
  a zip for Psalms plus the catalogue for the rest.
- **Inside a project:** Books → **Add a book…**. This opens the same flow,
  filtered to this project's language and resource.

**Step 1: the books.** One row per book in canonical order, under OT and NT
headings, with a count for each ("NT 27 of 27 · OT 39 of 39").

- **Defaults, per book:**
  - the one offer, if there is only one;
  - otherwise the one Primary;
  - otherwise the newest Active;
  - a book that has only Inactive offers is left out, with a note.
- Inactive offers are hidden behind "Show inactive (38)".
- **A row with one offer** shows its health and needs nothing from the person.
- **A row with more than one offer** is marked **"Choose"**. The header says
  "3 books need a choice". Assemble is enabled when every row is either
  settled or left out.

**Step 2: choosing, per contested book.** This is the designer's "Choose a
Repository" mockup, one book at a time, with Next and Previous between the
contested books.

- **Tabs**, one per offer: the owner, plus a star for Primary.
- **A metadata line:**
  - date;
  - chapters;
  - "Recommended" (that is, Primary);
  - **plus our health line:** coverage, duplicates, the cross-book warning.
- **Use this one.**
- **The body** is the book read as text: the reader, not an editor.
- **Added to the mockup: "Differences from …"**, a choice of another tab.
  When set, the body becomes Review's reader with the two offers as its two
  sides. Review already treats both sides as pickers (the `CompareSource`
  port), so this is the same diff, before there is a project.
  - On a narrow screen the comparison replaces the reader.
  - On a wide one it could sit beside it.
- With that, the 1JN case reads like this:
  - **Moffat_chola ★:** "1 ch · 25 v · expected 5 ch · also appears as Jude".
  - **mary_chishimba:** "5 ch · 105 v".

  The person picks mary_chishimba's in a second, with the reason in front of
  them.

**Step 3: the project.** One form, prefilled to `bwc_reg`'s convention:

- language and direction;
- resource;
- title;
- contributors: the union of translators and commit authors;
- source: the union of every book's `source_translations`;
- checking level 1;
- rights.

**Assemble.** This writes the repository (below), opens the project, runs the
USFM checks, and offers the sources (below).

- History shows each book's own commits.
- Nothing is sent: the project sends through ordinary sync, to a repository
  the person names.

**Later: the tap.** "Check the catalogue for newer work on these books" is an
opt-in setting, off by default because it is network-heavy.

- When on, the check on open asks the tap for offers of this project's books
  that are newer than the last import of each.
- A newer offer arrives through the same render and the same diff: incoming
  against ours, as Review's decision units, the way sync's incoming plan works.
- Scripture text is never merged automatically.

## Auto-pull the listed source texts (possibly first)

A project's manifest names its sources. `bwc_reg` says
`source: [{identifier: ulb, language: en, version: 24-02}, {… 21-05}]`, and
BTT Writer's `source_translations` says the same thing in a different shape.

Today, after a download, the person has to go and get the source text
themselves.

**The feature:** when a target-capable text arrives (download, import or
assembly), resolve each listed source against the catalogue and pull it as a
bound source, with no extra clicks.

**Resolution.** The catalogue owner on Gitea is `WA-Catalog`. Gitea matches
the owner case-insensitively, so `wa-catalog` resolves too. A source resolves
to `WA-Catalog/<language>_<identifier>`, then a version tag, as a library
resource.

Probed 2026-10-02: `WA-Catalog/en_ulb` exists, with tags `v24-07 V21-05 v20-02
v19-10 v19-07 v19-01 v12`. So:

- **Versions are tags, matched case-insensitively.** `21-05` is `V21-05`, not
  `v21-05`.
- **A listed version can be missing.** `bwc_reg` lists `24-02`, and there is
  no such tag: the nearest is `v24-07`. The resolver says that, rather than
  quietly taking the newest. Options:
  - take the default branch, marked "listed 24-02, using 24-07 (24-02 is not
    in the catalogue)";
  - or ask.
- **Two versions of the same source** (24-02 and 21-05) are two bindings, or
  one binding to the newer. That is a question for Will.

**Why it may go first.**

- It is Library work only: a source binding of a USFM text, a role that
  already exists.
- It needs no resource kinds, so it does not wait on the resource-kinds plan.
- It builds the primitive this plan also needs: `SourceRef {language,
resource, version} → catalogue resource`, used both by `manifest.yaml`'s
  `source` and by BTT Writer's `source_translations`.

**The one resource-kinds question it raises: what is "target-capable"?** It
means a text that is someone's translation, which you edit, as opposed to a
resource you read beside it.

- Today that is "an RC or Burrito of USFM books".
- The resource-kinds plan's tiers say the same thing: a target is a tier-3
  project, and its sources are tier-3 resources bound by role.
- So this can be built cleanly at the Library level now, and nothing about it
  has to move when the kinds land.

## Architecture

| Piece                    | Where                                                                   | What                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Offers                   | `src/core/migrate/offer.ts`                                             | The `BookOffer` contract; grouping by (language, resource, book); defaults. Pure.                                        |
| Folder and zip producers | `src/core/migrate/local.ts` over `FileSystem`                           | One offer per BTT Writer project found. Zip goes through the existing import staging.                                    |
| Tap producer             | `src/app/catalogue.ts`                                                  | `bookOffers(lang)`: the query above, decoded by Schema. `open` uses the existing clone into staging.                     |
| BTT Writer shape         | `src/core/migrate/bttWriter.ts` (pure)                                  | The lenient manifest Schema, `recognize`, and `render`.                                                                  |
| Validate and health      | `src/core/migrate/check.ts`                                             | Over Galley's parse and the onion checks; the cross-book opening match.                                                  |
| Plan                     | `src/core/migrate/plan.ts`                                              | A Schema value whose `books` is a record keyed by book code (uniqueness is the type), plus the metadata.                 |
| Assembly                 | `src/core/migrate/assemble.ts`                                          | Plan → an Effect over `Git` and `FileSystem`. Writes the repository and the RC manifest in `bwc_reg`'s convention.       |
| Source resolver          | `src/core/resources/sourceRef.ts`, plus a catalogue lookup in `src/app` | `SourceRef → { owner, repo, tag, note }`.                                                                                |
| Screens                  | `src/app/ui/migrate/`                                                   | Books table, the choose step, and the project form. Reuses `MultiSelect`, `BookScope`, `ReviewReader` and `VirtualList`. |

**Observability:** one operation per step:

- `migrate.offers`, with producers, books and offers;
- `migrate.open`, per offer;
- `migrate.render`, with commits and skipped;
- `migrate.assemble`;
- `sources.resolve`.

A refused offer ends `refused` for that offer only.

### Rendering a chunked book to USFM

1. `\id` (the claimed book), `\ide UTF-8`, `\h` and `\toc1–3`, and `\mt` from
   `front/title.txt`.
2. Each chapter in numeric order: `\c N` once (dropping the `\c` the first
   chunk repeats), `\cl` from the chapter's `title.txt`, then the chunks in
   numeric order.

`render` should match the converter that built `bwc_reg`. One test: render
each Primary repository and diff it against `bwc_reg`. The diff should be
empty except for the "Field updates" commits.

### Layering the history

For each chosen book that carries history:

1. **Walk its first-parent history**, oldest first.
2. **Rewrite each commit `C` as `C′`:**
   - its tree is just `NN-BOOK.usfm = render(tree(C))`;
   - its parent is the previous `C′`;
   - author, committer and both dates come from `C`;
   - the message is `C`'s, plus trailers:
     `Imported-From: <origin>`, `Imported-Commit: <sha>`,
     `Renderer: bttwriter/1`.
3. **Skip a commit whose render equals the previous one** (manifest-only
   saves).
4. **Join the book to the project** with one arrival commit that has two
   parents, `[project tip, last C′]`. Its tree is the tip's tree plus the
   book's file, and the manifest updated.

A source with no history (a zip without `.git`) arrives as one ordinary
commit.

A fresh assembly is a root commit (the manifest) and then one arrival per
book, in canonical order. Importing one book into an existing project is the
same arrival on the tip. **One shape for both sizes.**

**Why this shape:**

- **`git log -- 61-1PE.usfm` and blame see the book's whole life**, in the
  file's real shape.
- **The project's history is never rewritten**, so there is no rebase and no
  force push.
- **The rewrite is deterministic.** The same commits with the same renderer
  version give the same `C′`. Two copies of one history (Moffat's and
  bwile_refinement's 1JN) collapse into one, and a later update extends the
  same chain.
- **Not submodules or a subtree merge.** Both keep BTT Writer's shape, so the
  file the project actually has would have no history.

**Attach history** is for a book already present, as every book in `bwc_reg`
is. It is the same arrival with the tip's tree **unchanged**: the history
appears behind the text, and the text stays.

**Updates from a tap** start from the newest `Imported-Commit` for that book
in our own history.

- Rewrite the newer source commits onto the existing chain, and arrive again.
- If our file changed too, it is a text conflict, and it goes to Review's
  decision units.
- The trailers are the only record. Nothing is kept beside the history, and
  `.sefer/` stays out of it.

## Risks and costs

**History must follow merges.** Our Web history index and `log(filepath)` have
to follow the second parent through an arrival commit, or the layered history
is invisible in History.

- Check this first.
- Old repositories have odd tree entries (the `UnsafeFilepathError` lesson).

**Web cost.** A whole Bible is about 66 × 50 ≈ 3,300 renders, each reading
60–200 chunk blobs.

- Memoize by blob oid and by chapter-tree oid.
- Desktop's git2 will not notice the load.
- Measure first. If it is slow, carry **History: keep / latest only** per
  book.

**Tap volume.** A whole-Bible migration is up to 66 clones (51–102 KB each
for `bwc`).

- Clone a few at a time, with progress per row.
- Back off on HTTP 429.

**The renderer is a contract.** Changing it changes every `C′`, which is why
the trailer carries `Renderer:`.

## Questions for Will

1. **Output format.** RC, as `bwc_reg` and the ecosystem code write it,
   Burrito, or the person's choice? This note assumes RC.
2. **Two versions of one source.** Bind both, or bind the newer and record
   both in the manifest?
3. **A missing source version** (`24-02`). Use the nearest tag with a note, or
   ask?
4. **The converter.** Which converter built `bwc_reg` (the tX pipeline, or
   Garry's)? `render` should match it, or say where it differs and why.
5. **Order.** Source auto-pull first, then this? Both before resource kinds?
   This note thinks yes to both: neither needs a kind.
6. **What "Active" means.** Who would know? The defaults treat it as "second
   choice".
