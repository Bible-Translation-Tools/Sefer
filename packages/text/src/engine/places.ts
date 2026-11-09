import type { BookId } from "../book";
import type { Address, Resolution, Span } from "../location/address";

/**
 * galley's two place doors over one text, as the host that parsed it binds
 * them: `resolve` (an Address to where it is) and `addressAt` (an offset to
 * the place there), both answering JSON in UTF-16. A host binds a registered
 * book's id doors while that book's registered text is this text, and the
 * `…Of(text)` doors otherwise.
 */
export interface PlaceDoors {
  readonly resolve: (address: Address) => string;
  readonly addressAt: (offset: number) => string;
}

export interface Places {
  /** Where `address` is in this text. The Address's book is the caller's to match. */
  readonly resolve: (address: Address) => Resolution;
  /**
   * The place at `offset`, named in `book`: the introduction, a chapter's
   * head, its title (verse 0), or the verse whose tile holds it, parts
   * included. `undefined` outside `[0, length]`: the end-of-document caret is
   * a real position, anything past it is invalid input, not a clamp.
   */
  readonly addressAt: (book: BookId, offset: number) => Address | undefined;
}

type Wire =
  | {
      readonly found: {
        readonly from: number;
        readonly to: number;
        readonly opening: number;
        readonly covers: Address;
        readonly coarser: boolean;
      };
    }
  | { readonly missing: "intro" | "chapter" | "verse"; readonly within?: Span }
  | { readonly ambiguous: readonly { readonly from: number; readonly to: number }[] };

const inBook = (book: BookId, address: Address): Address => ({ ...address, book });

const resolution = (wire: Wire, book: BookId): Resolution => {
  if ("found" in wire) {
    const { from, to, opening, covers, coarser } = wire.found;
    return { kind: "found", from, to, opening, covers: inBook(book, covers), coarser };
  }
  if ("missing" in wire)
    return wire.within === undefined
      ? { kind: "missing", missing: wire.missing }
      : { kind: "missing", missing: wire.missing, within: wire.within };
  return {
    kind: "ambiguous",
    spans: wire.ambiguous.map(({ from, to }) => ({ from, to })),
  };
};

export const placesOf = (length: number, doors: PlaceDoors): Places => {
  const named = new Map<number, Address>();
  return {
    resolve: (address) =>
      // SAFETY: galley's `resolve` answers a `Resolution` in JSON (usfm_galley.d.ts).
      resolution(JSON.parse(doors.resolve(address)) as Wire, address.book),
    addressAt: (book, offset) => {
      if (!Number.isInteger(offset) || offset < 0 || offset > length) return undefined;
      let held = named.get(offset);
      if (held === undefined) {
        // SAFETY: galley's `addressAt` answers a `BookAddress` in JSON (usfm_galley.d.ts).
        held = JSON.parse(doors.addressAt(offset)) as Address;
        named.set(offset, held);
      }
      return held.book === book ? held : inBook(book, held);
    },
  };
};
