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
