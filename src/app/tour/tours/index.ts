import type { Tour } from "../machine";
import { findingsTour } from "./findings";

/** Every tutorial, in the order Settings lists them. Each is its own file. */
export const TOURS: readonly Tour[] = [findingsTour];

export const tourById = (id: string): Tour | undefined => TOURS.find((tour) => tour.id === id);
