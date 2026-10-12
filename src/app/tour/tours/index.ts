import type { Tour } from "../machine";
import { expectTour } from "./expect";
import { findingsTour } from "./findings";
import { verseNumbersWorkflow } from "./verseNumbers";

/**
 * Every tutorial and workflow, in the order Settings lists them (each kind on
 * its own tab). Each is its own file.
 */
export const TOURS: readonly Tour[] = [findingsTour, expectTour, verseNumbersWorkflow];

export const tourById = (id: string): Tour | undefined => TOURS.find((tour) => tour.id === id);
