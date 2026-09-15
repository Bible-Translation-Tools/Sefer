# Key terms (STET) catalogue

Four files, copied **verbatim** from `public/stet/` in the
`scripture-editor-proto-2` repository, where they were the shipped Spiritual
Terms Evaluation data:

| File | Bytes | What it is |
| --- | --- | --- |
| `index.json` | 577 | The guide manifest: one row per locale with its pinned `provenanceId` and file name. |
| `en.json` | 1.3 MB | English guide — 102 terms, 4 865 frozen reference verses. |
| `es-419.json` | 1.8 MB | Latin-American Spanish guide. |
| `pt-br.json` | 1.7 MB | Brazilian Portuguese guide. |

## Where the bytes came from

The envelopes are **baked offline** by `build-stet-catalog.mjs` in the
`stetDataGenerator` repository. Nothing at runtime fetches, unzips or
re-derives them; the generator:

1. reads the merged term document for the locale,
2. pins that locale's Unlocked Literal Bible at a commit SHA and extracts plain
   verse text (through `usfm_onion`'s `toVref`) for every referenced verse,
3. precomputes, per term, the `[start, end)` offsets into that verse text where
   the term's glosses matched — whole word, longest first, non-overlapping,
4. emits `{ schemaVersion, locale, reference, referenceVerses, terms }`.

The pinned snapshots, which are the `provenanceId` in each envelope and in
`index.json`:

| Locale | Repository | Commit |
| --- | --- | --- |
| `en` | `WA-Catalog/en_ulb` | `8baaf2076f7813ac7ab5f3e7988627ec0f9d91dc` |
| `es-419` | `WA-Catalog/es-419_ulb` | `c54e36d1cc27ae58c6b8ae85238eb884d5f1a3d1` |
| `pt-br` | `WA-Catalog/pt-br_ulb` | `f63e8b13f2cba842ce5acd6cfc4398c3ad250c40` |

Each envelope's `reference.sourceUrl` is the content-addressed archive for its
commit, e.g.
`https://content.bibletranslationtools.org/WA-Catalog/en_ulb/archive/8baaf2076f7813ac7ab5f3e7988627ec0f9d91dc.zip`.

## Licence

The verse text is the Unlocked Literal Bible and the term definitions are
translationWords, both published by Wycliffe Associates / unfoldingWord under
**CC BY-SA 4.0**. They are redistributed here under the same licence. The
envelope format itself — the grouping, the baked offsets — is this project's.

## Why it is a fixture

`src/core/stet` loads exactly these files through the `StetCatalog` port, the
way `src/core/fixture/smallNt.ts` loads the dev project: a `?raw` import, so
the bytes are the repository's and not a network call. That is a **stand-in**.
A key-terms guide is properly a Library resource bound to the project under the
`glossary` role, or a remote guides API; the port exists so that swapping the
layer is the only change when one of those arrives. See
`documentation/architecture/stet.md`.
