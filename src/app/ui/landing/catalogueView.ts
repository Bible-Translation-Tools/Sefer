import { createMemo, createSignal, type Accessor } from "solid-js";

import {
  catalogueFailureAttrs,
  catalogueFor,
  catalogueVerdict,
  type CatalogueEntry,
} from "../../catalogue";
import { describe } from "../../describe";
import { t } from "../../i18n";
import type { Services } from "../../services";
import { type SortDirection } from "../primitives";

export type Column = "code" | "language" | "region" | "date";

export interface CatalogueRow {
  readonly entry: CatalogueEntry;
  readonly name: string;
  readonly english: string;
  readonly updated: string | undefined;
  readonly refusal: string;
  readonly downloading: boolean;
}

export const SORTABLE: readonly (readonly [Column, () => string])[] = [
  ["code", () => t("Code")],
  ["language", () => t("Language")],
  ["region", () => t("Region")],
  ["date", () => t("Date")],
];

export const sortChoices = (column: Column): readonly (readonly [SortDirection, string])[] =>
  column === "date"
    ? [
        ["desc", t("Newest first")],
        ["asc", t("Oldest first")],
      ]
    : [
        ["asc", t("A to Z")],
        ["desc", t("Z to A")],
      ];

const ROW_HEIGHT = 75;

const sortValue =
  (key: Column, updated: (entry: CatalogueEntry) => string | undefined) =>
  (entry: CatalogueEntry): string => {
    switch (key) {
      case "code":
        return entry.code;
      case "language":
        return entry.naturalName;
      case "region":
        return entry.region ?? "";
      case "date":
        return updated(entry) ?? "";
    }
  };

const matchesNeedle = (entry: CatalogueEntry, needle: string): boolean =>
  entry.code.toLowerCase().includes(needle) ||
  entry.id.toLowerCase().includes(needle) ||
  entry.naturalName.toLowerCase().includes(needle) ||
  entry.anglicizedName.toLowerCase().includes(needle) ||
  entry.alternateNames.some((name) => name.toLowerCase().includes(needle));

const measureCodeColumn = (codes: readonly string[]): string => {
  if (typeof document === "undefined") return "9rem";
  const context = document.createElement("canvas").getContext("2d");
  if (context === null) return "9rem";
  const style = getComputedStyle(document.body);
  context.font = `400 16px ${style.fontFamily}`;
  let widest = context.measureText(t("Code")).width + 16;
  for (const code of codes) widest = Math.max(widest, context.measureText(code).width);
  return `${String((Math.ceil(widest) + 2) / 16)}rem`;
};

export const createCatalogueEntries = (
  services: Services,
  catalogue: ReturnType<typeof catalogueFor>,
) => {
  const [entries, setEntries] = createSignal<readonly CatalogueEntry[] | undefined>(undefined, {
    name: "catalogueEntries",
  });
  const [problem, setProblem] = createSignal("", { name: "catalogueProblem" });

  const browsing = services.composition.observability.operation("catalogue.browse", {
    "catalogue.source": catalogue.source,
  });
  void catalogue
    .entries()
    .then(({ rows: all, enriched }) => {
      browsing.end("passed", {
        "catalogue.entries": all.length,
        "catalogue.gateways": all.filter((entry) => entry.type === "gateway").length,
        "catalogue.enriched": enriched,
      });
      setEntries(all);
    })
    .catch((cause: unknown) => {
      browsing.end(catalogueVerdict(cause), catalogueFailureAttrs(cause));
      setEntries([]);
      setProblem(describe(cause));
    });
  return { entries, problem };
};

export const createCatalogueFilters = (
  entries: Accessor<readonly CatalogueEntry[] | undefined>,
) => {
  const [query, setQuery] = createSignal("", { name: "catalogueQuery" });
  const [column, setColumn] = createSignal<Column>("language", { name: "catalogueSort" });
  const [direction, setDirection] = createSignal<SortDirection>("asc", {
    name: "catalogueDirection",
  });
  const [kind, setKind] = createSignal<CatalogueEntry["type"]>("translation", {
    name: "catalogueKind",
  });
  const [menuFor, setMenuFor] = createSignal<Column | "">("", { name: "catalogueMenu" });
  const [regionFilter, setRegionFilter] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "catalogueRegionFilter",
  });
  const toggleRegion = (name: string, on: boolean): void => {
    const next = new Set(regionFilter());
    if (on) next.add(name);
    else next.delete(name);
    setRegionFilter(next);
  };

  const regions = createMemo(
    (): readonly (readonly [string, number])[] => {
      const counted = new Map<string, number>();
      for (const entry of entries() ?? []) {
        const key = entry.region ?? "";
        counted.set(key, (counted.get(key) ?? 0) + 1);
      }
      counted.delete("");
      return [...counted.entries()].sort(([left], [right]) => left.localeCompare(right));
    },
    { name: "catalogueRegions" },
  );

  const sortOf = (key: Column): SortDirection => (column() === key ? direction() : "none");

  return {
    query,
    setQuery,
    column,
    setColumn,
    direction,
    setDirection,
    kind,
    setKind,
    menuFor,
    setMenuFor,
    regionFilter,
    setRegionFilter,
    toggleRegion,
    regions,
    sortOf,
  };
};

type Filters = ReturnType<typeof createCatalogueFilters>;

const createSortedEntries = (
  entries: Accessor<readonly CatalogueEntry[] | undefined>,
  filters: Filters,
) => {
  const { query, kind, regionFilter, column, direction } = filters;

  const latest = createMemo(
    () => {
      const newest = new Map<string, string>();
      for (const entry of entries() ?? []) {
        const updated = entry.updated;
        if (updated === undefined) continue;
        const key = entry.code.toLowerCase();
        const seen = newest.get(key);
        if (seen === undefined || updated > seen) newest.set(key, updated);
      }
      return newest;
    },
    { name: "catalogueLatest" },
  );
  const updatedOf = (entry: CatalogueEntry): string | undefined =>
    latest().get(entry.code.toLowerCase());

  const filtered = createMemo(
    () => {
      const needle = query().trim().toLowerCase();
      const keep = regionFilter();
      return (entries() ?? []).filter((entry) => {
        if (entry.type !== kind()) return false;
        if (kind() === "gateway" && entry.owner.toLowerCase() !== "wa-catalog") return false;
        if (keep.size > 0 && (entry.region === undefined || !keep.has(entry.region))) return false;
        if (needle === "") return true;
        return matchesNeedle(entry, needle);
      });
    },
    { name: "catalogueFiltered" },
  );

  const sorted = createMemo(
    () => {
      const newest = latest();
      const value = sortValue(column(), (entry) => newest.get(entry.code.toLowerCase()));
      const sign = direction() === "desc" ? -1 : 1;
      return [...filtered()].sort((left, right) => sign * value(left).localeCompare(value(right)));
    },
    { name: "catalogueSorted" },
  );

  return { sorted, updatedOf };
};

export const createCatalogueRows = (
  entries: Accessor<readonly CatalogueEntry[] | undefined>,
  filters: Filters,
  busy: Accessor<string>,
  downloadReason: (entry: CatalogueEntry) => string,
) => {
  const { sorted, updatedOf } = createSortedEntries(entries, filters);

  const rowIndex = createMemo(
    (): ReadonlyMap<string, number> => new Map(sorted().map((entry, at) => [entry.id, at])),
    { name: "catalogueRowIndex" },
  );

  const rows = createMemo(
    (): readonly CatalogueRow[] => {
      const running = busy();
      return sorted().map((entry) => ({
        entry,
        name: entry.naturalName,
        english: entry.anglicizedName === entry.naturalName ? "" : entry.anglicizedName,
        updated: updatedOf(entry),
        refusal: downloadReason(entry),
        downloading: entry.id === running,
      }));
    },
    { name: "catalogueRows" },
  );

  const virtualRows = createMemo(
    () => rows().map((row) => ({ key: row.entry.id, item: row, estimate: ROW_HEIGHT })),
    { name: "catalogueVirtualRows" },
  );

  const codeColumn = createMemo(() => measureCodeColumn((entries() ?? []).map((e) => e.code)), {
    name: "catalogueCodeColumn",
  });

  return { rows, rowIndex, virtualRows, codeColumn };
};
