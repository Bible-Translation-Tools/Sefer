# 07 — Source, visual, chapter, and whole-book views

Status: proposed. Prerequisites: [05](v2-05-editor-donor-and-policy.md), [06](v2-06-transactions-and-undo.md). Owns: translator-facing projection and navigation.

## Outcome and increments

1. Ship a truthful source view and a bounded visual reading/editing view over the same source. Mode changes preserve history and canonical offsets.
2. Add chapter navigation using engine TOC/anchors. A chapter is a view clip over the book, not a second document. Admission protects the actual source boundary even when a replacement expands.
3. Support whole-book view with viewport-bounded decoration work. Measure initial mount separately: the donor's first build can still be whole-book even after steady-state viewport optimization.
4. Rebuild navigation after source edits to chapter structure. Clamp or recover selection with an explicit policy when an anchor disappears; do not treat chapter numbers as permanent identities.

## Contract and failures

Visual hiding does not delete bytes. Malformed USFM remains available for source repair. Hidden markup, notes, empty structures, and source order have conservative behavior. A hidden finding can navigate by a presentation anchor without changing its semantic location.

## Useful proof

Real browser tests for chapter boundaries, source/visual switching, selection and scroll recovery, and a representative malformed structure. A ranged-decoration equivalence property belongs with the rendering implementation; one application measurement confirms it helps actual typing and scrolling. A screenshot alone cannot prove hidden-byte preservation.

## Open questions

Which unsupported constructs initially show source fallback? What are table/sidebar and empty-wrapper policies? Does whole-book first mount need a seeded render range? Which projection settings are global versus per view? Do not resurrect semantic `BuildOpts` flags that diverge from the registry. Input and accessibility acceptance remains [08](v2-08-input-and-accessibility.md), not inferred from a pretty visual view.
