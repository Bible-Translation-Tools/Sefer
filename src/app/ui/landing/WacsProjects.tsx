/**
 * Projects Available on WACS: the remote catalogue, as the second section of
 * the projects page. A header with the search field inline, then a windowed
 * five-column table — Code, Language, Region, Date, Download.
 *
 * The rows come from `src/app/catalogue.ts`: the Language API's consolidated
 * repos, joined with langnames for region, alternate names and the gateway
 * flag. **Gateway languages are left out** — this table is for a translation
 * team finding its own work. A row's date is the most recent update across
 * every repo of its language — blank until the API carries one (see
 * `catalogue.ts`).
 *
 * Search matches the code, both names, and every alternate name.
 *
 * Download clones: what the payload carries is `repo_url`, and
 * `cloneRepository` is what takes one. A row with no URL, or a build with no
 * transfer configured, gets a disabled link with the reason in a tooltip.
 */

import { Effect, Fiber, Stream } from "effect";
import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowUp from "lucide-solid/icons/arrow-up";
import Check from "lucide-solid/icons/check";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import Download from "lucide-solid/icons/download";
import Filter from "lucide-solid/icons/filter";
import SearchIcon from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { For, Show, createMemo, createSignal } from "solid-js";

import { lastSegment } from "#core/fileSystem/path";
import { Observability } from "#core/observability";
import { cloneRepository } from "#core/remote/clone";
import { Remote, remoteVerdict } from "#core/remote/remote";

import {
  catalogueFailureAttrs,
  catalogueFor,
  catalogueVerdict,
  type CatalogueEntry,
} from "../../catalogue";
import { describe, reasonOf, remoteReasonOf } from "../../describe";
import { wacsUrlFor } from "../../endpoints";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  Button,
  Card,
  Input,
  Popover,
  PanelHeader,
  Tooltip,
  VirtualList,
  cx,
  toasts,
  type SortDirection,
} from "../primitives";
import type { PendingDownload } from "./downloads";
import { ImportHub } from "./ImportHub";
import { RegionIcon } from "./RegionIcon";
import { formatDate, rememberProject } from "./summaries";

/** The four sortable columns, in the order they are drawn. */
const SORTABLE: readonly (readonly [Column, () => string])[] = [
  ["code", () => t("Code")],
  ["language", () => t("Language")],
  ["region", () => t("Region")],
  ["date", () => t("Date")],
];

/**
 * One grid template for the header row and every body row, so the two cannot
 * drift apart the way a hand-aligned pair of widths does. `minmax(0, …)` on the
 * name column is what lets a long repository path truncate instead of pushing
 * the Download button off the end.
 */
const COLUMNS =
  "grid grid-cols-[var(--code-column)_minmax(0,1fr)_8rem_8rem_9rem] items-center gap-x-8 px-8 text-body";

/** What a row sorts by in `key`, with the date read through `updated`. */
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

/** The two sort choices a column offers, in its own words. */
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

/*
 * The header menus: 16px all round, everywhere. An item leads with whatever
 * it has first (a sort arrow, or the region's name), and the heading starts at
 * the same 16px, so the first thing on every line shares one edge.
 */
const menuHeading =
  "px-4 pb-1 text-small font-semibold tracking-wide text-on-surface-tertiary uppercase";
const menuItem =
  "flex w-full cursor-pointer items-center gap-4 p-4 text-start text-body font-medium text-on-surface-primary hover:bg-surface-secondary";

/**
 * The drawn box beside a visually hidden checkbox, which must come just before
 * it (`peer`): an outline when off, a blue check when on, a ring when focused.
 */
const CheckBox = () => (
  <span
    aria-hidden="true"
    class="flex size-4 shrink-0 items-center justify-center rounded border-[1.5px] border-on-surface-tertiary text-transparent transition-colors peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-1"
  >
    <Check size={12} strokeWidth={3} />
  </span>
);

/** What one catalogue row is tall, before it has been measured. */
const ROW_HEIGHT = 57;

const ariaSort = (sort: SortDirection): "none" | "ascending" | "descending" =>
  sort === "asc" ? "ascending" : sort === "desc" ? "descending" : "none";

type Column = "code" | "language" | "region" | "date";

/**
 * One row, with every value the table draws already computed.
 *
 * The whole point of this shape: **a row must not read a signal.** The live
 * catalogue is thousands of rows, and `nameOf(entry)` inside the `<For>` body
 * made every one of them a subscriber of the name-style signal — thousands of
 * scopes re-running to move one segmented control, which is what the
 * `HUGE_FAN_OUT` diagnostic was reporting. The derivation happens once, in the
 * `rows` memo; a row receives plain values, `busy` included.
 *
 * Two things were measured against a 1,333-row catalogue before this shape was
 * settled on, and both are worth writing down because both look right:
 *
 *   * a per-key store `createProjection` keyed by row id — the repair the
 *     diagnostic's own text suggests — measured WORSE (13,000 subscribers
 *     against 6,500), because a store read still registers a node per row;
 *   * a memo returning fresh row objects with an unkeyed `<For>` measured
 *     worse for the same reason: every flip tore down and rebuilt all 1,333
 *     rows. Hence `keyed={(row) => row.entry.id}` below.
 *
 * What is left is NOT ours and cannot be fixed here: at 1,333 rows the page
 * still reports ~6,500 subscribers on one unnamed signal, and the same number
 * appears when the row is five instances of a five-line component that reads
 * nothing at all. It is one subscriber per COMPONENT INSTANCE in Solid
 * 2.0.0-rc.6 — raw `<tr>`/`<td>` elements report zero. Nothing in this file,
 * or in `primitives/Table.tsx`, moves it.
 */
interface CatalogueRow {
  readonly entry: CatalogueEntry;
  /** The language's own name. */
  readonly name: string;
  /** The English name, when it differs from `name`; else empty. */
  readonly english: string;
  /** The most recent update across every repo of this language. */
  readonly updated: string | undefined;
  /** Empty when Download is offered; otherwise why it is not. */
  readonly refusal: string;
  /** True while this row's clone is running. A value, never a signal read. */
  readonly downloading: boolean;
}

/** A mark no search or language name contains, to split a message around. */
const HOLE = "\u0000";

/**
 * What a search that finds nothing says: why, the filters that may be to
 * blame (each one a chip that drops it), and the other way in — importing a
 * project that is not on WACS at all.
 */
function NoMatch(props: {
  readonly query: string;
  readonly regions: readonly string[];
  readonly onDropRegion: (region: string) => void;
  readonly onImported: () => void;
}) {
  // One message, so a translator sees the whole sentence; the query is bolded
  // by splitting the result around a placeholder no search can contain.
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
      {/* The same import the old cards ran, as two buttons, each going
          straight to the system picker. */}
      <ImportHub variant="buttons" onImported={() => props.onImported()} />
    </div>
  );
}

/** How the table tells the page about a download it started. */
export interface DownloadTracker {
  readonly start: (download: PendingDownload, from: DOMRect) => void;
  readonly update: (id: string, patch: Partial<PendingDownload>) => void;
}

export function WacsProjects(props: {
  readonly onDownloaded: () => void;
  readonly downloads: DownloadTracker;
}) {
  const shell = useShell();
  const { services } = shell;
  // One catalogue per mount. It is a pure value over `env`, so there is nothing
  // to keep reactive and nothing to dispose.
  const catalogue = catalogueFor(services.settings);

  // One endpoint, one condition: it is either configured or this build has no
  // cloud. On the Web that endpoint is normally a proxy, but nothing here
  // needs to know which — it answers on the same paths either way.
  const transfersConfigured = wacsUrlFor(services.settings, services.hostInfo.kind()) !== null;

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
  /** Which column's header menu is open; "" for none. */
  const [menuFor, setMenuFor] = createSignal<Column | "">("", { name: "catalogueMenu" });
  /** Regions to keep; empty keeps every region (the "All regions" choice). */
  const [regionFilter, setRegionFilter] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "catalogueRegionFilter",
  });
  const toggleRegion = (name: string, on: boolean): void => {
    const next = new Set(regionFilter());
    if (on) next.add(name);
    else next.delete(name);
    setRegionFilter(next);
  };

  /** The region filter's choices, each with how many rows it holds. */
  const regions = createMemo(
    (): readonly (readonly [string, number])[] => {
      const counted = new Map<string, number>();
      for (const entry of entries() ?? []) {
        const key = entry.region ?? "";
        counted.set(key, (counted.get(key) ?? 0) + 1);
      }
      // Named regions A–Z. Rows with no region are reached through "All
      // regions", which is the unfiltered table.
      counted.delete("");
      return [...counted.entries()].sort(([left], [right]) => left.localeCompare(right));
    },
    { name: "catalogueRegions" },
  );

  // One read of the catalogue, as one operation: which source answered, how
  // many rows, how long. Never the endpoint — `catalogue.source` says whether
  // it was the live API, and the URL is the build's business.
  const browsing = services.composition.observability.operation("catalogue.browse", {
    "catalogue.source": catalogue.source,
  });
  void catalogue
    .entries()
    .then((all) => {
      browsing.end("passed", {
        "catalogue.entries": all.length,
        "catalogue.gateways": all.filter((entry) => entry.type === "gateway").length,
      });
      // Gateway languages are not offered here at all — see the file header.
      const translations = all.filter((entry) => entry.type !== "gateway");
      setEntries(translations);
    })
    .catch((cause: unknown) => {
      browsing.end(catalogueVerdict(cause), catalogueFailureAttrs(cause));
      setEntries([]);
      setProblem(describe(cause));
    });

  /** Per language code, the newest date across all of its repos. */
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
        if (keep.size > 0 && (entry.region === undefined || !keep.has(entry.region))) return false;
        if (needle === "") return true;
        return (
          entry.code.toLowerCase().includes(needle) ||
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
    if (entry.cloneUrl === "") return t("Sample data — this row names no repository to download.");
    if (!transfersConfigured)
      return t(
        "Transfers have no server for this build. Set the WACS endpoint on the Network card in Settings.",
      );
    return "";
  };

  /**
   * The rows the table draws. Every reactive read the rows used to make — the
   * name style, the two filters, the sort — happens HERE, once, and each row
   * receives plain strings.
   */
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

  /**
   * The same rows, as the virtualizer takes them: a stable key and a height to
   * assume until the row has been on screen. Every row here is one line of
   * text and a button, so one estimate is right for all of them and the list
   * never has to correct itself.
   */
  const virtualRows = createMemo(
    () => rows().map((row) => ({ key: row.entry.id, item: row, estimate: ROW_HEIGHT })),
    { name: "catalogueVirtualRows" },
  );

  /**
   * The Code column, as wide as the longest code and no wider. Measured once
   * per catalogue in the table's own font: every virtual row is its own grid,
   * so `max-content` would size each row differently.
   */
  const codeColumn = createMemo(
    () => {
      const codes = (entries() ?? []).map((entry) => entry.code);
      if (typeof document === "undefined") return "9rem";
      const context = document.createElement("canvas").getContext("2d");
      if (context === null) return "9rem";
      const style = getComputedStyle(document.body);
      context.font = `400 16px ${style.fontFamily}`;
      // The header's word and its sort arrow are the floor.
      let widest = context.measureText(t("Code")).width + 16;
      for (const code of codes) widest = Math.max(widest, context.measureText(code).width);
      return `${String(Math.ceil(widest) + 2)}px`;
    },
    { name: "catalogueCodeColumn" },
  );

  const sortOf = (key: Column): SortDirection => (column() === key ? direction() : "none");

  /**
   * A download that fails must SAY SO. `services.run` rejects with the tagged
   * failure itself, whose `toString` is the bare tag — so the reason and the
   * description are read structurally (`src/app/describe.ts`), the toast keeps
   * the error tone, it never auto-closes, and it carries an × like every other
   * one. The previous version of this handler produced a toast that said
   * "RemoteError" and could not be dismissed.
   */
  /**
   * Download: the row flies up to the installed list as a card at once, and
   * that card carries the progress. A failure is still a toast as well — it
   * must SAY SO, and never auto-close (`src/app/describe.ts` reads the reason
   * structurally, so the toast is not a bare tag).
   *
   * Progress comes from `Remote.progress()`, the transport's one stream. It is
   * not per clone, which is fine while `busy` allows one download at a time.
   */
  const download = (entry: CatalogueEntry, from: DOMRect): void => {
    const into = `${services.projectsRoot}/${lastSegment(entry.cloneUrl.replace(/\.git$/u, ""))}`;
    // Read once, at the click: the callbacks below run long after, outside
    // any tracking scope, and must not read props there.
    const { downloads, onDownloaded } = props;
    setBusy(entry.id);
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
          Effect.sync(() =>
            downloads.update(entry.id, {
              status: progress.phase,
              percent:
                progress.total === undefined || progress.total === 0
                  ? undefined
                  : Math.min(100, Math.round((progress.loaded / progress.total) * 100)),
            }),
          ),
        ),
      ),
    );
    // The same operation the import hub's clone opens, told apart by where it
    // came from. No URL and no repository name: the catalogue row's type is
    // the one fact about it worth filtering on.
    const operation = services.composition.observability.operation("import.remote", {
      "import.source": "catalogue",
      "import.host": services.hostInfo.kind(),
      "catalogue.type": entry.type,
    });
    void services
      .run(
        Effect.provideService(
          // The index learns about the project in the same pipeline, the moment
          // its files and history are on disk, so the list and its links are
          // right before the card says it is done.
          cloneRepository(entry.cloneUrl, into, entry.id).pipe(
            Effect.andThen(rememberProject(services.projectsRoot, into, undefined)),
          ),
          Observability,
          operation,
        ),
      )
      .then(() => {
        operation.end("passed", { "import.phase": "complete" });
        downloads.update(entry.id, { status: t("Done"), percent: 100 });
        onDownloaded();
      })
      .catch((cause: unknown) => {
        operation.end(remoteVerdict(remoteReasonOf(cause)), {
          "import.reason": reasonOf(cause) ?? "Unknown",
        });
        downloads.update(entry.id, { state: "failed", status: describe(cause) });
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
    // Takes the page's remaining height and never more: the table scrolls
    // inside itself, and the page above it never scrolls away.
    <section class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <PanelHeader title={t("Projects Available on WACS")} class="me-auto" />
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
          class="flex min-h-0 flex-1 flex-col overflow-hidden"
          style={{ "--code-column": codeColumn() }}
        >
          {/* WINDOWED, and the catalogue is why: it lists every repository the
              Language API knows, which on this account is 521 rows — 2,605
              cells and 6,941 DOM nodes, all built, all measured, for the dozen
              a reader can see. The section header is the column row, so the
              list gets a sticky heading for free and the two stay aligned by
              sharing one grid template.

              A grid and not a `<table>`: a virtual row is positioned by a
              transform, and a transform on a `<tr>` is not something table
              layout honours. The roles carry the semantics the elements no
              longer do. */}
          {/* The column row, above the scroll pane. Both it and the list
              reserve the scrollbar's gutter (`scrollbar-gutter: stable`),
              scrolling or not, so the columns line up without measuring. */}
          <div class="scrollbar-subtle shrink-0 overflow-hidden [scrollbar-gutter:stable] border-b border-surface-border bg-surface-secondary">
            <div
              role="row"
              data-catalogue={rows().length}
              class={cx(COLUMNS, "text-on-surface-secondary")}
            >
              <For each={SORTABLE}>
                {([column, label]) => (
                  <div role="columnheader" aria-sort={ariaSort(sortOf(column))} class="h-full">
                    {/* The whole cell is the button, so the hover lights the
                        area and not just the word. It opens the column's
                        menu: Sort always, Filter where the column has one. */}
                    <Popover
                      label={t("{column} options", { column: label() })}
                      side="bottom"
                      align="start"
                      class="w-60 rounded-2xl! px-0! py-4!"
                      fitViewport
                      triggerClass={
                        // The hover reaches 16px into the 32px gap each side;
                        // the first column reaches back to the table's edge.
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
                          {label()}
                          {sortOf(column) === "asc" ? (
                            <ArrowUp size={14} aria-hidden="true" />
                          ) : sortOf(column) === "desc" ? (
                            <ArrowDown size={14} aria-hidden="true" />
                          ) : (
                            <ChevronsUpDown size={14} aria-hidden="true" class="opacity-50" />
                          )}
                          <Show when={column === "region" && regionFilter().size > 0}>
                            <Filter size={14} aria-label={t("filtered")} class="text-brand" />
                          </Show>
                        </button>
                      }
                    >
                      <p class={menuHeading}>{t("Sort")}</p>
                      <For each={sortChoices(column)}>
                        {([choice, text]) => (
                          <button
                            type="button"
                            class={menuItem}
                            aria-pressed={sortOf(column) === choice ? "true" : "false"}
                            onClick={() => {
                              setColumn(column);
                              setDirection(choice);
                              setMenuFor("");
                            }}
                          >
                            {choice === "asc" ? (
                              <ArrowUp size={16} aria-hidden="true" class="shrink-0" />
                            ) : (
                              <ArrowDown size={16} aria-hidden="true" class="shrink-0" />
                            )}
                            <span class="min-w-0 flex-1">{text}</span>
                            <Show when={sortOf(column) === choice}>
                              <Check size={16} aria-hidden="true" class="shrink-0 text-brand" />
                            </Show>
                          </button>
                        )}
                      </For>
                      <Show when={column === "region" && regions().length > 0}>
                        <p class={cx(menuHeading, "mt-2 border-t border-surface-border pt-4")}>
                          {t("Filter")}
                        </p>
                        <div>
                          <For each={regions()}>
                            {([name, count]) => (
                              <label class={menuItem}>
                                <RegionIcon region={name} />
                                <span class="min-w-0 flex-1 truncate">
                                  {name}
                                  <span class="ms-2 text-smallest font-semibold tabular-nums text-on-surface-secondary">
                                    {count}
                                  </span>
                                </span>
                                {/* The real input stays, visually hidden, for the
                                    keyboard and screen readers; the box beside it
                                    is drawn: an outline when off, a blue check
                                    when on, and the focus ring when focused. */}
                                <input
                                  type="checkbox"
                                  class="peer sr-only"
                                  checked={regionFilter().has(name)}
                                  onChange={(event) =>
                                    toggleRegion(name, event.currentTarget.checked)
                                  }
                                />
                                <CheckBox />
                              </label>
                            )}
                          </For>
                          <label class={menuItem}>
                            <RegionIcon region="" />
                            <span class="min-w-0 flex-1 truncate">
                              {t("All regions")}
                              <span class="ms-2 text-smallest font-semibold tabular-nums text-on-surface-secondary">
                                {(entries() ?? []).length}
                              </span>
                            </span>
                            <input
                              type="checkbox"
                              class="peer sr-only"
                              checked={regionFilter().size === 0}
                              onChange={() => setRegionFilter(new Set<string>())}
                            />
                            <CheckBox />
                          </label>
                        </div>
                      </Show>
                    </Popover>
                  </div>
                )}
              </For>
              <div role="columnheader">
                <span class="sr-only">{t("Download")}</span>
              </div>
            </div>
          </div>
          <VirtualList<CatalogueRow>
            class="scrollbar-subtle min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
            // No section at all when nothing matches: the list shows `empty` only
            // then, and a section with zero rows would draw nothing instead.
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
                  onImported={() => props.onDownloaded()}
                />
              </Show>
            }
            // The column row lives OUTSIDE the scroller (above), so the
            // scrollbar runs beside the rows only. The list still asks for a
            // section header to measure; an empty one costs nothing.
            header={(_section, ref) => <div ref={ref} />}
            row={(item) => {
              const entry = () => item().entry;
              return (
                <div
                  role="row"
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
                          <span class="inline-flex cursor-not-allowed items-center gap-1 text-on-surface-tertiary opacity-60">
                            <Download size={16} aria-hidden="true" />
                            {t("Download")}
                          </span>
                        </Tooltip>
                      }
                    >
                      <Button
                        size="sm"
                        variant="tertiary"
                        class="h-auto px-0 text-body! text-brand!"
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
