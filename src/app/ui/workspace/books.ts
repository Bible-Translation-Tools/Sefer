/**
 * The canon, as the workspace needs to show it: which books there are, in what
 * order, which testament each belongs to, and what to call one.
 *
 * Why a table here and not in core: core orders books by the number a
 * translator put in the FILE NAME (`canonicalOrder` in
 * `src/core/project/discovery.ts`), which is the honest reading of a folder —
 * a project holds the books it holds, in the order its own files claim. This
 * table answers a different question, and only the UI asks it: given the id
 * `MRK`, what section heading does its row sit under and what word goes on it.
 *
 * The English names are NOT wrapped in `t()`, and that is deliberate. A book
 * name is not chrome: the right translation of it is the one the PROJECT uses
 * — a Scripture Burrito publishes it in `localizedNames`, a Resource Container
 * in `projects[].title`, and `ProjectMetadata.bookNames` is where both land —
 * so `bookName` reads the metadata first and falls back to this table, and
 * further to the bare id. Putting sixty-six names in the UI catalogue would
 * offer a translator two places to disagree about what Mark is called.
 */

import { localized, type ProjectMetadata } from "../../../core/resources/projectMetadata";

export type Testament = "ot" | "nt";

export interface CanonicalBook {
  readonly id: string;
  readonly name: string;
  readonly testament: Testament;
}

/** The protestant canon in order; `testament` is what the section labels use. */
export const CANON: readonly CanonicalBook[] = [
  { id: "GEN", name: "Genesis", testament: "ot" },
  { id: "EXO", name: "Exodus", testament: "ot" },
  { id: "LEV", name: "Leviticus", testament: "ot" },
  { id: "NUM", name: "Numbers", testament: "ot" },
  { id: "DEU", name: "Deuteronomy", testament: "ot" },
  { id: "JOS", name: "Joshua", testament: "ot" },
  { id: "JDG", name: "Judges", testament: "ot" },
  { id: "RUT", name: "Ruth", testament: "ot" },
  { id: "1SA", name: "1 Samuel", testament: "ot" },
  { id: "2SA", name: "2 Samuel", testament: "ot" },
  { id: "1KI", name: "1 Kings", testament: "ot" },
  { id: "2KI", name: "2 Kings", testament: "ot" },
  { id: "1CH", name: "1 Chronicles", testament: "ot" },
  { id: "2CH", name: "2 Chronicles", testament: "ot" },
  { id: "EZR", name: "Ezra", testament: "ot" },
  { id: "NEH", name: "Nehemiah", testament: "ot" },
  { id: "EST", name: "Esther", testament: "ot" },
  { id: "JOB", name: "Job", testament: "ot" },
  { id: "PSA", name: "Psalms", testament: "ot" },
  { id: "PRO", name: "Proverbs", testament: "ot" },
  { id: "ECC", name: "Ecclesiastes", testament: "ot" },
  { id: "SNG", name: "Song of Songs", testament: "ot" },
  { id: "ISA", name: "Isaiah", testament: "ot" },
  { id: "JER", name: "Jeremiah", testament: "ot" },
  { id: "LAM", name: "Lamentations", testament: "ot" },
  { id: "EZK", name: "Ezekiel", testament: "ot" },
  { id: "DAN", name: "Daniel", testament: "ot" },
  { id: "HOS", name: "Hosea", testament: "ot" },
  { id: "JOL", name: "Joel", testament: "ot" },
  { id: "AMO", name: "Amos", testament: "ot" },
  { id: "OBA", name: "Obadiah", testament: "ot" },
  { id: "JON", name: "Jonah", testament: "ot" },
  { id: "MIC", name: "Micah", testament: "ot" },
  { id: "NAM", name: "Nahum", testament: "ot" },
  { id: "HAB", name: "Habakkuk", testament: "ot" },
  { id: "ZEP", name: "Zephaniah", testament: "ot" },
  { id: "HAG", name: "Haggai", testament: "ot" },
  { id: "ZEC", name: "Zechariah", testament: "ot" },
  { id: "MAL", name: "Malachi", testament: "ot" },
  { id: "MAT", name: "Matthew", testament: "nt" },
  { id: "MRK", name: "Mark", testament: "nt" },
  { id: "LUK", name: "Luke", testament: "nt" },
  { id: "JHN", name: "John", testament: "nt" },
  { id: "ACT", name: "Acts", testament: "nt" },
  { id: "ROM", name: "Romans", testament: "nt" },
  { id: "1CO", name: "1 Corinthians", testament: "nt" },
  { id: "2CO", name: "2 Corinthians", testament: "nt" },
  { id: "GAL", name: "Galatians", testament: "nt" },
  { id: "EPH", name: "Ephesians", testament: "nt" },
  { id: "PHP", name: "Philippians", testament: "nt" },
  { id: "COL", name: "Colossians", testament: "nt" },
  { id: "1TH", name: "1 Thessalonians", testament: "nt" },
  { id: "2TH", name: "2 Thessalonians", testament: "nt" },
  { id: "1TI", name: "1 Timothy", testament: "nt" },
  { id: "2TI", name: "2 Timothy", testament: "nt" },
  { id: "TIT", name: "Titus", testament: "nt" },
  { id: "PHM", name: "Philemon", testament: "nt" },
  { id: "HEB", name: "Hebrews", testament: "nt" },
  { id: "JAS", name: "James", testament: "nt" },
  { id: "1PE", name: "1 Peter", testament: "nt" },
  { id: "2PE", name: "2 Peter", testament: "nt" },
  { id: "1JN", name: "1 John", testament: "nt" },
  { id: "2JN", name: "2 John", testament: "nt" },
  { id: "3JN", name: "3 John", testament: "nt" },
  { id: "JUD", name: "Jude", testament: "nt" },
  { id: "REV", name: "Revelation", testament: "nt" },
];

const BY_ID = new Map(CANON.map((book) => [book.id, book]));

/**
 * Which testament a book id sits in. A book the table does not know — an
 * apocryphal id, a project's own `99-BAD` — reads as New Testament so it lands
 * at the end of the list rather than in the middle of the Pentateuch.
 */
export const testamentOf = (id: string): Testament =>
  BY_ID.get(id.toUpperCase())?.testament ?? "nt";

/**
 * What to call a book: what the project calls it, else the English canon, else
 * the id itself. Never blank — the id is always something a reader can act on.
 */
export const bookName = (id: string, metadata?: ProjectMetadata): string => {
  const local = localized(metadata?.bookNames[id], [metadata?.defaultLocale]);
  return local !== "" ? local : (BY_ID.get(id.toUpperCase())?.name ?? id);
};

export interface Reference {
  readonly bookId: string;
  /** One-based, as a person writes it; absent when none was typed. */
  readonly chapter?: number;
}

const NUMBERED = /^(\d)\s*(.+)$/;
const TRAILING_NUMBER = /\s+(\d+)\s*$/;

/** "1 Samuel" and "1Samuel" are the same book; so are "Song of Songs" and "song of songs". */
const normalise = (text: string): string => {
  const squashed = text.trim().toLowerCase().replace(/\s+/g, " ");
  const numbered = NUMBERED.exec(squashed);
  return numbered === null ? squashed : `${numbered[1] ?? ""} ${numbered[2] ?? ""}`;
};

const BY_NAME = new Map(CANON.map((book) => [normalise(book.name), book.id]));

/**
 * Reads "Mark 5", "MRK 5", "PHM", "1 john 2" as a place to go.
 *
 * Only over the ids in `known`, so a query never navigates to a book this
 * project does not hold. Prefix matching on the name is what makes the box
 * usable — "phil" is ambiguous between Philippians and Philemon, and the FIRST
 * canonical match wins rather than nothing, because a reader who typed four
 * letters and pressed Enter wants to arrive somewhere.
 */
export const parseReference = (query: string, known: readonly string[]): Reference | undefined => {
  const text = query.trim();
  if (text === "") return undefined;
  const chapterAt = TRAILING_NUMBER.exec(text);
  const chapter = chapterAt === null ? undefined : Number(chapterAt[1]);
  const namePart = chapterAt === null ? text : text.slice(0, chapterAt.index);
  const wanted = normalise(namePart);
  if (wanted === "") return undefined;

  const held = new Set(known.map((id) => id.toUpperCase()));
  const upper = namePart.trim().toUpperCase();
  if (held.has(upper)) return { bookId: upper, chapter };

  const exact = BY_NAME.get(wanted);
  if (exact !== undefined && held.has(exact)) return { bookId: exact, chapter };

  for (const book of CANON) {
    if (!held.has(book.id)) continue;
    if (normalise(book.name).startsWith(wanted)) return { bookId: book.id, chapter };
  }
  // A project may hold a book the canon does not name; match its id by prefix.
  for (const id of known) if (id.toUpperCase().startsWith(upper)) return { bookId: id, chapter };
  return undefined;
};
