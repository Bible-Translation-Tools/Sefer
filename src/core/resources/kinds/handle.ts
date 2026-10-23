import type { BookId } from "@sefer/text/book";
import type { Address } from "@sefer/text/location/address";
import { Data, type Effect } from "effect";

import type { ContentKind } from "./content";
import type { Note } from "./tn/note";

export class Unavailable extends Data.TaggedError("Unavailable")<{
  readonly reason: "Missing" | "Unreadable" | "Unsupported";
  readonly description: string;
}> {}

export interface PlaceContext {
  readonly versesIn?: (book: BookId, chapter: number) => number | undefined;
}

export interface Places<Entry> {
  readonly at: (
    address: Address,
    context?: PlaceContext,
  ) => Effect.Effect<readonly Entry[], Unavailable>;
  readonly of: (entry: Entry) => readonly Address[];
}

export interface HaystackDocument {
  readonly id: string;
  readonly text: string;
  readonly addresses: readonly Address[];
}

export interface Documents {
  readonly list: (
    books: readonly BookId[],
    context?: PlaceContext,
  ) => Effect.Effect<readonly HaystackDocument[], Unavailable>;
}

export interface Edit {
  readonly fileAt: (address: Address) => Effect.Effect<string, Unavailable>;
}

export interface HandleInfo {
  readonly content: ContentKind;
  readonly title: string;
  readonly language?: string;
  readonly direction: "ltr" | "rtl";
}

export interface ResourceHandle<Entry> {
  readonly info: HandleInfo;
  readonly places?: Places<Entry>;
  readonly documents?: Documents;
  readonly edit?: Edit;
  readonly release: Effect.Effect<void>;
}

interface EntryOf {
  readonly usfm: never;
  readonly tn: Note;
  readonly tq: never;
  readonly tw: never;
  readonly "macula-greek": never;
  readonly "macula-hebrew": never;
}

export type OpenHandle = {
  readonly [K in ContentKind]: {
    readonly content: K;
    readonly handle: ResourceHandle<EntryOf[K]>;
  };
}[ContentKind];
