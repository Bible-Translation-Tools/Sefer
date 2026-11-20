import type { BookId } from "@wycliffeassociates/sefer-text/book";
import type { Source } from "@wycliffeassociates/sefer-text/source";
import { createSignal } from "solid-js";

import type { SuggestionDetails } from "./suggestions";

/**
 * Design-build stand-ins for what only git and a forge can supply: the last
 * recorded version, the shared project, the version both last agreed on, and a
 * suggestion's details. Review's state switcher in the design panel sets them
 * over the fixture project so the REAL screen can be put in every state.
 *
 * Every reader checks `__SEFER_DESIGN__` first, so a production build folds
 * the lookups away and never sees this module's signal set.
 */
export interface RecordedStandIn {
  readonly head: string;
  readonly texts: ReadonlyMap<BookId, Source>;
}

interface DesignStandIn {
  readonly head?: RecordedStandIn;
  readonly shared?: RecordedStandIn;
  readonly base?: RecordedStandIn;
  readonly suggestion?: SuggestionDetails;
  /** Who made the shared project's changes, for a layout that names people. */
  readonly author?: string;
  /** Who is editing on this device, for a layout that names people. */
  readonly editor?: string;
}

const [standIn, setStandIn] = createSignal<DesignStandIn>(
  {},
  { name: "designStandIn", ownedWrite: true },
);

export const designStandIn = standIn;
export const setDesignStandIn = setStandIn;
