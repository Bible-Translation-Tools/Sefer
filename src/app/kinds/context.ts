/**
 * What a resource handle may borrow from the open project: its table of
 * contents, as verse counts (`PlaceContext`). A stand-in for a versification
 * of the resource's own (plan §11.1), named so it can be replaced in one
 * place: a book the project does not hold lends nothing, and a note at the
 * end of one of its chapters says only where it starts.
 */

import { lastVerseOf } from "@sefer/text/location/locate";
import { Option } from "effect";

import { tocViewOf } from "#core/galley";
import type { PlaceContext } from "#core/resources/kinds/handle";

import type { Services } from "../services";

export const borrowedContext = (services: Services): PlaceContext => ({
  versesIn: (book, chapter) => {
    const held = Option.getOrUndefined(services.projectAnalysis.analysis(book));
    return held === undefined ? undefined : lastVerseOf(tocViewOf(held.analysis), chapter);
  },
});
