import { catalogue } from "./catalogue";
import edges from "./edges.usfm?raw";
import johnBsb from "./texts/JHN1-bsb.usfm?raw";
import johnUlb from "./texts/JHN1-ulb.usfm?raw";
import psalmBsb from "./texts/PSA23-bsb.usfm?raw";
import psalmUlb from "./texts/PSA23-ulb.usfm?raw";

/** One text in a pane: what it is called there, and its file name (the Book's path). */
export interface BenchText {
  readonly label: string;
  readonly name: string;
  readonly text: string;
}

/**
 * What the bench opens: the text being edited and, for a side-by-side, a
 * reference beside it, drawn by `mountReference` as Sefer's reference pane
 * is, so copying from it is the copy a translator makes.
 */
export interface Scenario {
  readonly id: string;
  readonly label: string;
  /** What the scenario is for, shown under the tabs. */
  readonly note: string;
  readonly edited: BenchText;
  readonly reference?: BenchText;
}

const generated = catalogue();

/** The rows the catalogue had no place for, named, so a gap is visible. */
export const SKIPPED = generated.skipped;

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "catalogue",
    label: "Every marker",
    note: "Every marker in the engine's catalogue, each where it may stand. Generated from MARKERS.",
    edited: { label: "Synthetic", name: "TIT.usfm", text: generated.text },
  },
  {
    id: "edges",
    label: "Layout edges",
    note: "A verse across paragraphs, poetry across verses, empty verses, a bridge, numbers out of order.",
    edited: { label: "Synthetic", name: "PHP.usfm", text: edges },
  },
  {
    id: "john1",
    label: "John 1 · ULB ← BSB",
    note: "Copy from the BSB into the ULB: section titles with their \\r line, the poetry at 1:23, footnotes. The ULB has \\s5 chunks and no titles.",
    edited: { label: "ULB, editing", name: "44-JHN.usfm", text: johnUlb },
    reference: { label: "BSB, reference", name: "44JHNBSB.usfm", text: johnBsb },
  },
  {
    id: "psalm23",
    label: "Psalm 23 · ULB ← BSB",
    note: "Poetry both sides: \\q1 and \\q2 against bare \\q, a \\d title, a \\b, footnotes in the BSB.",
    edited: { label: "ULB, editing", name: "19-PSA.usfm", text: psalmUlb },
    reference: { label: "BSB, reference", name: "19PSABSB.usfm", text: psalmBsb },
  },
];
