import { Effect, Fiber, Option, Stream } from "effect";
import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowUp from "lucide-solid/icons/arrow-up";
import Download from "lucide-solid/icons/download";
import Filter from "lucide-solid/icons/filter";
import SearchIcon from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { For, Show, createMemo, createSignal } from "solid-js";

import { Observability } from "#core/observability";
import { Remote, remoteVerdict } from "#core/remote/remote";
import { through } from "#core/remote/transport";

import { announceSourceTexts, arrivalRoot, cloneArrival, type ArrivalKind } from "../../arrival";
import {
  catalogueFailureAttrs,
  catalogueFor,
  catalogueVerdict,
  type CatalogueEntry,
} from "../../catalogue";
import { describe, describeTransfer, reasonOf, remoteReasonOf } from "../../describe";
import { transportFor } from "../../endpoints";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import {
  Button,
  Card,
  Input,
  Menu,
  MenuCheckbox,
  MenuLabel,
  MenuRadio,
  MenuSeparator,
  PanelHeader,
  SegmentedControl,
  Tooltip,
  VirtualList,
  ariaSortOf,
  cx,
  sortIcon,
  toasts,
  type SortDirection,
} from "../primitives";
import type { PendingDownload } from "./downloads";
import { ImportHub } from "./ImportHub";
import { RegionIcon } from "./RegionIcon";
import { formatDate } from "./summaries";

const SORTABLE: readonly (readonly [Column, () => string])[] = [
  ["code", () => t("Code")],
  ["language", () => t("Language")],
  ["region", () => t("Region")],
  ["date", () => t("Date")],
];

const COLUMNS =
  "grid grid-cols-[var(--code-column)_minmax(0,1fr)_8rem_8rem_9rem] items-center gap-x-8 px-8 text-body";

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

const sortChoices = (column: Column): readonly (readonly [SortDirection, string])[] =>
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

type Column = "code" | "language" | "region" | "date";

interface CatalogueRow {
  readonly entry: CatalogueEntry;
  readonly name: string;
  readonly english: string;
  readonly updated: string | undefined;
  readonly refusal: string;
  readonly downloading: boolean;
}

const HOLE = "\u0000";

function NoMatch(props: {
  readonly query: string;
  readonly regions: readonly string[];
  readonly onDropRegion: (region: string) => void;
}) {
  const said = (): readonly string[] =>
    t(
      "Nothing matched your search for “{query}.” Try again using alternate spellings, dialect names, or any variant names for your language.",
      { query: HOLE },
    ).split(HOLE);
  return (
    <div
      data-testid="catalogue-empty"
      class="mx-auto flex max-w-2xl flex-col items-center gap-6 px-8 py-12 text-center"
    >
      <div class="flex flex-col gap-2">
        <h3 class="text-h4 font-bold text-on-surface-primary">{t("No Languages Match")}</h3>
        <p class="text-body text-on-surface-primary">
          <Show
            when={props.query !== ""}
            fallback={t("No languages match the filters below. Remove one to see more.")}
          >
            {said()[0]}
            <strong class="font-bold">{props.query}</strong>
            {said()[1]}
          </Show>
        </p>
      </div>

      <Show when={props.regions.length > 0}>
        <div class="flex flex-wrap items-center justify-center gap-4">
          <span class="text-body font-medium text-on-surface-primary">{t("Filters active:")}</span>
          <For each={props.regions}>
            {(region) => (
              <button
                type="button"
                class="inline-flex cursor-pointer items-center gap-2 rounded-full bg-surface-canvas px-4 py-2 text-body font-medium text-on-surface-primary transition-colors hover:bg-surface-tertiary"
                aria-label={t("Remove the {region} filter", { region })}
                onClick={() => props.onDropRegion(region)}
              >
                {region}
                <X size={16} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="flex w-full items-center gap-6 text-body font-medium text-on-surface-tertiary">
        <span class="h-px flex-1 bg-surface-border" />
        {t("OR")}
        <span class="h-px flex-1 bg-surface-border" />
      </div>

      <div class="flex flex-col items-center gap-2">
        <h3 class="text-h4 font-bold text-on-surface-primary">{t("Import Project")}</h3>
        <p class="text-body text-on-surface-primary">
          {t(
            "You can also import a project to Sefer if it is on your computer or a memory stick. If none of these options work, consult your Project Manager or Regional Director for assistance.",
          )}
        </p>
      </div>

      <ImportHub variant="buttons" />
    </div>
  );
}

export interface DownloadTracker {
  readonly start: (download: PendingDownload, from: DOMRect) => void;
  readonly update: (id: string, patch: Partial<PendingDownload>) => void;
}

export function WacsProjects(props: { readonly downloads: DownloadTracker }) {
  const shell = useShell();
  const { services } = shell;
  const catalogue = catalogueFor(services.settings);
  const gatewaysOffered = services.settings.get(shellKeys(services.settings).showGatewayProjects);

  const transport = transportFor(services.settings, services.hostInfo.kind());
  const reachable = (url: string): boolean =>
    services.hostInfo.kind() !== "web" || through(transport, url) !== url;

  const [entries, setEntries] = createSignal<readonly CatalogueEntry[] | undefined>(undefined, {
    name: "catalogueEntries",
  });
  const [problem, setProblem] = createSignal("", { name: "catalogueProblem" });
  const [query, setQuery] = createSignal("", { name: "catalogueQuery" });
  const [column, setColumn] = createSignal<Column>("language", { name: "catalogueSort" });
  const [direction, setDirection] = createSignal<SortDirection>("asc", {
    name: "catalogueDirection",
  });
  const [busy, setBusy] = createSignal("", { name: "catalogueBusy" });
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
        return (
          entry.code.toLowerCase().includes(needle) ||
          entry.id.toLowerCase().includes(needle) ||
          entry.naturalName.toLowerCase().includes(needle) ||
          entry.anglicizedName.toLowerCase().includes(needle) ||
          entry.alternateNames.some((name) => name.toLowerCase().includes(needle))
        );
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

  const downloadReason = (entry: CatalogueEntry): string => {
    if (entry.gitUrl === "") return t("Sample data — this row names no repository to download.");
    if (!reachable(entry.gitUrl))
      return t("This browser has no way to reach the server this project is on.");
    return "";
  };

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

  const codeColumn = createMemo(
    () => {
      const codes = (entries() ?? []).map((entry) => entry.code);
      if (typeof document === "undefined") return "9rem";
      const context = document.createElement("canvas").getContext("2d");
      if (context === null) return "9rem";
      const style = getComputedStyle(document.body);
      context.font = `400 16px ${style.fontFamily}`;
      let widest = context.measureText(t("Code")).width + 16;
      for (const code of codes) widest = Math.max(widest, context.measureText(code).width);
      return `${String((Math.ceil(widest) + 2) / 16)}rem`;
    },
    { name: "catalogueCodeColumn" },
  );

  const sortOf = (key: Column): SortDirection => (column() === key ? direction() : "none");

  const download = (entry: CatalogueEntry, from: DOMRect): void => {
    const kind: ArrivalKind = entry.type === "gateway" ? "sourceText" : "project";
    const into = arrivalRoot(services, kind, entry.gitUrl);
    // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
    const { downloads } = props;
    setBusy(entry.id);
    const toast =
      kind === "sourceText"
        ? toasts.progress({ title: t("Downloading {name}", { name: entry.repo }), message: "" })
        : undefined;
    if (toast === undefined)
      downloads.start(
        {
          id: entry.id,
          root: into,
          language: entry.naturalName,
          code: entry.code,
          state: "downloading",
          status: t("Starting…"),
          percent: undefined,
        },
        from,
      );
    const watching = services.runtime.runFork(
      Effect.flatMap(Remote, (remote) =>
        Stream.runForEach(remote.progress(), (progress) =>
          Effect.sync(() => {
            const percent =
              progress.total === undefined || progress.total === 0
                ? undefined
                : Math.min(100, Math.round((progress.loaded / progress.total) * 100));
            if (toast === undefined)
              downloads.update(entry.id, {
                status: progress.unit === "bytes" ? describeTransfer(progress) : progress.phase,
                ...(progress.unit === "bytes" ? {} : { percent }),
              });
            else
              toasts.advance(toast, {
                title: t("Downloading {name}", { name: entry.repo }),
                message: describeTransfer(progress),
              });
          }),
        ),
      ),
    );
    const operation = services.composition.observability.operation("import.remote", {
      "import.source": "catalogue",
      "import.host": services.hostInfo.kind(),
      "catalogue.type": entry.type,
    });
    void services
      .run(
        Effect.provideService(
          Effect.gen(function* () {
            if (kind === "sourceText") {
              const held = yield* services.library.cloned(entry.gitUrl);
              if (Option.isSome(held)) return "held" as const;
            }
            yield* cloneArrival(services, kind, entry.gitUrl, { catalogueId: entry.id });
            return "cloned" as const;
          }),
          Observability,
          operation,
        ),
      )
      .then((outcome) => {
        operation.end("passed", { "import.phase": "complete", "import.outcome": outcome });
        if (toast !== undefined)
          toasts.update(toast, {
            title: entry.repo,
            message:
              outcome === "held"
                ? t("Already on this device, under Source texts.")
                : t("Downloaded. Choose it as a source text beside any project."),
            tone: "success",
          });
        else {
          downloads.update(entry.id, { status: t("Done"), percent: 100 });
          void announceSourceTexts(services, into);
        }
      })
      .catch((cause: unknown) => {
        operation.end(remoteVerdict(remoteReasonOf(cause)), {
          "import.reason": reasonOf(cause) ?? "Unknown",
        });
        if (toast !== undefined) toasts.dismiss(toast);
        else downloads.update(entry.id, { state: "failed", status: describe(cause) });
        toasts.error({
          title: t("Could not download {name}", { name: entry.repo }),
          message: describe(cause),
        });
      })
      .finally(() => {
        Effect.runFork(Fiber.interrupt(watching));
        setBusy("");
      });
  };

  return (
    <section class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <PanelHeader title={t("Projects Available on WACS")} class="me-auto" />

        <Show when={gatewaysOffered}>
          <SegmentedControl
            size="sm"
            label={t("Which languages")}
            items={[
              { value: "translation", label: t("Translations") },
              { value: "gateway", label: t("Gateway languages") },
            ]}
            value={kind()}
            onChange={setKind}
          />
        </Show>
        <Input
          type="search"
          size="lg"
          wrapperClass="w-full sm:w-[28rem]"
          class="w-full"
          icon={<SearchIcon size={20} aria-hidden="true" />}
          aria-label={t("Search projects available on WACS")}
          placeholder={t("Search 'english' or 'axd'…")}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <Show when={problem() !== ""}>
          <p class="rounded-md bg-surface-error px-3 py-2 text-small text-on-surface-error">
            {problem()}
          </p>
        </Show>

        <Card
          padded={false}
          role="table"
          aria-label={t("Projects available on WACS")}
          aria-rowcount={rows().length + 1}
          class="flex min-h-0 flex-1 flex-col overflow-hidden"
          style={{ "--code-column": codeColumn() }}
        >
          <div
            role="rowgroup"
            class="scrollbar-subtle shrink-0 overflow-hidden [scrollbar-gutter:stable] border-b border-surface-border"
          >
            <div
              role="row"
              aria-rowindex={1}
              data-catalogue={rows().length}
              class={cx(COLUMNS, "text-on-surface-secondary")}
            >
              <For each={SORTABLE}>
                {([column, label]) => (
                  <div role="columnheader" aria-sort={ariaSortOf(sortOf(column))} class="h-full">
                    <Menu
                      size="lg"
                      label={t("{column} options", { column: label() })}
                      side="bottom"
                      align="start"
                      class="w-60"
                      fitViewport
                      triggerClass={
                        column === "code"
                          ? "-ms-8 -me-4 flex h-full w-[calc(100%+3rem)]"
                          : "-mx-4 flex h-full w-[calc(100%+2rem)]"
                      }
                      open={menuFor() === column}
                      onOpenChange={(open) => setMenuFor(open ? column : "")}
                      trigger={
                        <button
                          type="button"
                          data-column={column}
                          data-first={column === "code" ? "" : undefined}
                          class="flex w-full cursor-pointer items-center gap-1.5 p-4 text-start data-first:ps-8 font-medium text-inherit transition-colors hover:bg-surface-tertiary hover:text-on-surface-primary data-open:bg-surface-tertiary"
                          data-open={menuFor() === column ? "" : undefined}
                        >
                          <span class="min-w-0 flex-1 truncate">{label()}</span>
                          {sortIcon(sortOf(column), 14)}
                          <Show when={column === "region" && regionFilter().size > 0}>
                            <Filter size={14} aria-label={t("filtered")} class="text-brand" />
                          </Show>
                        </button>
                      }
                    >
                      <MenuLabel>{t("Sort")}</MenuLabel>
                      <For each={sortChoices(column)}>
                        {([choice, text]) => (
                          <MenuRadio
                            checked={sortOf(column) === choice}
                            icon={
                              choice === "asc" ? (
                                <ArrowUp size={16} aria-hidden="true" class="shrink-0" />
                              ) : (
                                <ArrowDown size={16} aria-hidden="true" class="shrink-0" />
                              )
                            }
                            onSelect={() => {
                              setColumn(column);
                              setDirection(choice);
                            }}
                          >
                            {text}
                          </MenuRadio>
                        )}
                      </For>
                      <Show when={column === "region" && regions().length > 0}>
                        <MenuSeparator />
                        <MenuLabel>{t("Filter")}</MenuLabel>
                        <For each={regions()}>
                          {([name, count]) => (
                            <MenuCheckbox
                              checked={regionFilter().has(name)}
                              icon={<RegionIcon region={name} />}
                              onChange={(on) => toggleRegion(name, on)}
                            >
                              {name}
                              <span class="ms-2 text-smallest font-semibold tabular-nums text-on-surface-secondary">
                                {count}
                              </span>
                            </MenuCheckbox>
                          )}
                        </For>
                        <MenuCheckbox
                          checked={regionFilter().size === 0}
                          icon={<RegionIcon region="" />}
                          onChange={() => setRegionFilter(new Set<string>())}
                        >
                          {t("All regions")}
                          <span class="ms-2 text-smallest font-semibold tabular-nums text-on-surface-secondary">
                            {(entries() ?? []).length}
                          </span>
                        </MenuCheckbox>
                      </Show>
                    </Menu>
                  </div>
                )}
              </For>
              <div role="columnheader">
                <span class="sr-only">{t("Download")}</span>
              </div>
            </div>
          </div>
          <VirtualList<CatalogueRow>
            role="rowgroup"
            class="scrollbar-subtle min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
            sections={virtualRows().length > 0 ? [{ key: "catalogue", rows: virtualRows() }] : []}
            empty={
              <Show
                when={entries()}
                fallback={
                  <p class="py-8 text-center text-body text-on-surface-tertiary">
                    {t("Loading projects…")}
                  </p>
                }
              >
                <NoMatch
                  query={query().trim()}
                  regions={[...regionFilter()]}
                  onDropRegion={(name) => toggleRegion(name, false)}
                />
              </Show>
            }
            row={(item) => {
              const entry = () => item().entry;
              return (
                <div
                  role="row"
                  aria-rowindex={(rowIndex().get(entry().id) ?? 0) + 2}
                  data-entry={entry().id}
                  class={cx(
                    COLUMNS,
                    "border-b border-surface-border py-4 transition-colors hover:bg-surface-secondary",
                  )}
                >
                  <div role="cell" class="whitespace-nowrap text-on-surface-secondary">
                    {entry().code}
                  </div>
                  <div role="cell" class="min-w-0">
                    <strong class="font-medium text-on-surface-primary">{item().name}</strong>
                    <Show when={item().english !== ""}>
                      <span class="ms-2 text-on-surface-tertiary">{item().english}</span>
                    </Show>

                    <div class="truncate font-mono text-smallest text-on-surface-tertiary">
                      {entry().id}
                    </div>
                  </div>
                  <div role="cell" class="text-on-surface-secondary">
                    {entry().region ?? "—"}
                  </div>
                  <div role="cell" class="text-on-surface-secondary">
                    {formatDate(item().updated) || "—"}
                  </div>
                  <div role="cell" class="text-end">
                    <Show
                      when={item().refusal === ""}
                      fallback={
                        <Tooltip label={item().refusal}>
                          <Button
                            variant="link"
                            size="flush"
                            aria-disabled="true"
                            class="opacity-60"
                            icon={<Download size={16} aria-hidden="true" />}
                          >
                            {t("Download")}
                          </Button>
                        </Tooltip>
                      }
                    >
                      <Button
                        variant="link"
                        size="flush"
                        loading={item().downloading}
                        icon={<Download size={16} aria-hidden="true" />}
                        onClick={(event) =>
                          download(
                            entry(),
                            (
                              event.currentTarget.closest("[role=row]") ?? event.currentTarget
                            ).getBoundingClientRect(),
                          )
                        }
                      >
                        {t("Download")}
                      </Button>
                    </Show>
                  </div>
                </div>
              );
            }}
          />
        </Card>
      </div>
    </section>
  );
}
