/**
 * What an open resource can do: the capability record between the two
 * places a `ContentKind` is consulted (`content.ts`'s `recognize`, the
 * renderer registry). Nobody between them asks which kind a handle is; they
 * ask whether it has a slot.
 *
 * Tier 2 (`planning/items/2026-10-06-resource-kinds.mdx`, §2): the
 * only vocabulary that crosses is `Address`. Not USFM — no marker, no Book,
 * no engine — so a kind with no text at all (Macula's blob) fills it as
 * readily as a folder of Markdown.
 *
 * Every call is an Effect: one colour, interruption when the reader moves on,
 * and a typed `Unavailable`. A slot is optional because a kind fills what it
 * has; adding a slot later leaves every adapter compiling unchanged.
 *
 *     slot        TN (built)               TW (named)                 Macula (named)
 *     places      notes covering a verse   articles a verse links     the verse's words
 *     documents   one per note             one per article            — (its own faceted find)
 *     edit        typed, absent            absent                     absent: alignment is a write to the project
 */

import type { BookId } from "@sefer/text/book";
import type { Address } from "@sefer/text/location/address";
import { Data, type Effect } from "effect";

import type { ContentKind } from "./content";
import type { Note } from "./tn/note";

/** Why a handle could not answer. Typed, so a pane says it rather than throwing. */
export class Unavailable extends Data.TaggedError("Unavailable")<{
  /** `Missing`: nothing for that book. `Unreadable`: bytes there, but not readable. `Unsupported`: no reader for this kind. */
  readonly reason: "Missing" | "Unreadable" | "Unsupported";
  readonly description: string;
}> {}

/**
 * What a resource may borrow to answer: today, the open project's table of
 * contents. A layout that leaves a range open (TN's last chunk of a chapter,
 * TQ's first-verse files) closes it with `versesIn`; one that does not need
 * it ignores it. Named because it is a stand-in: resources are numbered by
 * their own versification, and mapping between schemes is a primitive
 * Location does not have yet (plan §11.1).
 */
export interface PlaceContext {
  readonly versesIn?: (book: BookId, chapter: number) => number | undefined;
}

/** Address in, the kind's own entries out; and an entry's places back. */
export interface Places<Entry> {
  /** What the resource holds at a place — notes for a verse, a verse's words. */
  readonly at: (
    address: Address,
    context?: PlaceContext,
  ) => Effect.Effect<readonly Entry[], Unavailable>;
  /** Where one entry is: one place for a note, many for a dictionary article. */
  readonly of: (entry: Entry) => readonly Address[];
}

/**
 * One unit of a kind's haystack for the default text find: a text to match
 * and the places it belongs to. The override point is HERE, not in the
 * matcher — a kind supplies what is searched; matching and mapping back are
 * shared (`core/search`'s `findInDocuments`).
 */
export interface HaystackDocument {
  /** The kind's own key, unique within the handle; display and joins only. */
  readonly id: string;
  readonly text: string;
  readonly addresses: readonly Address[];
}

export interface Documents {
  /**
   * The haystack for these books. A kind whose entries are not filed by book
   * (a dictionary) may answer every entry that names one of them.
   */
  readonly list: (
    books: readonly BookId[],
    context?: PlaceContext,
  ) => Effect.Effect<readonly HaystackDocument[], Unavailable>;
}

/**
 * Editing, typed and not built. The edit unit of a file-backed kind is a file
 * (TN: the chunk), opened as a Book like any other text, so Book brings
 * changes, history, the journal and explicit save. Read-only is the absence
 * of this slot.
 */
export interface Edit {
  /** The file, relative to the resource's root, that holds what is at `address`. */
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
  /** Lets go of what the handle holds (packs in memory; a wasm corpus). */
  readonly release: Effect.Effect<void>;
}

/**
 * Each kind's entry. A kind with no reader yet has none to give; when TW
 * arrives its entry is an article, and Macula's a verse of words.
 */
interface EntryOf {
  readonly usfm: never;
  readonly tn: Note;
  readonly tq: never;
  readonly tw: never;
  readonly "macula-greek": never;
  readonly "macula-hebrew": never;
}

/** An open handle, with its kind: what the renderer registry switches on. */
export type OpenHandle = {
  readonly [K in ContentKind]: {
    readonly content: K;
    readonly handle: ResourceHandle<EntryOf[K]>;
  };
}[ContentKind];
