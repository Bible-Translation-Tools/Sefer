import { createMemo } from "solid-js";

import type { ExcerptFeed } from "#app/ui/excerpts";
import type { Occurrence } from "#core/excerpts/excerpts";

import type { FindResults } from "./createFindResults";

export interface CursorInputs {
  readonly results: FindResults;
  readonly feedHits: () => readonly Occurrence[];
  readonly feed: ExcerptFeed;
}

export function createFindCursor(inputs: CursorInputs) {
  const { feedHits, feed } = inputs;
  const { cursor, setCursor } = inputs.results;

  const cursorSid = createMemo(
    () => {
      const hit = feedHits()[cursor()];
      if (hit === undefined) return undefined;
      for (const entry of feed.groups())
        for (const excerpt of entry.excerpts)
          if (excerpt.bookId === hit.bookId && excerpt.hits.some((held) => held.from === hit.from))
            return excerpt.sid;
      return undefined;
    },
    { name: "cursorSid" },
  );

  const cursorAt = (): number | undefined => feedHits()[cursor()]?.from;

  const step = (delta: 1 | -1): void => {
    const total = feedHits().length;
    if (total === 0) return;
    setCursor((held) => (held + delta + total) % total);
  };

  return { cursorSid, cursorAt, step };
}
