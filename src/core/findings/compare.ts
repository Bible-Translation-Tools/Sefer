// compare.ts
//
// What a Sous sentence is comparing, as the searches kitchen wrote for it.
//
//   “'” comes right before “.” here (“'.”). This project writes them the
//   other way round, “.'”, 171 times; “'.” appears 4 times.
//     → [{ kind: "literal", purpose: "this", needle: "'." },
//        { kind: "literal", purpose: "alternative", needle: ".'" }]
//
// Kitchen's `describe` returns the queries beside the message
// (`sous-messages.md`, "Queries"): a literal for galley's `findAll`, or a
// Unicode regex over the verse text, each tagged with its purpose. All of them
// are shown; this only decides whether a finding gets a search at all. One
// with no `this` query (hygiene, presence, source copy, the lengths) has
// nothing to compare.
//
// No regex probe is kept as a fallback: every Sous message that carries
// queries carries a `this` one (a Placement row's class is always a regex), so
// the old probe, built from the same parameters, had no case left to cover.

import type { FindingMessage, FindingQuery } from "../galley";

// TODO(merge): revisit with Will — queries now drive SearchDialog/comparisonOf; decide whether the dialog stays generic Query[] and whether the probe fallback can go.
export const comparisonOf = (message: FindingMessage): readonly FindingQuery[] | undefined =>
  message.queries.some((query) => query.purpose === "this") ? message.queries : undefined;
