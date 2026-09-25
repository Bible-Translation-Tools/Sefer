# Downloading a language from WACS, whatever format it was published in

**Status:** plan, 2026-09-24. Scoped with the designer and reviewed roughly by the developer; parked for the developer to pick up. It does not authorize implementation. The catalogue half (steps 1–2) can start without the open questions answered; the legacy half (steps 3–5) cannot.

## Job

A translator searches for their **language** on the projects page ("Projects Available on WACS") and presses Download once. They never have to know which software produced the repos, how many repos there are, or who owns them. What lands on disk is one ordinary Sefer project.

## Where the screen is today

`src/app/ui/landing/WacsProjects.tsx` over `src/app/catalogue.ts`:

- rows come from the REST route `https://api.bibleineverylanguage.org/api/rest/consolidated-repos` (`VITE_SEFER_LANGUAGE_API_URL`), **one row per repo**;
- region, alternate names and the gateway flag are joined from `https://td.unfoldingword.org/exports/langnames.json`; gateway languages are filtered out; search matches code, both names and every alternate name;
- the Date column is blank — the REST view has no date, and asking the content server per repo was tried and dropped (~280 requests per page view, HTTP 429);
- Download clones one repo through `cloneRepository`, then `rememberProject`.

The REST route is a thin view over the GraphQL API and cannot answer the questions below.

## What the GraphQL API holds

`https://api.bibleineverylanguage.org/v1/graphql` (Hasura). Introspection is open and CORS answers the page's origin. SQL schema: `WycliffeAssociates/languageapi`, `controller/src/db/schema/schema.ts` on `prod`.

| Need                    | Where                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Consolidated            | repo topic: `git_repo.topics.topic.name = "consolidated"` (the only topic in `git_topic`)                                             |
| Primary / Active        | `content.wa_content_metadata.status` ∈ `Primary`, `Active`, `Inactive`, `""`                                                          |
| Shown publicly          | `wa_content_metadata.show_on_biel`, `wa_language_metadata.show_on_biel`                                                               |
| Gateway                 | `language.wa_language_metadata.is_gateway` (also `vw_langnames.gw`)                                                                   |
| Date                    | `content.modified_on` — take the newest per language                                                                                  |
| Region, alternate names | `vw_langnames.lr`, `vw_langnames.alt` (same data as the td export, so that fetch can go); also `language.country.world_region.region` |
| Book of a repo          | `rendered_content.scriptural_rendering_metadata.book_slug` (e.g. `ROM`), `is_whole_book`                                              |
| Resource type           | `content.resource_type` — overwhelmingly `reg`, then `ulb`, `udb`; the field is noisy (book slugs and dates appear in it)             |
| Domain                  | `content.domain` ∈ `scripture`, `gloss`, `parascriptural`, `peripheral`                                                               |
| Pre-built archives      | `source_zips` (`zip_url`, `resource_type`, `meta_status`, `unique_book_slugs_count`)                                                  |

Measured on 2026-09-24, scripture rows with `show_on_biel`: 896 languages, 862 non-gateway. **53** of those have a repo with the `consolidated` topic; **809 are legacy-only**, and 584 of those have at least one `Primary` repo. Legacy is the main case, not the edge case.

### "Consolidated" versus legacy

- **Consolidated:** described by a manifest (Scripture Burrito `metadata.json`, or RC `manifest.yaml`) with USFM spec books, one file per book. The existing `classify → commit` pipeline (`src/core/resources/import.ts`) already takes this.
- **Legacy** (translationStudio era), e.g. `mongmi02/tbq-x-mongmi_rev_text_reg`: one repo per book, a `manifest.json`, one folder per chapter of `NN.txt` chunks, a `front/` folder. Sefer does not intend to support this as a disk format — it must be converted on the way in.

Two reachability facts:

- `rendered_content` lists a whole-book `source.usfm` per legacy repo on `read.bibletranslationtools.org`, which would make stitching unnecessary — but that host, and the content server's raw/archive routes, sit behind a Cloudflare challenge (HTTP 403 to anything that is not a browser session). The content server's `/api/v1` routes answer, and rate-limit (HTTP 429).
- Clones go through the git transfer server the build already configures.

## Plan

The developer's constraint shapes every step: **the rest of the app must never become branchy.** Consolidated or legacy is decided once, at the edge, and everything after the edge sees one shape.

```
GraphQL → one row per language → download plan (per book) →
  fetch (consolidated: clone │ legacy: fetch each repo) →
  normalise through an Effect Schema into the staged shape →
  classify → commit  (unchanged)
```

1. **Catalogue over GraphQL** (`src/app/catalogue.ts`). One query per page view. Hardcode the URL with a loud `TODO(ENV): move to VITE_SEFER_LANGUAGE_GRAPHQL_URL` — it is not a secret, and the designer is not set up for env vars yet. Return **one row per language**: code, national and English names, alternate names, region, newest `modified_on`, and whether it has a consolidated repo. Filter gateway languages and `show_on_biel = false` in the query. Drop the `td.unfoldingword.org` fetch.
2. **Download plan** (new, pure, in `src/core` — it is policy, not IO). Input: a language's content rows. Output, per book: which repo(s) to take and why. The rule, from the designer:
   - a consolidated repo exists → take it, and nothing else;
   - otherwise, per book: `Primary`, else `Active`, else **every** repo for that book, marked as a conflict to flag later;
   - legacy books are stitched together "based on primary + same resource type" (see open question 2).

   A plain function over plain data: unit-test it against captured API responses (the `tbq-x-mongmi` language is a good fixture — 12 rows, 11 books, two repos for Romans).

3. **Fetch.** Consolidated: the existing `cloneRepository`. Legacy: per repo, clone through the transfer server or read through `/api/v1` — throttled, with the progress dialog counting repos, because a language can be 27+ repos.
4. **Normalise with an Effect Schema** (new, in `src/core/resources`). `LegacyRepo` decodes a legacy repo's `manifest.json` and chunk files, stitches the chunks into one USFM book (front matter from `front/`), and emits the **same staged value** a consolidated import does. Validation failures are typed and name the repo and file. Nothing downstream of this learns that a book was ever legacy.
5. **Conflicts.** When a book had several candidates, one becomes the book and the rest are kept aside — for example `.sefer/candidates/<BOOK>/<owner>-<repo>.usfm` — and recorded so a later Finding can flag the book. Never merge scripture text automatically (`documentation/architecture/sync.md`).
6. **Table UI.** One row per language; Download shows the plan first ("27 books · 3 with more than one source"), then runs 3–5 with a progress dialog.

## Open questions

1. **Cloudflare.** Can Sefer's requests be allowed through, or pointed at an unchallenged host? If the pre-rendered `source.usfm` is reachable, step 4's stitching mostly disappears and legacy becomes "download one USFM per book".
2. **Resource type.** When a language has `Primary` `reg` for some books and `Primary` `ulb` for others, is that one project (mixed) or one project per resource type?
3. **Counts disagree.** The REST view returns 282 translation languages (561 repos); the `consolidated` topic, filtered by `show_on_biel`, finds 53. Is the REST view looser than the topic, or is `show_on_biel` the wrong filter?
4. **Where conflicts live.** Is `.sefer/candidates/` acceptable, or is there a planned home for alternative copies of a book?
5. **Rate limits.** What request rate does the content server tolerate for a many-repo legacy download, and does the transfer server have the same limit?
