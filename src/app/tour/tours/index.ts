import type { Tour } from "../machine";
import { expectTour } from "./expect";
import { findingsTour } from "./findings";
import { lineByLineTour } from "./lineByLine";
import { notesTour } from "./notes";
import { suppressionsTour } from "./suppressions";
import { verseNumbersWorkflow } from "./verseNumbers";

export const TOURS: readonly Tour[] = [
  findingsTour,
  suppressionsTour,
  expectTour,
  notesTour,
  verseNumbersWorkflow,
  ...(__SEFER_DESIGN__ ? [lineByLineTour] : []),
];

export const tourById = (id: string): Tour | undefined => TOURS.find((tour) => tour.id === id);
