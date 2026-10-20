import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowUp from "lucide-solid/icons/arrow-up";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import SearchIcon from "lucide-solid/icons/search";
import { For, Show, createMemo, createSignal, untrack } from "solid-js";

import type { WriterLanguage } from "../../catalogue";
import { describe } from "../../describe";
import { t } from "../../i18n";
import { writerLanguages } from "../../migrate";
import { useShell } from "../../ProjectContext";
import { formatDate } from "../landing/summaries";
import { Card, Input, VirtualList, cx, type SortDirection } from "../primitives";

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

export function WriterLanguages(props: {
  readonly initial: string;
  readonly onPick: (code: string) => void;
}) {
  const { services } = useShell();
  const initial = untrack(() => props.initial);
  const [query, setQuery] = createSignal(initial, { name: "writerLanguagesQuery" });
  const [rows, setRows] = createSignal<readonly WriterLanguage[] | undefined>(undefined, {
    name: "writerLanguagesRows",
  });
  const [problem, setProblem] = createSignal("", { name: "writerLanguagesProblem" });
  const [loading, setLoading] = createSignal(false, { name: "writerLanguagesLoading" });
  const [column, setColumn] = createSignal<Column>("date", { name: "writerLanguagesSort" });
  const [direction, setDirection] = createSignal<SortDirection>("desc", {
    name: "writerLanguagesDirection",
  });

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
  const search = (text: string): void => {
    setQuery(text);
    schedule(text);
  };
  schedule(initial);

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

  const virtualRows = createMemo(
    () => sorted().map((row) => ({ key: row.code, item: row, estimate: ROW_HEIGHT })),
    { name: "writerLanguagesVirtual" },
  );

  const sortBy = (key: Column): void => {
    if (column() === key) setDirection(direction() === "asc" ? "desc" : "asc");
    else {
      setColumn(key);
      setDirection(key === "date" || key === "projects" ? "desc" : "asc");
    }
  };

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
          onInput={(event) => search(event.currentTarget.value)}
        />
      </div>
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
        class="flex h-[60vh] min-h-0 flex-col overflow-hidden"
      >
        <div
          role="rowgroup"
          class="shrink-0 overflow-hidden [scrollbar-gutter:stable] border-b border-surface-border"
        >
          <div role="row" class={cx(COLUMNS, "text-on-surface-secondary")}>
            <For each={SORTABLE}>
              {([key, label]) => (
                <div
                  role="columnheader"
                  aria-sort={
                    column() !== key ? "none" : direction() === "asc" ? "ascending" : "descending"
                  }
                >
                  <button
                    type="button"
                    class="flex w-full cursor-pointer items-center gap-1.5 py-3 text-start font-medium hover:text-on-surface-primary"
                    onClick={() => sortBy(key)}
                  >
                    <span class="min-w-0 flex-1 truncate">{label()}</span>
                    {column() !== key ? (
                      <ChevronsUpDown size={14} aria-hidden="true" class="opacity-50" />
                    ) : direction() === "asc" ? (
                      <ArrowUp size={14} aria-hidden="true" />
                    ) : (
                      <ArrowDown size={14} aria-hidden="true" />
                    )}
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
          empty={
            <p class="py-8 text-center text-body text-on-surface-tertiary">
              {query().trim().length < 2
                ? t("Type two letters or more of a language's name or code.")
                : loading() || rows() === undefined
                  ? t("Searching…")
                  : t("No language with Writer projects matches “{query}”.", {
                      query: query().trim(),
                    })}
            </p>
          }
          row={(item) => (
            <button
              type="button"
              role="row"
              data-writer-language={item().code}
              class={cx(
                COLUMNS,
                "w-full cursor-pointer border-b border-surface-border py-3 text-start transition-colors hover:bg-surface-secondary",
              )}
              onClick={() => props.onPick(item().code)}
            >
              <span role="cell" class="truncate whitespace-nowrap text-on-surface-secondary">
                {item().code}
              </span>
              <span role="cell" class="min-w-0 truncate">
                <strong class="font-medium text-on-surface-primary">{item().naturalName}</strong>
                <Show when={item().anglicizedName !== item().naturalName}>
                  <span class="ms-2 text-on-surface-tertiary">{item().anglicizedName}</span>
                </Show>
              </span>
              <span role="cell" class="truncate text-on-surface-secondary">
                {item().region ?? "—"}
              </span>
              <span role="cell" class="tabular-nums text-on-surface-secondary">
                {item().projects}
              </span>
              <span role="cell" class="text-on-surface-secondary">
                {formatDate(item().updated) || "—"}
              </span>
            </button>
          )}
        />
      </Card>
    </section>
  );
}
