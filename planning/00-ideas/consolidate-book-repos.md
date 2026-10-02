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
- **Auto-pull source texts** that a project's manifest lists (below). This
  comes first, because it builds the resolver this plan also needs.

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

### The existing convention, and what we write instead

`bwc_reg`'s `manifest.yaml` is the convention to keep, with three
corrections.

**From `bwc_reg`:**

- **`dublin_core`:**
  - `conformsto: rc0.2`, `type: bundle`, `format: text/usfm`;
  - `identifier: reg`;
  - `language {identifier, title, direction}`;
  - `relation: [bwc/reg]`.
- **`projects[]`, one per book:**
  - `title` (from `front/title.txt`, e.g. "Yohane");
  - `identifier` (lowercase);
  - `path: ./44-JHN.usfm`;
  - `sort`;
  - `categories: [bible-nt]` or `[bible-ot]`;
  - `versification: ufw`.
- **`checking_level: '1'`.** BTT Writer's `"3"` is the SOURCE's level, not
  ours.

**The corrections:**

1. **Contributors, de-duplicated.** `bwc_reg` lists "Blessingtone",
   "Blessingtone Chama" and "Blessingtone_Chama" separately.
   - Merge on a normalised key: case-folded, `_` read as a space, whitespace
     collapsed. Keep the first spelling seen.
   - A team list in one string ("Kapiso Gershom, Salt Mwinuna, …") stays one
     entry. Splitting on commas would break names that contain one.
2. **Sources, de-duplicated** on (language, identifier, version). `bwc_reg`'s
   two ULB versions are distinct and both stay.
3. **Sources as proper Burrito relationships, not only RC `source`.** See
   "Sources" below.

**Write both files; read the Burrito.**

- The project gets a Burrito `metadata.json`, which we read, and an RC
  `manifest.yaml` written FROM the same metadata, for our other tools.
- Discovery already reads the Burrito first and consults the RC only when
  there is no Burrito (`readProjectMetadata`, `src/core/project/discovery.ts`).
- With both written, the RC is output only. If it drifts, the Burrito wins,
  and the next write fixes the RC.
- **This needs a Burrito WRITER,** and today we only decode
  (`src/core/resources/burrito.ts`, 95 lines). Write it from one internal
  `ProjectMetadata` into both formats, through the schemas, as
  `projectAdmin` already does for edits.
- **A shared org library for it, later.** Start in `src/core/resources`, pure.
  Extract it when a second tool needs it.
  - That is also the moment to decide whether the shared version validates
    against Burrito's published JSON Schemas (language-neutral) rather than
    our Effect schemas.
  - Effect would be a heavy dependency for a "no deps" utility.

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
- contributors: the union of translators and commit authors, de-duplicated;
- sources: the union of every book's `source_translations`, de-duplicated,
  written as Burrito relationships and RC `source`;
- checking level 1;
- rights.

**Assemble.** This writes the repository (below), opens the project, runs the
USFM checks, and pulls the listed sources (below). Both `metadata.json` and
`manifest.yaml` are written.

- History shows each book's own commits.
- Nothing is sent: the project sends through ordinary sync, to a repository
  the person names.

**Later: the tap.** "Check the catalogue for newer work on these books" is an
opt-in setting, off by default because it is network-heavy.

- When on, the check on open probes each book's `Book-Upstream`. One that has
  moved past its `Book-Upstream-Commit` has new work.
- The new work arrives through the same render and the same diff, as a
  three-way with a real base (see "History", option B). It is shown as
  Review's decision units, the way sync's incoming plan works.
- Scripture text is never merged automatically.

## Sources (first in this scope of work)

Agreed 2026-10-02: plan this first. It builds the resolver and the upstream
check that the migration needs as well.

### What a project says about its sources

**RC** (`bwc_reg`, lines 40–46):

```yaml
source:
  - { identifier: ulb, language: en, version: 24-02 }
  - { identifier: ulb, language: en, version: 21-05 }
```

This names a resource, but not where it lives. Today the catalogue
convention fills that in: owner `WA-Catalog` (matched case-insensitively), and
repository `<language>_<identifier>`.

**Burrito** has the proper field: `relationships[]`, each a `Relationship`
(Burrito 1.0.0 schema):

```json
"idAuthorities": { "wacs": { "id": "https://content.bibletranslationtools.org", "name": { "en": "WACS" } } },
"relationships": [
  { "relationType": "source", "flavor": "textTranslation",
    "id": "wacs::WA-Catalog/en_ulb", "revision": "<resolved commit sha>" }
]
```

- `id` is a `prefixedId` (`^[0-9a-zA-Z][0-9a-zA-Z-]{1,31}::\S+$`), naming an
  authority declared in `idAuthorities`. That is exactly the "where" the RC
  form lacks.
- `revision` is an opaque string of up to 64 characters, so a full commit
  SHA fits.
- **Recommendation: `revision` is the resolved commit, not the listed
  version.** Tags here are missing, inconsistently cased, and movable. A
  commit is exact for as long as the history exists. The human version
  ("24-02") stays in the RC `source`, which is where people read it.

**BTT Writer's** `source_translations[]` (`language_id`, `resource_id`,
`version`) is the RC form in another shape. It reads into the same
`SourceRef`.

### Resolving a reference

One pure rule over what a clone already shows. `SourceRef {language,
resource, version?}` resolves to `{url, commit, how, note?}`.

**Probed 2026-10-02:**

| Repository            | Releases      | Tags                                            | Manifest `version` at `master` |
| --------------------- | ------------- | ----------------------------------------------- | ------------------------------ |
| `WA-Catalog/en_ulb`   | `v24-07` only | `v24-07 V21-05 v20-02 v19-10 v19-07 v19-01 v12` | `24-07`                        |
| `WA-Catalog/pt-br_tq` | none          | none                                            | `9`                            |
| `WA-Catalog/sw_tn`    | none          | none                                            | `7`                            |

`bwc_reg` lists `24-02`, which is none of these.

**The rule, first match wins.** Version comparison drops a leading `v`/`V`
and ignores case.

1. **`release`:** a release whose tag matches the version gives its commit.
2. **`tag`:** a tag that matches gives its commit.
3. **`manifest`:** the newest commit on the default branch whose
   `manifest.yaml` (or `metadata.json`) declares that version.
   - This covers repositories with no tags at all, which is most of the
     non-ULB catalogue.
   - It walks one file's history in a clone we already have. It is exact,
     because it is the resource's own statement of its version.
4. **`head`:** the default branch's head, with a note: "listed 24-02; not
   found; using 24-07 (newest)". The person sees the note on the source's
   row, and it is recorded on the binding.

**No version listed** goes straight to `head`, with no note. Two listed
versions of one resource are two references. Whether both become bindings is
still open (question 2).

### One upstream behaviour for everything cloned

Anything that came from a git remote records where it came from and which
commit it holds: `Upstream {url, ref, commit}`. That covers:

- a bound source;
- a migrated book's BTT Writer repository;
- the project's own origin, which the sync check already handles.

**One opaque check serves all of them.** `probe(url)` lists the remote's refs
without cloning, and compares them with `commit`.

- If the remote is newer, an update is available. Only then do we fetch.
- **A pinned source** (resolved by `release`, `tag` or `manifest`) is not
  "behind" when its branch moves. It is behind when a NEWER version exists:
  a newer release or tag, or a newer declared version. It is offered as
  "en_ulb 24-07 is available", never applied silently.
- **A following source** (`head`) is behind when the branch moved.
- **Cost:** a probe is one small request per upstream. Batch them, run them on
  open at the same moment as the sync check, and make the migrated-books set
  (up to 66 upstreams) opt-in.

### When it runs

When a target text arrives (download, import or assembly):

1. Read its sources: Burrito `relationships` first, otherwise RC `source`,
   otherwise BTT Writer `source_translations`.
2. Resolve each.
3. Clone the ones not already in the library.
4. Bind them as sources.

Each source gets a row in the arrival's progress. A source that cannot be
resolved, or a host that is offline, fails that row only.

**"Target-capable" for now** means an RC or Burrito of USFM books. The
resource-kinds tiers agree: a target is a tier-3 project, and its sources are
tier-3 resources bound by role. Nothing here moves when the kinds land.

## Architecture

| Piece                    | Where                                              | What                                                                                                                 |
| ------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Source refs              | `src/core/resources/sourceRef.ts` (pure)           | Read from Burrito relationships, RC `source` and BTT Writer `source_translations`; the resolution rule.              |
| Upstream                 | `src/core/remote/upstream.ts`                      | `Upstream {url, ref, commit}`; `check` over `Remote.probe`; batched.                                                 |
| Burrito writer           | `src/core/resources/burrito.ts`, plus an RC writer | One `ProjectMetadata` written into both files.                                                                       |
| Offers                   | `src/core/migrate/offer.ts`                        | The `BookOffer` contract; grouping by (language, resource, book); defaults. Pure.                                    |
| Folder and zip producers | `src/core/migrate/local.ts` over `FileSystem`      | One offer per BTT Writer project found.                                                                              |
| Tap producer             | `src/app/catalogue.ts`                             | `bookOffers(lang)`: the query above. `open` uses the existing clone into staging.                                    |
| BTT Writer shape         | `src/core/migrate/bttWriter.ts` (pure)             | The lenient manifest Schema, `recognize`, `render`.                                                                  |
| Validate and health      | `src/core/migrate/check.ts`                        | Over Galley's parse and the onion checks; the cross-book opening match.                                              |
| Plan and assembly        | `src/core/migrate/plan.ts`, `assemble.ts`          | A plan keyed by book code; an Effect over `Git` and `FileSystem`.                                                    |
| Screens                  | `src/app/ui/migrate/`                              | Books table, the choose step, the project form. Reuses `MultiSelect`, `BookScope`, `ReviewReader` and `VirtualList`. |

**Observability:** one operation per step:

- `sources.resolve`, with `how`;
- `upstream.check`;
- `migrate.offers`;
- `migrate.open`, per offer;
- `migrate.assemble`.

A refused offer or source ends `refused` for that row only.

### Rendering a chunked book to USFM

1. The front matter: `\id` (the claimed book), `\ide UTF-8`, `\h` and
   `\toc1–3`, and `\mt` from `front/title.txt`.
2. Each chapter in numeric order: `\c N` once, `\cl` from the chapter's
   `title.txt`, then the chunks in numeric order.

The front matter is ours, not the translator's. It is written once, at the
arrival (below), and never pushed back into their history.

## History: keep the commits, reshape at the arrival

**Will's question (2026-10-02).** We have to add front matter and
concatenate, so can we keep the history at all, without rewriting it?
Unless "the intent of history" can be kept without the actual commits? And
what does a flat repository do to following the upstream BTT Writer
repositories?

There are two ways. The first pass of this note chose A. **This pass
recommends B.**

### A. Rewrite: keep the intent, not the commits

Each BTT Writer commit `C` is rewritten as `C′`, whose tree is just the
rendered `NN-BOOK.usfm`, with the same author, dates and message, and a
trailer naming `C`. The chain then joins the project through a two-parent
arrival.

- **For:** `git log -- 44-JHN.usfm` and `git blame` work in any git tool.
- **Against:**
  - **Every SHA is new.** The upstream relation exists only in trailers, so
    following upstream means re-deriving our chain from theirs.
  - **The renderer becomes a contract.** Any fix to `render` changes every
    `C′`, so a re-import no longer lines up.
  - **It is a rewrite,** which is the thing Will doesn't want.

### B. Keep: the real commits, reshaped once at the arrival

The BTT Writer history comes in **unchanged**: the same objects and the same
SHAs as upstream. The book joins the project with one arrival commit:

```text
parents: [project tip, upstream tip C]       (C is their real commit)
tree:    project tip's tree + NN-BOOK.usfm (= render(tree(C)), with front matter)
         + metadata.json / manifest.yaml updated
message: Bring in 1 John from mary_chishimba/bwc_1jn_text_reg
         Book-Upstream: 1JN https://content.bibletranslationtools.org/mary_chishimba/bwc_1jn_text_reg
         Book-Upstream-Commit: <C>
```

This is the "layer our last commit on top as part of finalization" you
described. It is possible because git lets a merge commit hold any tree:
nothing forces the result to contain its second parent's files.

**For:**

- **Nothing is rewritten.** Their commits are byte-for-byte theirs.
- **The front matter and the reshape live in exactly one commit,** which is
  ours.
- **Following upstream becomes plain git.**
  1. `probe` their URL.
  2. If their head descends from `Book-Upstream-Commit`, there are new
     commits.
  3. Fetch them. They are ordinary objects in the same store, a few KB each.
- **The base for a three-way merge is real.** It is `render(tree(C))`, and
  `C` is in our repository. Then:
  - their change is `render(new tip)` against that base;
  - ours is the current file against that base;
  - Review's decision units take it from there. Verses only one side touched
    can be offered as one-click takes.
  - Nothing is applied automatically.
- **The renderer is not a contract.** Fixing `render` changes nothing already
  recorded; the next arrival just renders better.
- **Copies collapse by themselves.** Moffat's and bwile_refinement's 1JN are
  the same objects.

**Against:**

- **`git log -- 44-JHN.usfm` in a plain git tool stops at the arrival.**
  Before it, the file did not exist; the history is under `01/01.txt` and so
  on.
  - Sefer's History can follow it anyway: when it walks into an arrival's
    second parent, it reads those commits through the BTT Writer lens
    (`render`).
  - Then "what this version changed" works per book, as History does now.
    That is "keep the intent" done at read time, not by rewriting.
  - Will and the designer, and the translators, see the history through
    Sefer, not the git CLI, so this is the right side to give up.
- **The second-parent trees are BTT Writer's shape** (`01/`, `manifest.json`
  at their root).
  - A person running `git merge` on the CLI against one of those upstreams
    would make a mess.
  - Sefer never runs a git merge; it writes these commits itself.
- **66 roots in one repository.** Git doesn't mind, and Gitea doesn't either.
  Size is the BTT Writer objects, 51–102 KB per book for `bwc`.

**Where the "follow" lives.** The upstream link is in the arrival trailers,
so a second device that clones the project knows which upstream each book
follows. Nothing is in `.sefer/` or in refs that intake would strip
(`KEEP_REFS`).

- Choosing a different candidate later is just a new arrival, with a new
  trailer.
- **Whether to check** is a device setting ("Check Writer projects for new
  work", off by default), because it is up to 66 probes.

**Folders and zips with a `.git`** (a BTT Writer working directory) come in
the same way: their objects are copied in, and the arrival is the same.

- On desktop that is git2.
- On the Web, isomorphic-git cannot fetch from a path, so the objects are
  walked and written; small, but code to write.
- A source with no `.git` arrives as one ordinary commit.

**Attach history** (books already present, as all of `bwc_reg`'s are) is the
same arrival with the tip's tree unchanged. Their history appears behind the
text, and the follow link starts from there.

**Shallow clones.** The migration clones BTT Writer repositories in full: 31
to 81 commits, which is small. A shallow upstream would leave a second parent
whose ancestors are missing, and History already has to handle that case
(the shallow-history card).

## Risks and costs

**History must follow merges.** Our Web history index and `log(filepath)`
must walk into an arrival's second parent and apply the BTT Writer lens there.
Without that, B's history is invisible in Sefer.

- Check this first.
- Old repositories have odd tree entries (the `UnsafeFilepathError` lesson).

**Lens cost on the Web.** Reading a book's 50 commits through `render` means
reading 60–200 chunk blobs per commit.

- Memoize by blob oid and by chapter-tree oid.
- It is paid when History is opened, not at assembly.

**Tap volume.** A whole-Bible migration is up to 66 clones.

- Clone a few at a time, with progress per row.
- Back off on HTTP 429.

## Questions for Will

1. **History shape.** B (keep the real commits; reshape and front matter in
   one arrival commit) over A (rewrite)? This note recommends B.
2. **Two versions of one source** (ULB 24-02 and 21-05). Bind both, or bind
   the newer and record both?
3. **`revision`.** The resolved commit SHA, as recommended, with the human
   version kept in the RC `source`?
4. **The id authority's name.** `wacs::`? It is ours to choose, and it should
   be one value across the organisation's tools.
5. **The converter.** Which one built `bwc_reg`? `render` should match it, or
   say where it differs.
6. **What "Active" means.** Who would know? The defaults treat it as "second
   choice".
