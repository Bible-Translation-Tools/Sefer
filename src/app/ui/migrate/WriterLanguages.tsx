import SearchIcon from "lucide-solid/icons/search";
import { For, Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { WriterLanguage } from "../../catalogue";
import { describe } from "../../describe";
import { t } from "../../i18n";
import { writerLanguages } from "../../migrate";
import { useShell } from "../../ProjectContext";
import { formatDate } from "../landing/summaries";
import {
  Card,
  Input,
  VirtualList,
  ariaSortOf,
  cx,
  sortIcon,
  type SortDirection,
} from "../primitives";

type Column = "code" | "language" | "region" | "projects" | "date";

const SORTABLE: readonly (readonly [Column, () => string])[] = [
  ["code", () => t("Code")],
  ["language", () => t("Language")],
  ["region", () => t("Region")],
  ["projects", () => t("Writer projects")],
  ["date", () => t("Updated")],
];

const COLUMNS =
  "grid grid-cols-[9rem_minmax(0,1fr)_9rem_10rem_8rem] items-center gap-x-6 px-6 text-body";

const ROW_HEIGHT = 57;

const SETTLE_MS = 300;

const sortValue = (column: Column, row: WriterLanguage): string | number => {
  switch (column) {
    case "code":
      return row.code;
    case "language":
      return row.naturalName;
    case "region":
      return row.region ?? "";
    case "projects":
      return row.projects;
    case "date":
      return row.updated ?? "";
  }
};

const createLanguageSearch = (query: () => string) => {
  const { services } = useShell();
  const [rows, setRows] = createSignal<readonly WriterLanguage[] | undefined>(undefined, {
    name: "writerLanguagesRows",
  });
  const [problem, setProblem] = createSignal("", { name: "writerLanguagesProblem" });
  const [loading, setLoading] = createSignal(false, { name: "writerLanguagesLoading" });
  let asked = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (text: string): void => {
    clearTimeout(timer);
    asked += 1;
    const ticket = asked;
    const needle = text.trim();
    if (needle.length < 2) {
      timer = setTimeout(() => setRows(undefined), 0);
      return;
    }
    timer = setTimeout(() => {
      setLoading(true);
      void (async () => {
        try {
          const found = await writerLanguages(services, needle);
          if (ticket !== asked) return;
          setProblem("");
          setRows(found);
        } catch (cause) {
          if (ticket !== asked) return;
          setProblem(describe(cause));
          setRows([]);
        } finally {
          if (ticket === asked) setLoading(false);
        }
      })();
    }, SETTLE_MS);
  };
  createEffect(query, schedule);

  return { rows, problem, loading };
};

const createSort = (rows: () => readonly WriterLanguage[] | undefined) => {
  const [column, setColumn] = createSignal<Column>("date", { name: "writerLanguagesSort" });
  const [direction, setDirection] = createSignal<SortDirection>("desc", {
    name: "writerLanguagesDirection",
  });

  const sorted = createMemo(
    () => {
      const key = column();
      const sign = direction() === "desc" ? -1 : 1;
      return [...(rows() ?? [])].sort((left, right) => {
        const a = sortValue(key, left);
        const b = sortValue(key, right);
        return (
          sign *
          (typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a).localeCompare(String(b)))
        );
      });
    },
    { name: "writerLanguagesSorted" },
  );

  const sortOf = (key: Column): SortDirection => (column() === key ? direction() : "none");

  const sortBy = (key: Column): void => {
    if (column() === key) setDirection(direction() === "asc" ? "desc" : "asc");
    else {
      setColumn(key);
      setDirection(key === "date" || key === "projects" ? "desc" : "asc");
    }
  };

  return { sorted, sortOf, sortBy };
};

function LanguageRow(props: {
  readonly item: WriterLanguage;
  readonly onPick: (code: string) => void;
}) {
  return (
    <button
      type="button"
      role="row"
      data-writer-language={props.item.code}
      class={cx(
        COLUMNS,
        "w-full cursor-pointer border-b border-surface-border py-3 text-start transition-colors hover:bg-surface-secondary",
      )}
      onClick={() => props.onPick(props.item.code)}
    >
      <span role="cell" class="truncate whitespace-nowrap text-on-surface-secondary">
        {props.item.code}
      </span>
      <span role="cell" class="min-w-0 truncate">
        <strong class="font-medium text-on-surface-primary">{props.item.naturalName}</strong>
        <Show when={props.item.anglicizedName !== props.item.naturalName}>
          <span class="ms-2 text-on-surface-tertiary">{props.item.anglicizedName}</span>
        </Show>
      </span>
      <span role="cell" class="truncate text-on-surface-secondary">
        {props.item.region ?? "—"}
      </span>
      <span role="cell" class="tabular-nums text-on-surface-secondary">
        {props.item.projects}
      </span>
      <span role="cell" class="text-on-surface-secondary">
        {formatDate(props.item.updated) || "—"}
      </span>
    </button>
  );
}

/** The table alone, searching whatever `query` says: the Migrate screen's, or the WACS panel's. */
export function WriterTable(props: {
  readonly query: string;
  readonly onPick: (code: string) => void;
  readonly class?: string;
}) {
  const { rows, problem, loading } = createLanguageSearch(() => props.query);
  const { sorted, sortOf, sortBy } = createSort(rows);
  const virtualRows = createMemo(
    () => sorted().map((row) => ({ key: row.code, item: row, estimate: ROW_HEIGHT })),
    { name: "writerLanguagesVirtual" },
  );

  const emptyNote = (): string => {
    if (props.query.trim().length < 2)
      return t("Type two letters or more of a language's name or code.");
    if (loading() || rows() === undefined) return t("Searching…");
    return t("No language with Writer projects matches “{query}”.", { query: props.query.trim() });
  };

  return (
    <>
      <Show when={problem() !== ""}>
        <p class="rounded-md bg-surface-error px-3 py-2 text-small text-on-surface-error">
          {problem()}
        </p>
      </Show>
      <Card
        padded={false}
        role="table"
        aria-label={t("Writer projects on WACS")}
        aria-rowcount={sorted().length + 1}
        class={cx("flex min-h-0 flex-col overflow-hidden", props.class ?? "h-[60vh]")}
      >
        <div
          role="rowgroup"
          class="shrink-0 overflow-hidden [scrollbar-gutter:stable] border-b border-surface-border"
        >
          <div role="row" class={cx(COLUMNS, "text-on-surface-secondary")}>
            <For each={SORTABLE}>
              {([key, label]) => (
                <div role="columnheader" aria-sort={ariaSortOf(sortOf(key))}>
                  <button
                    type="button"
                    class="flex w-full cursor-pointer items-center gap-1.5 py-3 text-start font-medium hover:text-on-surface-primary"
                    onClick={() => sortBy(key)}
                  >
                    <span class="min-w-0 flex-1 truncate">{label()}</span>
                    {sortIcon(sortOf(key), 14)}
                  </button>
                </div>
              )}
            </For>
          </div>
        </div>
        <VirtualList<WriterLanguage>
          role="rowgroup"
          class="scrollbar-subtle min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
          sections={virtualRows().length > 0 ? [{ key: "languages", rows: virtualRows() }] : []}
          empty={<p class="py-8 text-center text-body text-on-surface-tertiary">{emptyNote()}</p>}
          row={(item) => <LanguageRow item={item()} onPick={props.onPick} />}
        />
      </Card>
    </>
  );
}

export function WriterLanguages(props: {
  readonly initial: string;
  readonly onPick: (code: string) => void;
}) {
  const initial = untrack(() => props.initial);
  const [query, setQuery] = createSignal(initial, { name: "writerLanguagesQuery" });

  return (
    <section class="flex min-h-0 flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="me-auto text-h4 font-semibold">{t("Writer projects on WACS")}</h2>
        <Input
          type="search"
          size="lg"
          wrapperClass="w-full sm:w-[24rem]"
          class="w-full"
          icon={<SearchIcon size={20} aria-hidden="true" />}
          aria-label={t("Search Writer projects by language")}
          placeholder={t("Two letters or more: 'nindi' or 'nxi'…")}
          data-testid="writer-languages-search"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <WriterTable query={query()} onPick={props.onPick} />
    </section>
  );
}
