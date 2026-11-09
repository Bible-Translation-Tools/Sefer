import type {
  Place as GalleyPlace,
  Resolution as GalleyResolution,
} from "@wycliffeassociates/scripture-kitchen/web";

import type { BookId } from "../book";
import type { Address, Resolution } from "../location/address";

/**
 * galley's place doors over one text, as the host that parsed it binds them:
 * `resolve`, `addressAt` and `places`, all in UTF-16. A host binds a
 * registered book's id doors with `expect` set to this text's hash, and the
 * `…Of(text)` doors once galley answers that the id has moved on.
 */
export interface PlaceDoors {
  readonly resolve: (address: Address) => GalleyResolution;
  readonly addressAt: (offset: number) => Address;
  readonly places: () => readonly GalleyPlace[];
}

/**
 * One step through a text: galley's place (the introduction, a chapter's
 * head, a title, a verse's tile) as stepping wants it. `from..to` is the whole
 * tile, heading and paragraph marker included, and units tile the text.
 */
export interface Unit {
  readonly from: number;
  readonly to: number;
  /** Where the place's own marker is: the `\v`, the `\c`, the `\d`. */
  readonly marker: number;
  readonly address: Address;
  /** The chapter the place is in; 0 for the introduction or a book with no chapters. */
  readonly chapter: number;
}

export interface Places {
  /** Where `address` is in this text. The Address's book is the caller's to match. */
  readonly resolve: (address: Address) => Resolution;
  /**
   * The place at `offset`, named in `book`. `undefined` outside
   * `[0, length]`: the end-of-document caret is a real position, anything
   * past it is invalid input, not a clamp.
   */
  readonly addressAt: (book: BookId, offset: number) => Address | undefined;
  /** Every place in order, named in `book`. */
  readonly units: (book: BookId) => readonly Unit[];
}

const inBook = (book: BookId, address: Address): Address =>
  address.book === book ? address : { ...address, book };

const resolution = (wire: GalleyResolution, book: BookId): Resolution => {
  if ("found" in wire) {
    const { from, to, opening, covers, coarser } = wire.found;
    return { kind: "found", from, to, opening, covers: inBook(book, { ...covers, book }), coarser };
  }
  if ("missing" in wire)
    return wire.within === undefined
      ? { kind: "missing", missing: wire.missing }
      : { kind: "missing", missing: wire.missing, within: wire.within };
  return { kind: "ambiguous", spans: wire.ambiguous.map(({ from, to }) => ({ from, to })) };
};

const chapterOf = (address: Address): number => {
  switch (address.kind) {
    case "chapters":
      return address.from;
    case "verses":
      return address.from.chapter;
    default:
      return 0;
  }
};

export const placesOf = (length: number, doors: PlaceDoors): Places => {
  const named = new Map<number, Address>();
  let listed: readonly GalleyPlace[] | undefined;
  const steps = new Map<BookId, readonly Unit[]>();
  return {
    resolve: (address) => resolution(doors.resolve(address), address.book),
    addressAt: (book, offset) => {
      if (!Number.isInteger(offset) || offset < 0 || offset > length) return undefined;
      let held = named.get(offset);
      if (held === undefined) {
        held = doors.addressAt(offset);
        named.set(offset, held);
      }
      return inBook(book, held);
    },
    units: (book) => {
      let held = steps.get(book);
      if (held === undefined) {
        listed ??= doors.places();
        held = listed.map((place) => {
          const address = inBook(book, place.address);
          return {
            from: place.opening,
            to: place.to,
            marker: place.from,
            address,
            chapter: chapterOf(address),
          };
        });
        steps.set(book, held);
      }
      return held;
    },
  };
};

/** Index of the unit containing `offset` (the last one starting at or before it), or -1. */
export const unitIndexAt = (all: readonly Unit[], offset: number): number => {
  let lo = 0;
  let hi = all.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const unit = all[mid];
    if (unit === undefined) break;
    if (unit.from <= offset) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
};
