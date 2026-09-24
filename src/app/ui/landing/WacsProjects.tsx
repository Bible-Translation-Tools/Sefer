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

import { Effect } from "effect";
import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowUp from "lucide-solid/icons/arrow-up";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import Download from "lucide-solid/icons/download";
import SearchIcon from "lucide-solid/icons/search";
import { For, Show, createMemo, createSignal } from "solid-js";

import { lastSegment } from "#core/fileSystem/path";
import { cloneRepository } from "#core/remote/clone";

import { catalogueFor, type CatalogueEntry } from "../../catalogue";
import { describe } from "../../describe";
import { wacsUrlFor } from "../../endpoints";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  Badge,
  Button,
  Card,
  Input,
  PanelHeader,
  Tooltip,
  VirtualList,
  cx,
  toasts,
  type SortDirection,
} from "../primitives";
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
const COLUMNS = "grid grid-cols-[5rem_minmax(0,1fr)_8rem_7rem_9rem] items-center";

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

/** What one catalogue row is tall, before it has been measured. */
const ROW_HEIGHT = 41;

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

export function WacsProjects(props: { readonly onDownloaded: () => void }) {
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

  void catalogue
    .entries()
    .then((all) => {
      // Gateway languages are not offered here at all — see the file header.
      const translations = all.filter((entry) => entry.type !== "gateway");
      setEntries(translations);
    })
    .catch((cause: unknown) => {
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
      return (entries() ?? []).filter((entry) => {
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

  const sortOf = (key: Column): SortDirection => (column() === key ? direction() : "none");

  const toggleSort = (key: Column): void => {
    if (column() !== key) {
      setColumn(key);
      setDirection("asc");
      return;
    }
    setDirection(direction() === "asc" ? "desc" : "asc");
  };

  /**
   * A download that fails must SAY SO. `services.run` rejects with the tagged
   * failure itself, whose `toString` is the bare tag — so the reason and the
   * description are read structurally (`src/app/describe.ts`), the toast keeps
   * the error tone, it never auto-closes, and it carries an × like every other
   * one. The previous version of this handler produced a toast that said
   * "RemoteError" and could not be dismissed.
   */
  const download = (entry: CatalogueEntry): void => {
    const into = `${services.projectsRoot}/${lastSegment(entry.cloneUrl.replace(/\.git$/u, ""))}`;
    setBusy(entry.id);
    const toast = toasts.progress({ title: t("Downloading {name}", { name: entry.repo }) });
    void services
      .run(
        // The index learns about the project in the same pipeline, the moment
        // its files and history are on disk, so the list and its links are
        // right before the toast says it is done.
        cloneRepository(entry.cloneUrl, into, entry.id).pipe(
          Effect.andThen(rememberProject(services.projectsRoot, into, undefined)),
        ),
      )
      // oxlint-disable-next-line solid/reactivity -- a promise continuation: runs once, when the download settles
      .then(() => {
        toasts.update(toast, {
          title: t("Downloaded {name}", { name: entry.repo }),
          message: into,
          tone: "success",
        });
        props.onDownloaded();
      })
      .catch((cause: unknown) =>
        toasts.update(toast, {
          title: t("Could not download {name}", { name: entry.repo }),
          message: describe(cause),
          tone: "error",
          autoClose: false,
        }),
      )
      .finally(() => setBusy(""));
  };

  return (
    <section class="space-y-3">
      <div class="flex flex-wrap items-end gap-3">
        <PanelHeader level={3} title={t("Projects Available on WACS")} class="me-auto" />
        <Input
          type="search"
          size="md"
          wrapperClass="w-full sm:w-80"
          class="w-full"
          icon={<SearchIcon size={16} aria-hidden="true" />}
          aria-label={t("Search projects available on WACS")}
          placeholder={t("Search 'english' or 'axd'…")}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      <div class="min-w-0 space-y-3">
        <div class="flex flex-wrap items-center gap-2 text-smallest text-on-surface-tertiary">
          <Badge tone={catalogue.source === "live" ? "success" : "warning"} size="sm">
            {catalogue.source === "live" ? t("live catalogue") : t("sample data")}
          </Badge>
          <Show
            when={catalogue.source === "live"}
            fallback={<span>{t("No catalogue configured: set VITE_SEFER_LANGUAGE_API_URL.")}</span>}
          >
            <span class="font-mono">{catalogue.origin}</span>
          </Show>
          <Show when={entries()}>
            {(all) => (
              <span class="ms-auto">
                {t("{shown} of {total}", { shown: rows().length, total: all().length })}
              </span>
            )}
          </Show>
        </div>

        <Show when={problem() !== ""}>
          <p class="rounded-md bg-surface-error px-3 py-2 text-small text-on-surface-error">
            {problem()}
          </p>
        </Show>

        <Card padded={false} class="overflow-hidden">
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
          <VirtualList<CatalogueRow>
            class="h-[60vh] min-h-0 overflow-y-auto"
            sections={[{ key: "catalogue", rows: virtualRows() }]}
            empty={
              <p class="py-8 text-center text-small text-on-surface-tertiary">
                <Show when={entries()} fallback={t("Loading projects…")}>
                  {t("No results. Try a different search or filter.")}
                </Show>
              </p>
            }
            header={(_section, ref) => (
              <div
                ref={ref}
                role="row"
                data-catalogue={rows().length}
                class={cx(
                  COLUMNS,
                  "border-b border-surface-border bg-surface-secondary text-smallest text-on-surface-secondary",
                )}
              >
                <For each={SORTABLE}>
                  {([column, label]) => (
                    <div role="columnheader" class="px-3 py-2 font-medium">
                      <button
                        type="button"
                        aria-sort={ariaSort(sortOf(column))}
                        class="inline-flex cursor-pointer items-center gap-1 text-inherit transition-colors hover:text-on-surface-primary"
                        onClick={() => toggleSort(column)}
                      >
                        {label()}
                        {sortOf(column) === "asc" ? (
                          <ArrowUp size={12} aria-hidden="true" />
                        ) : sortOf(column) === "desc" ? (
                          <ArrowDown size={12} aria-hidden="true" />
                        ) : (
                          <ChevronsUpDown size={12} aria-hidden="true" class="opacity-50" />
                        )}
                      </button>
                    </div>
                  )}
                </For>
                <div role="columnheader" class="px-3 py-2">
                  <span class="sr-only">{t("Download")}</span>
                </div>
              </div>
            )}
            row={(item) => {
              const entry = () => item().entry;
              return (
                <div
                  role="row"
                  data-entry={entry().id}
                  class={cx(
                    COLUMNS,
                    "border-b border-surface-border text-small transition-colors hover:bg-surface-secondary",
                  )}
                >
                  <div
                    role="cell"
                    class="px-3 py-2 font-mono text-smallest text-on-surface-tertiary"
                  >
                    {entry().code}
                  </div>
                  <div role="cell" class="min-w-0 px-3 py-2">
                    <strong class="font-medium text-on-surface-primary">{item().name}</strong>
                    <Show when={item().english !== ""}>
                      <span class="ms-2 text-smallest text-on-surface-tertiary">
                        {item().english}
                      </span>
                    </Show>
                  </div>
                  <div role="cell" class="px-3 py-2 text-on-surface-secondary">
                    {entry().region ?? "—"}
                  </div>
                  <div role="cell" class="px-3 py-2 text-on-surface-secondary">
                    {formatDate(item().updated) || "—"}
                  </div>
                  <div role="cell" class="px-3 py-2 text-end">
                    <Show
                      when={item().refusal === ""}
                      fallback={
                        <Tooltip label={item().refusal}>
                          <span class="inline-flex cursor-not-allowed items-center gap-1 text-smallest text-on-surface-tertiary opacity-60">
                            <Download size={13} aria-hidden="true" />
                            {t("Download")}
                          </span>
                        </Tooltip>
                      }
                    >
                      <Button
                        size="sm"
                        variant="tertiary"
                        loading={item().downloading}
                        icon={<Download size={13} aria-hidden="true" />}
                        onClick={() => download(entry())}
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
