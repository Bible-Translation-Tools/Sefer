# The excerpt as one compound component

**Status:** built, 2026-09-26 — the chosen UI for Find, Key terms (STET) and Findings/proofreading. "Built" below says what landed and where it departs from the decisions.

## Job

The excerpt card is the most pervasive piece of UI: it appears in Find, key terms (STET), findings, and soon review and history. It should look and feel like Zed's multibuffer, a small piece of your file. It should be one compound component built only from Address, the clip (satellite), and the book's table of contents. If a feature needs something those three can't express, a primitive is missing, and the fix goes in the primitive, not in a screen.

Design reference: the designer's Figma "Active Verse Reference" (Default / Edited / Approved / Approved with edits). The Target and the paired resource sit side by side, with an actions row and "Show more" in the footer. We take the layout, not the inline book name (see Header).

Terms (glossary): **Target** is the heart-language text being written or revised. **Paired resource** is whatever is viewed beside it. The paired resource is never called "the source".

## Decided

- **Every card body is a real satellite.** It's read-only until you double-click or press the explicit Edit button.
  - It uses the same projection and the same regular-mode rules as the editor. Nothing gets flattened, and it isn't plain HTML.
  - Edits coalesce like the editor's and are funneled to the canonical Book: one write path and one undo.
  - Later, the markup might be made fully immutable inside a small window (possibly a setting to lock verse markup). Not now.
- **Regular or USFM** follows the shell's mode, as in the editor.
- **Header:** where the hit is, as today (`Excerpt.label`). It does not show the range on screen.
  - It's one small title row on the card. The book name stays out of the body, because the designer's inline bookmark and name are decoration the real editor doesn't have.
- **Context control:** a three-part segmented button: **↑ one TOC step · whole chapter · ↓ one TOC step.**
  - Both arrows are pure table-of-contents steps, whatever the next TOC entry is.
  - The default amount of context is a setting.
- **Actions slot:** a footer region for arbitrary per-feed UI.
  - For STET, it will eventually mean "at this hash, I viewed and approve this usage". That is one user's record of what they've looked at, kept off the repo.
  - For proofreading, it might hold a quick "show every hit of this pattern" filter.
  - What "approved" means is not being designed yet; the slot just has to exist.
- **Paired resource:** can be turned on or off.
  - It follows the Target's context when the Target is bumped (locked ranges).
  - When an address is missing on one side, that side shows a per-address fallback.
  - A collapse control shrinks the non-hit side back to just the hit.
- **Layout:** a container query. Side by side when there's room, stacked when narrow.

### Per feed

| Feed     | Target side                                         | Paired resource side                                                                                                                                                                |
| -------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find     | The full component                                  | Same component, read-only. In the reference scope the hit is on this side (reverse search) and your Target is the card you edit.                                                    |
| STET     | The full component                                  | The guide's static reading: **no USFM mode and no context**, because it was built against a frozen text. Those pieces are unsupported and hidden; everything else behaves the same. |
| Findings | The full component, with findings in the notes slot | None                                                                                                                                                                                |

## Built (2026-09-26)

- **Core** (`src/core/excerpts/excerpts.ts`, `src/core/location/locate.ts`):
  - Location exports its units (`tocUnits`, `unitIndexAt`, `unitAddress`): the introduction, each chapter's head, each verse. Cards group by unit and step by unit.
  - `Extent` is TOC steps `{ up, down, chapter? }`, crossing chapters. `extend` rebuilds from the own unit.
  - `pairedExcerpt` locks a paired resource to the target by Address (first and last shown place), falls back to the own unit for an end the other text lacks, and returns nothing when the own place is missing. `collapsed` shows the own unit alone.
  - A shown span stops at its last text token, so a verse followed by a bare `\p` doesn't end on an empty paragraph.
  - The excerpt carries its book's `analysis`; the flattened `text`/`verses`/`focus` projection is gone (`marks` stays, Findings uses it).
- **Editor** (`src/editor/recipes/reader.ts`, `satellite.ts`):
  - `mountReader` is the read-only view: the editor's reading layer plus the satellite's own clip (`clipped`, `reclip`, `wholeLines`), with the parse passed in and the structure lent to every later view of the same book.
  - Marks carry a class: hit, current, error/warning/info, context. `remark` repaints them.
- **Card** (`src/app/ui/excerpts/ExcerptCard.tsx`, `ExcerptReader.tsx`):
  - Header, notes, paired resource plus target, and a footer holding the context control and an actions slot.
  - Double-click or Edit swaps the reader for the satellite, with the caret where you clicked.
  - A ResizeObserver on the card sets side by side (720px and up) or stacked. Stacked collapses the paired side to the match; one button flips either default.
- **Setting:** "Context around a result" (`excerpts.context`, default 1 step), read when a list opens.
- **Feeds:**
  - Find's reference scope pairs a parsed reference (`kind: "text"`).
  - Key terms pairs the guide's reading (`kind: "static"`: no mode, no context).
  - Findings uses the card unchanged, with tones.

**One departure, on purpose:** the resting card is a read-only _reader_, not a read-only satellite. A satellite needs a seated Book, and seating means an editor-backed Book with a backup journal, per book shown. A list of forty results across twelve books would seat twelve books to be looked at. The reader is the same projection over the same parse, and Edit seats exactly one. To the eye they are one surface.

## Next

- **Verse-markup lock:** a policy toggle in the matrix later (all markup immutable inside a small window), not a card feature.
- **Diff review by verses** could be this card: the actions slot picks a side of the decision map, and the body needs an intra-word diff. It's not yet the default for diff.
- **Measure** mounting cost on a big book (en_ulb Psalms) at twenty cards and while scrolling; pool views in the reader if it shows.

## Open

- Whether the lock holds when stacked, or only side by side.
- Whether the "lock verse markup" setting ever becomes real.
