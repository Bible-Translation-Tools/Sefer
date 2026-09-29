# Cards as composition: plan for discussion

**Status:** in progress on review/2026-09-26, 2026-09-29, one commit per step. Will: the UI conflicts with master are minimal, and the merging agent replays their intent on top; the behaviour is this branch's. No new tests (the standing rule); the pure modules are listed as candidates in `documentation/architecture/testing.md`.

## Why

Every excerpt screen (Find, Key terms, Findings, Review, the playground) now uses one card shape. The shape is shared; the behaviour around it is not. The 2026-09-29 sanding pass showed the cost: each fix landed as a special case in a different place, and some of them interact.

- **Per-card state lives in five places.** Extent is in the feed, keyed by sid. The last widening of a resolved card is `lastShown` in `ExcerptList`, keyed by row and never cleared. The USFM switch is a local signal in `ExcerptCard`. Review's markup switch is a local signal in `DiffCard`. Folded runs are in `FindingsPanel`. The list unmounts cards that scroll out, so the local signals reset: switch a card to USFM, scroll away and back, and it is in the reading again.
- **`VirtualList` scrolling is imperative heuristics.** There is the first-measurement refusal, the re-aim loop, holding the edited row across a rebuild, and always compensating above an edited row. Each fixed a case reproduced on the fixture. They are untested and they interact: the 20px nudge on the last row is one of those interactions.
- **Card titles are built two ways.** `ExcerptCard` gets `location.label(address)` from core. `DiffCard` pastes `bookName + " " + hunk.reference` itself.
- **`ExcerptDecor` is an 11-callback bag of optionals** (label, badges, notes, actions, openable, offerUsfm, markTone, extraHeight, rowKey, outlineTitle, outlineLabel). A behaviour is switched on by remembering the right optional. Nothing says which behaviours make sense together.

## Goal

1. **Pure** decisions: the scroll math, card-state transitions, what a change or finding paints, the title. No Solid, no DOM, unit-testable.
2. **Composable behaviours**, declared per screen and typed: marks drawn or not, edits flushed immediately or debounced, a USFM switch or not, context steps with defaults (a verse up or down, the whole chapter), any number of actions over the same state.
3. A **UI that decomposes along those behaviours**: named slots on one frame, discriminated unions where a behaviour has variants, one button contract for every action.

## Step 1 — the scroll decisions are pure (`primitives/virtualScroll.ts`) — done

Beside `VirtualList`, not in `multibuffer/`: the list is a primitive (the WACS catalogue table uses it too).

These move out of `VirtualList` as functions over plain numbers and arrays:

```ts
/** Where the scroll goes so `anchor` stays where the reader saw it. */
holdRow(before: Starts, after: Starts, anchor: string, scrollTop: number): number
/** Should this height correction move the viewport? */
compensates(c: { index; measuredBefore: boolean; pinnedIndex?: number; end: number; fold: number }): boolean
/** One frame of a jump: keep aiming, or settled. */
aim(state: AimState, now: { scrollTop; target }): AimState   // { kind: "aiming"; still } | { kind: "settled" }
/** The row a rebuild holds the reader by: the pinned one, else the first on screen still present. */
anchorOf(onScreen: readonly string[], pinned: string | undefined, has: (key: string) => boolean): string | undefined
```

`VirtualList` keeps only the binding to `virtual-core` and Solid. Also: holding a row does a linear search of the measurements on every rebuild. Measure it at 86k rows; if it matters, keep a key → index map.

## Step 2 — one per-card view state, held by the screen (`multibuffer/cardState.ts`, `cardViews.ts`) — done

```ts
interface CardView {
  readonly extent: Extent;          // context steps; default = the screen's setting
  readonly usfm: boolean;           // this card alone in USFM
  readonly folds: ReadonlySet<string>;
  readonly shown?: unknown;         // what was last drawn, for a card held after its result ended
}
type CardEvent =
  | { kind: "step"; step: ContextStep }      // up, down, chapter, fold — the defaults
  | { kind: "usfm"; on: boolean }
  | { kind: "fold"; id: string }
  | { kind: "drawn"; shown: unknown }
  | { kind: "reset" };
reduce(view: CardView, event: CardEvent): CardView   // pure
```

The store is one keyed map beside `CardList`'s edit session. Its policy lives in one place: prune on a new query, but never prune the pinned card. The feed's extent map, `lastShown` and the Findings fold set move into it. `DiffCard` and `ExcerptCard` become functions of `(item, view)` and send events. "Remember what the card being worked on was showing" then needs no special case.

## Step 3 — one title (`core/location` label) — done

A card's title is `location.label(address)` everywhere. A `Hunk` carries its `Address` (it already builds one for its key), not a preformatted `reference`. `DiffCard` stops taking `bookName`. Ranges, intros and front matter then read the same on every screen.

## Step 4 — named slots and a card spec, replacing `ExcerptDecor` — done

One frame with named slots. A body is a discriminated union, so an excerpt card and a diff card are the same frame with a different body:

```ts
interface CardFrameSlots {
  readonly title: JSX.Element; // the place
  readonly info?: JSX.Element; // badges: severity, "markup only", stale
  readonly notes?: JSX.Element; // lines under the title, inside the header border
  readonly headerActions?: readonly CardAction[];
  readonly body: JSX.Element;
  readonly context?: JSX.Element; // footer left: the context control
  readonly actions?: readonly CardAction[]; // footer right
}

/** Every button on a card, one contract: rendered by the frame, never hand-built. */
interface CardAction {
  readonly id: string;
  readonly label: string; // also the accessible name
  readonly icon?: Component;
  readonly iconOnly?: boolean;
  readonly pressed?: boolean; // a toggle
  readonly tone?: "default" | "primary";
  readonly onPress: () => void;
}
```

Each screen declares what its cards do, as a typed spec instead of a bag of optionals:

```ts
interface CardSpec<Item> {
  readonly title: (item: Item) => Address;
  readonly info?: (item: Item, view: CardView) => JSX.Element;
  readonly notes?: (item: Item, view: CardView) => JSX.Element;
  readonly actions?: (item: Item, view: CardView) => readonly CardAction[];
  readonly marks: Marks<Item>;
  readonly edit: Edit;
  readonly usfm: UsfmSwitch<Item>;
  readonly context: Context;
  readonly open: Open<Item>;
  readonly height: (item: Item, view: CardView) => number;
}

type Marks<Item> =
  | { kind: "none" }
  | { kind: "hits" } // Find, Key terms
  | { kind: "toned"; tone: (item: Item, source?: number) => MarkTone } // Findings
  | { kind: "diff"; paint: (item: Item, view: CardView) => DiffPaint }; // Review

type Edit =
  | { kind: "none" } // a read-only review, a zip
  | { kind: "satellite" }; // edits the canonical Book

type UsfmSwitch<Item> =
  { kind: "never" } | { kind: "always" } | { kind: "when"; offer: (item: Item) => boolean }; // Findings: in markup; Review: markup only

type Context = { kind: "none" } | { kind: "steps"; default: Extent }; // up, down, chapter, fold: the defaults

type Open<Item> =
  | { kind: "none" } // Findings
  | { kind: "editor"; at: (item: Item) => { bookId: BookId; from: number; to?: number } };
```

The outline half of `ExcerptDecor` (`rowKey`, `outlineTitle`, `outlineLabel`) moves to a separate `OutlineSpec`, because it describes the list, not the card. Findings' `extraHeight` becomes `height`, rewritten for the current layout (notes in the header, Fix in the footer); the current estimate is stale.

**The four screens as specs, as a check that the unions are right:**

|           | marks | edit                                             | usfm             | context | open          | actions                 |
| --------- | ----- | ------------------------------------------------ | ---------------- | ------- | ------------- | ----------------------- |
| Find      | hits  | satellite                                        | never            | steps   | editor        | —                       |
| Key terms | hits  | satellite                                        | never            | steps   | editor        | —                       |
| Findings  | toned | satellite                                        | when in markup   | steps   | none          | Fix per fixable finding |
| Review    | diff  | satellite, or none when neither side is writable | when markup only | steps   | editor (book) | Keep / Take (header)    |

## Order and verification

One commit per step, in the order above: 1 and 3 are small and independent, 2 needs 1's anchor for "hold the pinned card", and 4 builds on 2's `CardView`. After each step, re-run on the fixture the cases reproduced on 2026-09-29:

- a jump into an unmeasured book lands exactly;
- a result inserted above the edited card doesn't move it;
- a resolved card keeps its chapter;
- the sidebar switches between screens;
- the USFM switch survives scrolling away and back (currently fails).

## As built, where it differs from the sketch

- **The view is keyed by what the card is about** — a verse's sid on the excerpt screens (a widening is about the verse wherever it is shown), a hunk's key on Review — and held by the screen's feed, not by `CardList`, because the feed builds the widened excerpts from it.
- **`drawn` is one slot, not a field of every view:** only the card being edited is ever read back, when its result ends. The old `lastShown` map grew without bound.
- **The spec is the excerpt screens'.** `DiffCard` takes the same frame slots and the same `CardAction` contract, but not an `ExcerptCardSpec`: its body is the diff by definition, and Review has one screen. If a second diff screen arrives, its spec is the next step.
- **`CardAction` is a union of `button` and `icon`**, so an icon without words must carry an icon and uses its label as the accessible name. Toggles are `pressed`, which `Button` already styles. Every card button answers to `data-card-action="<id>"`.
- **The USFM switch moved to the header's actions**, on the right with Edit, rather than beside the badges: every header button is now a header action.
- **Findings' height hint kept its name and formula** (`extraHeight`: 8px plus a line per folded run). The notes moved inside the header's border, but a line is still a line; Fix sits in the footer the context control already opens, so it adds nothing.
- **No pruning.** Views are not cleared on a new query: a view is keyed by the verse, so a widening the reader asked for comes back with the verse, as the feed's extents always did. The store holds one small entry per card the reader touched.
- **Card titles:** `Hunk.address` and `Hunk.label`, labelled by the `label` its builder is given (`location.label`), as `BookText.label` labels an excerpt.

## Decided

- **Tests:** none now, as the standing rule says; `virtualScroll.ts` and `cardState.ts` are added to the unit-test candidates, with the cases each one must pin.
- **Flush:** not grown today. Everything is fast, and Will's goal stands: the editors tell you the truth quickly. `Edit` has no flush field. When something slow arrives, `{ kind: "satellite"; flush: … }` is an additive member on the spec, and the compiler finds every screen.
