/**
 * The protestant canon: which books there are, in what order, and what English
 * calls them.
 *
 * Bible data, not presentation, which is why it sits in core. It answers a
 * different question from `canonicalOrder` in `project/discovery.ts`: that one
 * orders the books a FOLDER holds by the number a translator put in the file
 * name, which is the honest reading of a directory. This one is the canon
 * itself, and it is what lets someone type "mark" and arrive at `MRK`.
 *
 * The English names are NOT translatable chrome. The right translation of a
 * book name is the one the PROJECT uses — a Scripture Burrito publishes it in
 * `localizedNames`, a Resource Container in `projects[].title`, and both land
 * on `ProjectMetadata.bookNames`. This table is the fallback for a project
 * that names nothing, and putting sixty-six names in the UI catalogue would
 * offer a translator two places to disagree about what Mark is called.
 */

export type Testament = "ot" | "nt";

export interface CanonicalBook {
  readonly id: string;
  readonly name: string;
  readonly testament: Testament;
}

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

export const BY_ID: ReadonlyMap<string, CanonicalBook> = new Map(
  CANON.map((book) => [book.id, book]),
);

/**
 * Which testament a book belongs to. An id the canon does not know is `nt`,
 * so an unrecognised book lands at the end of a grouped list rather than in
 * the middle of the Pentateuch.
 */
export const testamentOf = (id: string): Testament =>
  BY_ID.get(id.toUpperCase())?.testament ?? "nt";
