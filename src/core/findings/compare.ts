import type { FindingMessage, FindingQuery } from "../galley";

export const comparisonOf = (message: FindingMessage): readonly FindingQuery[] | undefined =>
  message.queries.some((query) => query.purpose === "this") ? message.queries : undefined;
