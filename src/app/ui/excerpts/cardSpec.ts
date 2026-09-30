/**
 * What an excerpt screen's cards DO, declared once per screen.
 *
 * Every card on Find, Key terms and Findings is the same component over the
 * same model; what differs is behaviour, and each behaviour is a choice among
 * named variants rather than an optional to remember:
 *
 *  - `marks`: how a highlight reads — a hit, or toned by what it means;
 *  - `edit`: whether a card can be edited in place (a satellite over the
 *    canonical Book), or is read-only;
 *  - `usfm`: whether a card offers its own switch to USFM, and when;
 *  - `context`: whether a card can be widened, and who is told a step;
 *  - `open`: whether a card offers the way out to the editor.
 *
 * The slots — `title`, `info`, `notes`, `actions` — are functions of the card
 * and its view (`cardState.ts`), so what a card says and offers can follow
 * what the reader has done to it. `excerptCard(context, open)` is Find's card;
 * a screen names only what it changes.
 *
 * A flush policy is deliberately absent. Everything is fast today, and the
 * editors tell you the truth quickly; when something slow arrives it is a
 * member on `edit`'s satellite variant, and the compiler finds every screen.
 */

import type { JSX } from "@solidjs/web";

import type { BookId } from "#core/book/book";
import type { Excerpt, OutlineRow, BookExcerpts } from "#core/excerpts/excerpts";
import type { EditorPolicy } from "#editor/index";

import type { CardAction } from "../multibuffer/CardAction";
import type { CardView, ContextStep } from "../multibuffer/cardState";
import type { MarkTone } from "./ExcerptCard";

/** How a highlight reads. */
export type Marks =
  | { readonly kind: "hits" }
  | {
      /** By what it means — an error, a warning — at the occurrence's source offset. */
      readonly kind: "toned";
      readonly tone: (source: number | undefined, excerpt: Excerpt) => MarkTone | undefined;
    };

export type Edit =
  | { readonly kind: "none" }
  /** Double-click, or the header's Edit, opens the satellite; Done closes it. */
  | { readonly kind: "satellite" }
  /** The target is plainly an input: bordered, one click edits, no Edit or Done. Key terms'. */
  | { readonly kind: "direct" };

export type UsfmSwitch =
  | { readonly kind: "never" }
  /** Offered where the card has a reason — Findings: a finding in markup. */
  | { readonly kind: "when"; readonly offer: (excerpt: Excerpt, key: string) => boolean };

export type Context =
  | { readonly kind: "none" }
  /** The default steps — a unit up or down, the whole chapter, fold — told to `step`. */
  | { readonly kind: "steps"; readonly step: (sid: string, step: ContextStep) => void }
  /** One expand control, at the footer's end: the whole chapter, or back. Key terms'. */
  | { readonly kind: "chapter"; readonly step: (sid: string, step: ContextStep) => void };

export type Open =
  | { readonly kind: "none" }
  | { readonly kind: "editor"; readonly to: (bookId: BookId, from: number, to?: number) => void };

/** One card's slot, as a function of the card, its row key and its view. */
type Slot<Out> = (excerpt: Excerpt, key: string, view: CardView) => Out;

export interface ExcerptCardSpec {
  readonly marks: Marks;
  readonly edit: Edit;
  readonly usfm: UsfmSwitch;
  readonly context: Context;
  readonly open: Open;
  /** Replaces the place in the header — Findings' "Genesis · front matter". */
  readonly title?: Slot<JSX.Element | undefined>;
  /** Badges beside the title: what the place IS. */
  readonly info?: Slot<JSX.Element>;
  /** Lines under the title, inside the header's border. */
  readonly notes?: Slot<JSX.Element>;
  /** The footer's actions. */
  readonly actions?: Slot<readonly CardAction[]>;
  /**
   * Is this card condensed — one dimmed line of each side, no actions — while
   * another is the active one? Key terms'. Absent, every card is whole.
   */
  readonly condensed?: (excerpt: Excerpt, key: string) => boolean;
  /** A condensed card was clicked: make it the active one. */
  readonly onActivate?: (excerpt: Excerpt, key: string) => void;
  /** Drawn above or below the card, inside its row: Key terms' accordion. */
  readonly before?: (excerpt: Excerpt, key: string) => JSX.Element | undefined;
  readonly after?: (excerpt: Excerpt, key: string) => JSX.Element | undefined;
  /** A status mark for the card's line (Key terms' approved check), drawn condensed too. */
  readonly status?: (excerpt: Excerpt, key: string) => JSX.Element | undefined;
  /**
   * The behaviour matrix this screen's cards opt into, in the reader's
   * current mode — reader, editing satellite and paired side alike, and the
   * Book judges the satellite's edits under it. Absent, the mode alone
   * (`editorPolicy(mode)`). Key terms: notes hidden and immutable in Regular.
   */
  readonly policy?: (mode: "regular" | "usfm") => EditorPolicy;
  /** Pixels this card carries beyond the verse, before it has been measured. */
  readonly extraHeight?: (excerpt: Excerpt, key: string) => number;
}

/**
 * What the list says about its sections: the outline beside the cards. The
 * list's, not a card's — so it is its own declaration.
 */
export interface OutlineSpec {
  /**
   * A section's key, when one book is two sections (Key terms: its core
   * verses, then its additional ones). Defaults to the book.
   */
  readonly sectionKey?: (group: BookExcerpts) => string;
  /**
   * A row's key, when the sid alone is not unique. Grouping by code puts one
   * verse in two sections, and a virtualizer keyed on a repeated string
   * positions the second one on top of the first. Defaults to `excerpt.sid`.
   */
  readonly rowKey?: (group: BookExcerpts, excerpt: Excerpt) => string;
  /** The outline column's own label, when its rows are not books. */
  readonly title?: string;
  /** One outline row's text. Defaults to the section key. */
  readonly label?: (row: OutlineRow) => string;
}

/** Find's card: hits, editable, no USFM switch; the steps and the way out are the screen's. */
export const excerptCard = (
  context: Context,
  open: Open,
  more: Partial<ExcerptCardSpec> = {},
): ExcerptCardSpec => ({
  marks: { kind: "hits" },
  edit: { kind: "satellite" },
  usfm: { kind: "never" },
  context,
  open,
  ...more,
});
