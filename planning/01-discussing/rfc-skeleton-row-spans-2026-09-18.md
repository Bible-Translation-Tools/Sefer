# RFC to scripture-kitchen — a skeleton row's span does not say which span it is

**Type:** upstream proposal, documentation-weight. From Sefer (`../Sefer`), 2026-09-18, on v0.1.4.
**Hand to:** a fresh agent in `scripture-kitchen`.

## Goal / definition of done

A consumer reading `skeleton()`'s output can tell, without experiment, what a
block row's `from..to` covers. "Done" is either one sentence in `overlay.md`,
or blocks carrying the second span pair verses already carry — and a decision
on which, with the reason written down.

## The asymmetry

`skeleton(id)` answers two row types. They use the same field names for
different things.

```ts
verses: [{ sid, from, to, textFrom, textTo }]   // the \v marker, AND the words
blocks: [{ sid, where, ordinal, marker, from, to, empty }]   // the marker ONLY
```

A verse says both: `from..to` is its `\v 1 ` and `textFrom..textTo` is the
sentence. A block says one, and nothing states which. It is the marker: `\p` is
two characters.

That is the RIGHT shape for what the overlay does — it inserts and removes
markers, so a marker's span is exactly what it needs to address. The problem is
only that a reader cannot tell from the shape, and the neighbouring row type
teaches the opposite lesson.

## How it actually bit

Sefer added "which block is the caret in, and which block answers it in the
reference beside it" (`src/app/ui/workspace/ReferencePane.tsx`). The lookup was
written as a containment test against `from..to`. On Genesis that is **491
two-character spans in a 204,738-character document**, so it answered "no block
here" for essentially every caret position, silently — the feature drew nothing
and there was no error to read.

The tell was not in the engine's docs but in a dump. Our own wrapper had
restated the ambiguity rather than resolving it: `SkeletonRow` was documented as
"an address, its span, and whether it holds words", which is the same sentence
with the same hole in it. (Fixed on our side; the wording now says marker, and
says the derivation is the caller's.)

## The workaround, and the measurement that makes it safe

A block runs from its own marker to where the NEXT block's marker begins. That
is only a safe rule if the rows behave, so we checked before relying on it —
over `testData/exampleCorpora/en_ulb`, all 66 books:

| rows | wider than 6 chars | out of order | overlapping |
| --- | --- | --- | --- |
| 31,720 | 0 | 0 | 0 |

So the derivation holds, and it is three lines
(`blockExtents` in `src/core/galley/overlay.ts`). **By the rule this consumer
was given — a reasonable workaround means it is not an API ask — this is a
documentation item, not a change request.** It is filed anyway because the
failure was silent, and a silent failure that every new consumer will hit once
is worth one sentence upstream.

## Proposed change, in order of preference

1. **One sentence in `overlay.md`**: a block row's `from..to` is its marker's
   own span; a block's extent runs to the next block's marker. Cheapest, and
   enough.
2. **Or: give blocks `textFrom`/`textTo`** the way verses have them, so the two
   row types read alike and no consumer derives anything. More surface, and
   arguably redundant — but it removes the asymmetry rather than explaining it,
   and "the field names mean the same thing on both rows" is a property worth
   having in an API that will grow more row types.

Not proposed: renaming the existing fields. Whatever is decided, `from..to`
should keep meaning the marker, because that is what the overlay addresses.

## Open questions

1. Is "to the next block's marker" the definition the ENGINE would give? It is
   what the data supports, but a `\c` boundary or the end of a chapter might be
   a truer terminator, and only the engine can say.
2. Is `empty` computed over the marker span or over the derived extent? A
   consumer reading `empty: true` and then slicing `from..to` gets two
   characters either way, so the flag is the only way to know the block has no
   words — worth stating that it is about the block and not the row.
3. Do `verses` and `blocks` share an ordering guarantee? We measured blocks are
   ascending and disjoint; nothing says they must stay so, and the derivation
   above depends on it.

## Expected return

A one-line doc change, or a decision that option 2 is worth the surface — plus
answers to the three questions, which are what a consumer needs whichever way
the field question goes.

## Pointers

- `galley/src/wasm.md`, "The overlay doors" — where the JSON shape is shown.
- `galley/src/overlay.md` — the contract.
- Sefer side: `src/core/galley/overlay.ts` (`SkeletonRow`, `blockExtents`,
  `blockAtOffset`), `src/app/ui/workspace/ReferencePane.tsx`.
- This consumer's other asks: `planning/01-discussing/engine-asks-2026-09-14.md`,
  items 8, 9, 10 and 10b (10b is this item, in that file's own format).

## Suggested skills

None needed — this is small enough to read and decide. If option 2 is taken,
`/rails review` on the wire change, since the skeleton is JSON rather than a
generated reader and there is no staleness test to catch a mismatch.
