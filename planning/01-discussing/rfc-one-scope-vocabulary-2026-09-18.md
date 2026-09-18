# RFC to scripture-kitchen — one scope vocabulary

**Type:** upstream proposal. Written from Sefer (`../Sefer`), 2026-09-18, on v0.1.4.
**Hand to:** a fresh agent in `scripture-kitchen`.

## Goal / definition of done

Every door that can operate on part of a document or part of a corpus takes the
SAME scope argument, spelled in the reference language the engine already owns.
"Done" is: a caller who knows how to scope `findAll` knows how to scope
`overlay`, `format`, `lint` and `mask` without reading three more docs — and
each door either accepts that scope or says in its own doc why the whole
document is the only sensible unit for it.

## Context — what prompted it

Sefer's Match Formatting applies an overlay across a whole book. The engine
already supports narrowing it (`OverlayOptions.scope`), but the operation is one
a translator wants to take a chapter at a time, because an overlay deliberately
LEAVES HOLES — an inserted inside-verse block arrives empty, by design, since
where a verse's text splits is unknowable across languages. A whole book of
those at once is a lot of holes to walk back through. Will, 2026-09-18:

> overlay does the whole book, but should probably, like format, take a scope
> arg if possible, using our toc, to scope to book or chapter. Kinda
> overwhelming to do full project on something that's going to leave holes on
> purpose in places.

Chasing that turned up the real issue, which is not overlay: **the word "scope"
means three different things on the handle, and one door expresses the same idea
without using the word at all.**

| door | how it narrows | what "scope" means there |
| --- | --- | --- |
| `findAll(needle, opts)` | `scope: "targets" \| "references" \| "all"` | WHICH BOOKS — a corpus selector |
| `tocAll(scope?, utf16?)` | a bare string, reaching further than find's | WHICH BOOKS, a different set |
| `skeleton` / `overlay` / `overlayText` / `overlayReport` / `*NodeFor` | `scope?: { chapter } \| { sid }` | WHERE IN ONE BOOK — a reference |
| `formatEdits(text, opts)` / `formatEditsIn(text, from, to, opts)` | two functions, and offsets | WHERE IN ONE BOOK — coordinates |
| `mask(id, opts)` / `maskOf(text, opts)` | nothing | — |
| `lint(id)` | nothing | — |

So a caller learns "scope" three times. `formatEditsIn` expresses the same idea
as the overlay doors in a different currency — offsets, which a caller has to
derive from a TOC first — and takes it as positional arguments rather than as
part of the options bag, so the two cannot be spelled the same way even by
accident.

## Proposed change

**One `Scope`, accepted wherever it can mean something.**

```ts
type Scope =
  | "all" | "targets" | "references"   // corpus: unchanged, still find's words
  | { book: string }                   // one registered book
  | { chapter: number }                // within the book this call names
  | { sid: string }                    // one verse or bridge
  | { from: number; to: number };      // offsets, for a caller that has them
```

The first three and the last already exist under other names; the middle three
are `OverlayOptions.scope` promoted. Then:

- `formatEditsIn(text, from, to, opts)` becomes `formatEdits(text, { scope })`
  with `{from, to}` as one scope shape. The old signature can stay as a shim.
- `mask` and `lint` take `scope` where a partial answer is meaningful — a mask
  over one chapter is the thing a chapter-clipped editor actually wants, and
  linting one chapter is what an editor wants on a keystroke.
- An unrecognised scope THROWS naming the shapes that exist, which is already
  the house rule (`findAll`'s unknown scope, `mask`'s unknown recipe).

**Why the reference language and not offsets.** A caller that has to convert
"chapter 3" into offsets before it can ask has to hold a TOC, index it, and get
the arithmetic right — which is the engine's own work done twice, badly, in
every consumer. The engine already ships the TOC (`toc`/`tocAll`) and already
parses sids (`Addr`), so it is the only side that can do this once.

## Downstream impact

- Sefer's Match Formatting can offer "this chapter" / "this book" without a
  second code path: today `app/workflows/stet.ts`'s `matchFormatting` threads
  `OverlayOptions` through and `routes/project/$slug/terms.tsx:282` passes none.
  That is our bug to fix and it is small — but it is only small because overlay
  happens to have the scope already.
- `core/fixes/fixes.ts:295` (`overlayBook`) would gain the same option.
- A chapter-scoped `lint` would let the editor proofread the clipped chapter on
  a keystroke instead of the book.

## Constraints & non-goals

- **Not** a request to change what any door computes. Only what it can be
  pointed at.
- **Not** asking for a new wire format. `Scope` is call options, not a buffer.
- Keep the corpus words (`"all"`, `"targets"`, `"references"`) exactly as they
  are; consumers say them today and they mean something the reference shapes do
  not.
- Backwards compatibility matters more than tidiness here: shims over renames.

## Open questions

1. Does `{ chapter }` on a door that already names a book id mean that book's
   chapter, and on `findAll` mean "chapter N of every book in scope"? The second
   reading is useful and might be surprising.
2. Is a scoped `mask` coherent, given the map's offsets are document-absolute?
   (We think yes — the ranges are already source spans — but the header's
   `sourceLen` checksum would need to say what it was cut from.)
3. Is chapter-scoped `lint` cheap enough to matter, or does the Pantry already
   make a whole-book lint fast enough that scoping it buys nothing?

## Expected return

A recommendation, not a patch: which doors should take `Scope`, which should
not and why, and whether the corpus words and the reference shapes belong in one
union or two. If the answer is "overlay already has it, use it, the rest is not
worth the churn" — that is a fine answer and we will take it; the consistency
claim is the part we want tested, not the feature.

## Pointers

- `galley/src/wasm.md` — "The find buffer", "The census buffer", "The overlay
  doors", "Every onion door, on the same module".
- `onion/src/format.rs` (`format_edits`, `format_edits_in`), `onion-wasm/src/lib.rs`.
- `galley/src/overlay.md` — the overlay contract and its scope.
- Sefer side: `src/core/galley/overlay.ts` (`OverlayOptions`),
  `src/app/workflows/stet.ts`, `src/core/fixes/fixes.ts`.
- Related asks from this consumer: `planning/01-discussing/engine-asks-2026-09-14.md`,
  items 8, 9, 10 and 10b.

## Suggested skills

`/rails explore` over `galley/src/wasm.rs` and `onion-wasm/src/lib.rs` to
inventory every door's options bag before proposing the union; then `/rails review`
on the proposal. Do not implement before the recommendation is agreed — the point
of this RFC is the shape, and the shape is cheap to get wrong once it is public.
