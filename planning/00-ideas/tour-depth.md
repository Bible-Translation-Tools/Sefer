# Tours with depth: "See more", and one tour at two levels (idea, 2026-10-13)

Will's ideas, written down, not built. Two of them:

1. **"See more" on a card.** A tour card stays short. A "See more" link on it
   opens a modal with the deeper explanation. Examples: why Save and Review
   work the way they do (explicit saves, the backup journal, one decision
   commit, never forced), and the technical layer underneath (the commits, the
   copy remote, what a fast-forward is).
2. **Versions of the same tour.** The same walk at two depths: a high-level
   one for a translator, and a technical one for an admin or a developer. The
   same screens and the same anchors, with different words and maybe a few
   extra steps.

## How loosely the tour code is attached today

All of it lives in `src/app/tour/`:

- `machine.ts`: the step machine (`go`, `ready`, spotlight or panel,
  `advance`).
- `TourOutlet.tsx`: draws the ring and the card. It is mounted once in the
  chrome.
- `TutorialsCard.tsx`: Settings' list.
- `tours/`: one file per tour, gathered in `tours/index.ts`.

Screens only carry `data-tour="…"` handles. No state is lifted for a tour's
sake ([shell](../../documentation/architecture/shell.md), "Tutorials and
workflows"). Both ideas should keep it that way: they touch the step data and
the outlet, never a screen.

## How each would fit

**"See more".** Give `Spotlight` (and `Panel`) an optional `more`: a title and
a body, or the id of a longer text. The outlet draws a "See more" link when
`more` is present, and opens the existing `Dialog` primitive over the card. It
is just more data on the step, and one link and one dialog in the outlet.
Nothing in the machine changes: opening the modal is not a step and does not
advance.

- **Where long text lives.** Inline strings are fine for a paragraph. For the
  save-and-review philosophy, which is pages long and already half-written in
  `documentation/architecture/review.md` and `sync.md`, keep reader-facing
  copies beside the tours (`tours/more/*.ts` or Markdown loaded as text),
  rather than pointing the app at developer docs that change for other
  reasons.
- **Escape.** The modal should take Escape first and call `preventDefault`.
  The outlet already ignores an Escape that something else handled (round 4),
  so closing the modal does not end the tutorial.

**Two levels of one tour.** Two shapes are possible:

- **Two entries, shared steps (preferred to start).** `notes.ts` exports
  `notesTour` and `notesTourTechnical`, both built from one `steps(level)`
  function. The function swaps titles and bodies, and adds or drops a step,
  by `level`. Each is an ordinary `Tour` in `TOURS`, with its own id, so
  `?tour=notes-technical`, the palette and Settings need no change. Settings
  may want to group them later.
- **One tour, a level setting.** A `level` preference read by `steps` when the
  tour starts (tours already build steps at start, as workflows do), plus a
  switch on Settings' Tutorials tab. Less duplication in the list, but one
  more preference, and the machine starts caring about who the reader is.
  Better left until more than one tour wants it.

The two ideas combine: the high-level version can put its technical depth
behind "See more" instead of in extra steps. That may make the second version
unnecessary for most tours. Try "See more" first, on the save-and-review
tour, and see whether a separate technical walk is still wanted.

## Not decided

- Whether the technical text is translated with the rest of the UI.
- Whether "See more" may link onward (to Settings, or to a doc page) or must
  stay a dead end inside the modal.
