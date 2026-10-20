import type { EditorPolicy } from "@sefer/editor";
import type { BookId } from "@sefer/text/book";
import type { JSX } from "@solidjs/web";

import type { Excerpt, Extent, OutlineRow, BookExcerpts } from "#core/excerpts/excerpts";

import type { CardAction } from "../multibuffer/CardAction";
import type { CardView, ContextStep } from "../multibuffer/cardState";
import type { MarkTone } from "./ExcerptCard";

export type Marks =
  | { readonly kind: "hits" }
  | {
      readonly kind: "toned";
      readonly tone: (source: number | undefined, excerpt: Excerpt) => MarkTone | undefined;
    };

export type Edit =
  | { readonly kind: "none" }
  | { readonly kind: "satellite" }
  | { readonly kind: "direct" };

export type UsfmSwitch =
  | { readonly kind: "never" }
  | { readonly kind: "when"; readonly offer: (excerpt: Excerpt, key: string) => boolean };

export type Context =
  | { readonly kind: "none" }
  | { readonly kind: "steps"; readonly step: (sid: string, step: ContextStep) => void }
  | {
      readonly kind: "chapter";
      readonly from: Extent;
      readonly step: (sid: string, step: ContextStep) => void;
    };

export type Open =
  | { readonly kind: "none" }
  | { readonly kind: "editor"; readonly to: (bookId: BookId, from: number, to?: number) => void };

type Slot<Out> = (excerpt: Excerpt, key: string, view: CardView) => Out;

export interface ExcerptCardSpec {
  readonly marks: Marks;
  readonly edit: Edit;
  readonly usfm: UsfmSwitch;
  readonly context: Context;
  readonly open: Open;
  readonly title?: Slot<JSX.Element | undefined>;
  readonly info?: Slot<JSX.Element>;
  readonly notes?: Slot<JSX.Element>;
  readonly actions?: Slot<readonly CardAction[]>;
  readonly condensed?: (excerpt: Excerpt, key: string) => boolean;
  readonly onActivate?: (excerpt: Excerpt, key: string) => void;
  readonly before?: (excerpt: Excerpt, key: string) => JSX.Element | undefined;
  readonly after?: (excerpt: Excerpt, key: string) => JSX.Element | undefined;
  readonly status?: (excerpt: Excerpt, key: string) => JSX.Element | undefined;
  readonly policy?: (mode: "regular" | "usfm") => EditorPolicy;
  readonly extraHeight?: (excerpt: Excerpt, key: string) => number;
}

export interface OutlineSpec {
  readonly sectionKey?: (group: BookExcerpts) => string;
  readonly rowKey?: (group: BookExcerpts, excerpt: Excerpt) => string;
  readonly title?: string;
  readonly label?: (row: OutlineRow) => string;
}

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
