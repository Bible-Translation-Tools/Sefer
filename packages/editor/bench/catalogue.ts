import {
  Category,
  FIRST_EXTENSION_ROW,
  MARKERS,
  MarkerKind,
} from "@wycliffeassociates/scripture-kitchen/reader";

type Row = (typeof MARKERS)[number];

/** Every marker USFM defines, as the engine's own catalogue lists them; extension templates excluded. */
const ROWS: readonly Row[] = MARKERS.slice(1, FIRST_EXTENSION_ROW);

/** Attributes a marker is barely itself without. */
const ATTRS: Readonly<Record<string, string>> = {
  w: '|lemma="grace"',
  rb: '|gloss="gl:oss"',
  jmp: '|link-href="#TIT 1:1"',
  fig: '|src="picture.jpg" size="col" ref="1.1"',
};

/** Fixed content where a word would be wrong. */
const CONTENT: Readonly<Record<string, string>> = {
  ide: "UTF-8",
  sts: "1",
  rem: "A remark the reader never sees.",
};

/**
 * The spellings a numbered row admits. `numbering` packs 0 for none, 1..13
 * for a nesting cap, 14 for unbounded and 15 for a table column; the levels
 * stop at 3, past which a level teaches nothing new.
 */
const spellings = (row: Row): readonly string[] => {
  if (row.numbering === 0) return [row.name];
  const cap = row.numbering >= 14 ? 2 : Math.min(row.numbering, 3);
  return Array.from({ length: cap }, (_, at) => `${row.name}${at + 1}`);
};

const of = (category: number, kind?: number): readonly Row[] =>
  ROWS.filter((row) => row.category === category && (kind === undefined || row.kind === kind));

/**
 * One synthetic book carrying every marker in the engine's catalogue, each
 * in a place it may stand: identification, titles, the introduction, a
 * chapter of sections, paragraphs, poetry, lists, a table, every character
 * marker around a word, every note with every note-content marker, the
 * milestones, a sidebar and a figure. Built from `MARKERS`, so a kitchen bump
 * that adds a marker adds it here; `skipped` names the rows it has no place
 * for, so that is visible rather than silent.
 */
export const catalogue = (): { readonly text: string; readonly skipped: readonly string[] } => {
  const placed = new Set<Row>();
  const lines: string[] = [];
  let verse = 0;
  const v = (): string => `\\v ${(verse += 1)}`;
  const take = (row: Row): Row => (placed.add(row), row);
  const line = (text: string): void => {
    lines.push(text);
  };

  const wrap = (row: Row, word: string): string =>
    `\\${take(row).name} ${word}${ATTRS[row.name] ?? ""}\\${row.name}*`;
  const run = (row: Row, word: string): string =>
    row.closing === 1 ? wrap(row, word) : `\\${take(row).name} ${word}`;

  // Identification and the title block.
  const named = (name: string): Row => {
    const row = ROWS.find((candidate) => candidate.name === name);
    if (row === undefined) throw new Error(`the catalogue has no \\${name}`);
    return take(row);
  };
  named("id");
  line("\\id TIT Synthetic: every marker in the engine's catalogue");
  named("usfm");
  line("\\usfm 3.1");
  for (const row of of(Category.ParaIdentification))
    if (!placed.has(row))
      for (const spelled of spellings(take(row)))
        line(`\\${spelled} ${CONTENT[row.name] ?? `Header ${spelled}`}`);
  for (const spelled of spellings(named("mt"))) line(`\\${spelled} Main title ${spelled}`);

  // The introduction: every intro paragraph, the intro character markers in the outline and a paragraph, `\ie` last.
  const introChars = of(Category.CharIntroductions);
  const ie = named("ie");
  for (const row of of(Category.ParaIntroductions)) {
    if (placed.has(row)) continue;
    for (const spelled of spellings(take(row))) {
      const inner = introChars[spelled.startsWith("io") ? 0 : 1];
      const extra =
        inner !== undefined && (spelled === "io1" || spelled === "ip")
          ? ` ${wrap(inner, "1.1-3")}`
          : "";
      line(`\\${spelled} Introduction ${spelled}${extra}`);
    }
  }
  for (const row of introChars) if (!placed.has(row)) line(`\\ip Intro ${wrap(row, "inline")}`);
  line(`\\${ie.name}`);
  for (const spelled of spellings(named("mte"))) line(`\\${spelled} Title ending ${spelled}`);

  // Chapter 1: the chapter apparatus and every heading.
  named("c");
  line(`\\c 1 ${wrap(named("ca"), "2")}`);
  line(`\\${named("cp").name} A`);
  for (const row of of(Category.ParaTitlesSections)) {
    if (placed.has(row)) continue;
    for (const spelled of spellings(take(row))) line(`\\${spelled} Heading ${spelled}`);
  }
  named("v");
  line(
    `\\p ${v()} ${wrap(named("va"), "1a")} ${wrap(named("vp"), "1b")} Alternate and published numbers.`,
  );

  // Every body paragraph and every poetry line, one verse each.
  for (const row of [...of(Category.ParaBody), ...of(Category.ParaPoetry)]) {
    if (placed.has(row)) continue;
    for (const spelled of spellings(take(row)))
      line(row.ws === 4 ? `\\${spelled}` : `\\${spelled} ${v()} Text in ${spelled}.`);
  }
  for (const row of of(Category.CharPoetry))
    line(`\\q1 ${v()} A line with ${wrap(row, row.name)}.`);

  // Lists, with the list character markers in an item.
  for (const row of of(Category.ParaLists)) {
    if (placed.has(row)) continue;
    for (const spelled of spellings(take(row))) line(`\\${spelled} ${v()} List ${spelled}.`);
  }
  for (const row of of(Category.CharLists))
    for (const spelled of spellings(take(row)))
      line(`\\li1 ${v()} Item \\${spelled} ${row.name}\\${spelled}*.`);

  // Every character marker of text and formatting, one verse each, around one word.
  line("\\p");
  for (const row of [...of(Category.CharTextFeatures), ...of(Category.CharFormatting)])
    if (row.kind === MarkerKind.Character && !placed.has(row))
      line(`${v()} Some ${wrap(row, row.name)} text.`);
  for (const row of of(Category.CharBreaks))
    line(`${v()} Before a break \\${take(row).name} after it.`);

  // Every note, carrying every marker its content admits.
  // The origin reference leads, as it does in real notes.
  const leads = (row: Row): number => (row.name === "fr" || row.name === "xo" ? 0 : 1);
  const content = (chars: readonly Row[]): string =>
    [...chars]
      .sort((a, b) => leads(a) - leads(b))
      .map((row) => run(row, row.name))
      .join(" ");
  const cat = named("cat");
  for (const row of of(Category.NoteFootnote))
    line(
      `${v()} A ${row.name} note\\${take(row).name} + ${wrap(cat, "category")} ${content(of(Category.CharNotesFootnote))}\\${row.name}* here.`,
    );
  for (const row of of(Category.NoteCrossReference))
    line(
      `${v()} An ${row.name} reference\\${take(row).name} - ${content(of(Category.CharNotesCrossReference))}\\${row.name}* here.`,
    );

  // A table: a header row of the header cells, a body row of the rest.
  const cells = ROWS.filter((row) => row.kind === MarkerKind.TableCell);
  const rowOf = (chosen: readonly Row[]): string =>
    chosen.map((cell, at) => `\\${take(cell).name}${at + 1} ${cell.name}`).join(" ");
  line(`\\p ${v()} A table follows.`);
  for (const row of of(Category.ParaTables)) {
    take(row);
    line(`\\${row.name} ${rowOf(cells.filter((cell) => cell.name.startsWith("th")))}`);
    line(`\\${row.name} ${rowOf(cells.filter((cell) => !cell.name.startsWith("th")))}`);
  }

  // Milestones, each a start and an end around a few words.
  line("\\p");
  for (const row of ROWS)
    if (row.kind === MarkerKind.Milestone && !placed.has(row)) {
      const attrs = row.name === "qt" ? ' |who="Speaker"' : "";
      line(
        `${v()} \\${take(row).name}-s${attrs}\\*Within a ${row.name} milestone.\\${row.name}-e\\*`,
      );
    }

  // A figure, then a sidebar.
  for (const row of of(Category.Figure)) line(`${v()} A figure: ${wrap(row, "Caption")}`);
  const [start, end] = of(Category.Sidebar);
  if (start !== undefined && end !== undefined) {
    line(`\\${take(start).name} ${wrap(cat, "People")}`);
    line("\\ms Sidebar title");
    line("\\p Sidebar text, outside every verse.");
    line(`\\${take(end).name}`);
  }
  line(`\\p ${v()} The last verse.`);

  const skipped = ROWS.filter((row) => !placed.has(row)).map((row) => row.name);
  return { text: `${lines.join("\n")}\n`, skipped };
};
