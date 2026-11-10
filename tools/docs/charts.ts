/**
 * Draws each state machine's chart into its documentation chapter, from the
 * machine's own transition table. `pnpm docs:charts` rewrites the blocks;
 * `--check` fails when a chapter's chart is not what the code says.
 *
 * A chapter marks the place with `<!-- chart:<id> -->` and `<!-- /chart:<id> -->`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { projectTransitions } from "../../src/core/project/lifecycle.ts";
import { recordTransitions } from "../../src/core/save/recordPhase.ts";

interface Machine {
  readonly id: string;
  readonly chapter: string;
  readonly initial: string;
  readonly transitions: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const machines: readonly Machine[] = [
  {
    id: "project-phase",
    chapter: "documentation/architecture/shell.md",
    initial: "closed",
    transitions: projectTransitions,
  },
  {
    id: "record-phase",
    chapter: "documentation/architecture/review.md",
    initial: "editing",
    transitions: recordTransitions,
  },
];

const chartOf = (machine: Machine): string => {
  const lines = ["```mermaid", "stateDiagram-v2", `  [*] --> ${machine.initial}`];
  for (const [from, ways] of Object.entries(machine.transitions)) {
    const eventsTo = new Map<string, string[]>();
    for (const [event, to] of Object.entries(ways))
      eventsTo.set(to, [...(eventsTo.get(to) ?? []), event]);
    for (const [to, events] of eventsTo) lines.push(`  ${from} --> ${to} : ${events.join(", ")}`);
  }
  lines.push("```");
  return lines.join("\n");
};

const check = process.argv.includes("--check");
const stale: string[] = [];

for (const machine of machines) {
  const file = path.resolve(import.meta.dirname, "../..", machine.chapter);
  const open = `<!-- chart:${machine.id} -->`;
  const close = `<!-- /chart:${machine.id} -->`;
  const text = readFileSync(file, "utf8");
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start === -1 || end < start) {
    console.error(`${machine.chapter}: no ${open} … ${close} block`);
    process.exit(1);
  }
  const drawn = `${text.slice(0, start)}${open}\n\n${chartOf(machine)}\n\n${text.slice(end)}`;
  if (drawn === text) continue;
  if (check) stale.push(`${machine.chapter} (${machine.id})`);
  else writeFileSync(file, drawn);
}

if (stale.length > 0) {
  console.error(`Charts out of date, run \`pnpm docs:charts\`:\n  ${stale.join("\n  ")}`);
  process.exit(1);
}
