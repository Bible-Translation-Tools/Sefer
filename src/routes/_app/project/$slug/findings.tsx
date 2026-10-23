import { createFileRoute } from "@tanstack/solid-router";

import { FindingsPanel } from "#app/ui/panels";
import { ShellGate } from "#app/ui/ShellGate";

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
