import { createFileRoute } from "@tanstack/solid-router";

import { FindingsPanel } from "../../../../app/ui/panels";
import { ShellGate } from "../../../../app/ui/ShellGate";

/**
 * `/findings` — the panel, gated on the shell.
 *
 * Everything the screen does lives in `src/app/ui/panels/FindingsPanel.tsx`;
 * this file exists to name the URL, to say that the page needs services, and
 * to validate the two questions another screen can ask it.
 *
 * `?code=` and `?pattern=` are what `/inventory` links with — "show me the
 * other sites of this convention". They were already being sent and were
 * silently dropped, because a route that does not validate a search param does
 * not receive it. Both are seeds for the filter and neither is authoritative:
 * the panel's header still says "N of TOTAL shown", and clearing the filter
 * clears them.
 *
 * Validation is deliberately narrow. A `code` is a string and nothing else; a
 * `pattern` is a non-negative integer (it indexes the publication's pattern
 * table, and `Finding.pattern` holds the same number). Anything else is
 * dropped rather than refused — a stale bookmark should open the findings
 * page, not an error.
 */
interface FindingsSearch {
  readonly code?: string;
  readonly pattern?: number;
}

const stringOr = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

const indexOr = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : Number(stringOr(value) ?? Number.NaN);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

export const Route = createFileRoute("/_app/project/$slug/findings")({
  validateSearch: (search: Record<string, unknown>): FindingsSearch => {
    const code = stringOr(search.code);
    const pattern = indexOr(search.pattern);
    return {
      ...(code === undefined ? {} : { code }),
      ...(pattern === undefined ? {} : { pattern }),
    };
  },
  head: () => ({ meta: [{ title: "Sefer — findings" }] }),
  component: () => <ShellGate>{() => <FindingsPanel />}</ShellGate>,
});
