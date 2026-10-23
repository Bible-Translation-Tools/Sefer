import type { Tour } from "../machine";
import { expectTour } from "./expect";
import { findingsTour } from "./findings";
import { lineByLineTour } from "./lineByLine";
import { notesTour } from "./notes";
import { windowATour, windowBTour } from "./sharing";
import { suppressionsTour } from "./suppressions";
import { verseNumbersWorkflow } from "./verseNumbers";

/**
 * Field tours ship everywhere; internal ones (notes to the PO about a design,
 * `audience: "internal"`) only in design builds, so production bundles none of
 * their code or copy. No field tutorial has shipped yet (Will, 2026-10-22).
 */
export const TOURS: readonly Tour[] = [
  verseNumbersWorkflow,
  ...(__SEFER_DESIGN__
    ? [
        windowATour,
        windowBTour,
        findingsTour,
        suppressionsTour,
        expectTour,
        notesTour,
        lineByLineTour,
      ]
    : []),
];

export const tourById = (id: string): Tour | undefined => TOURS.find((tour) => tour.id === id);
