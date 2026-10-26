import { useNavigate } from "@tanstack/solid-router";
import ArrowDown from "lucide-solid/icons/arrow-down";
import ArrowUp from "lucide-solid/icons/arrow-up";
import Download from "lucide-solid/icons/download";
import Filter from "lucide-solid/icons/filter";
import SearchIcon from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { For, Show, createSignal } from "solid-js";

import { through } from "#core/remote/transport";

import { catalogueFor, type CatalogueEntry } from "../../catalogue";
import { transportFor } from "../../endpoints";
import { t } from "../../i18n";
import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { WriterTable } from "../migrate/WriterLanguages";
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
} from "../primitives";
import { downloadEntry } from "./catalogueDownload";
import {
  SORTABLE,
  createCatalogueEntries,
  createCatalogueFilters,
  createCatalogueRows,
  sortChoices,
  type CatalogueRow,
  type Column,
} from "./catalogueView";
import type { PendingDownload } from "./downloads";
import { CloneFromUrl, ImportHub } from "./ImportHub";
import { RegionIcon } from "./RegionIcon";
import { formatDate } from "./summaries";

const COLUMNS =
  "grid grid-cols-[var(--code-column)_minmax(0,1fr)_8rem_8rem_9rem] items-center gap-x-8 px-8 text-body";

const HOLE = "\u0000";

/**
 * A search that starts with `http` is an address, not a language: when it
 * parses as a URL it is offered as a clone instead of matched. Whether a
 * repository answers there is the clone's to find out, as Migrate's
 * "From a URL" leaves it to the remote's probe.
 */
const repositoryUrl = (query: string): string | undefined => {
  const typed = query.trim();
  if (!typed.startsWith("http")) return undefined;
  try {
    return new URL(typed).href;
  } catch {
    return undefined;
  }
};

const CloneOffer = (props: { readonly url: string }) => (
  <div
    data-testid="catalogue-clone"
    class="mx-auto flex max-w-2xl flex-col items-center gap-4 px-8 py-12 text-center"
  >
    <h3 class="text-h4 font-bold text-on-surface-primary">{m.landing_clone_from_link()}</h3>
    <p class="break-all text-body text-on-surface-secondary">{props.url}</p>
    <CloneFromUrl url={props.url} />
  </div>
);

type Filters = ReturnType<typeof createCatalogueFilters>;

const ActiveFilters = (props: {
  readonly regions: readonly string[];
  readonly onDropRegion: (region: string) => void;
}) => (
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
);

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
        <ActiveFilters regions={props.regions} onDropRegion={props.onDropRegion} />
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

const SortRadios = (props: { readonly column: Column; readonly filters: Filters }) => (
  <For each={sortChoices(props.column)}>
    {([choice, text]) => (
      <MenuRadio
        checked={props.filters.sortOf(props.column) === choice}
        icon={
          choice === "asc" ? (
            <ArrowUp size={16} aria-hidden="true" class="shrink-0" />
          ) : (
            <ArrowDown size={16} aria-hidden="true" class="shrink-0" />
          )
        }
        onSelect={() => {
          props.filters.setColumn(props.column);
          props.filters.setDirection(choice);
        }}
      >
        {text}
      </MenuRadio>
    )}
  </For>
);

const RegionFilters = (props: { readonly filters: Filters; readonly total: number }) => (
  <>
    <MenuSeparator />
    <MenuLabel>{t("Filter")}</MenuLabel>
    <For each={props.filters.regions()}>
      {([name, count]) => (
        <MenuCheckbox
          checked={props.filters.regionFilter().has(name)}
          icon={<RegionIcon region={name} />}
          onChange={(on) => props.filters.toggleRegion(name, on)}
        >
          {name}
          <span class="ms-2 text-smallest font-semibold tabular-nums text-on-surface-secondary">
            {count}
          </span>
        </MenuCheckbox>
      )}
    </For>
    <MenuCheckbox
      checked={props.filters.regionFilter().size === 0}
      icon={<RegionIcon region="" />}
      onChange={() => props.filters.setRegionFilter(new Set<string>())}
    >
      {t("All regions")}
      <span class="ms-2 text-smallest font-semibold tabular-nums text-on-surface-secondary">
        {props.total}
      </span>
    </MenuCheckbox>
  </>
);

const ColumnHeader = (props: {
  readonly column: Column;
  readonly label: string;
  readonly filters: Filters;
  readonly total: number;
}) => (
  <div
    role="columnheader"
    aria-sort={ariaSortOf(props.filters.sortOf(props.column))}
    class="h-full"
  >
    <Menu
      size="lg"
      label={t("{column} options", { column: props.label })}
      side="bottom"
      align="start"
      class="w-60"
      fitViewport
      triggerClass={
        props.column === "code"
          ? "-ms-8 -me-4 flex h-full w-[calc(100%+3rem)]"
          : "-mx-4 flex h-full w-[calc(100%+2rem)]"
      }
      open={props.filters.menuFor() === props.column}
      onOpenChange={(open) => props.filters.setMenuFor(open ? props.column : "")}
      trigger={
        <button
          type="button"
          data-column={props.column}
          data-first={props.column === "code" ? "" : undefined}
          class="flex w-full cursor-pointer items-center gap-1.5 p-4 text-start data-first:ps-8 font-medium text-inherit transition-colors hover:bg-surface-tertiary hover:text-on-surface-primary data-open:bg-surface-tertiary"
          data-open={props.filters.menuFor() === props.column ? "" : undefined}
        >
          <span class="min-w-0 flex-1 truncate">{props.label}</span>
          {sortIcon(props.filters.sortOf(props.column), 14)}
          <Show when={props.column === "region" && props.filters.regionFilter().size > 0}>
            <Filter size={14} aria-label={t("filtered")} class="text-brand" />
          </Show>
        </button>
      }
    >
      <MenuLabel>{t("Sort")}</MenuLabel>
      <SortRadios column={props.column} filters={props.filters} />
      <Show when={props.column === "region" && props.filters.regions().length > 0}>
        <RegionFilters filters={props.filters} total={props.total} />
      </Show>
    </Menu>
  </div>
);

const DownloadCell = (props: {
  readonly item: CatalogueRow;
  readonly onDownload: (entry: CatalogueEntry, from: DOMRect) => void;
}) => (
  <div role="cell" class="text-end">
    <Show
      when={props.item.refusal === ""}
      fallback={
        <Tooltip label={props.item.refusal}>
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
        loading={props.item.downloading}
        icon={<Download size={16} aria-hidden="true" />}
        onClick={(event) =>
          props.onDownload(
            props.item.entry,
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
);

const CatalogueRowView = (props: {
  readonly item: CatalogueRow;
  readonly index: number;
  readonly onDownload: (entry: CatalogueEntry, from: DOMRect) => void;
}) => (
  <div
    role="row"
    aria-rowindex={props.index + 2}
    data-entry={props.item.entry.id}
    class={cx(
      COLUMNS,
      "border-b border-surface-border py-4 transition-colors hover:bg-surface-secondary",
    )}
  >
    <div role="cell" class="whitespace-nowrap text-on-surface-secondary">
      {props.item.entry.code}
    </div>
    <div role="cell" class="min-w-0">
      <strong class="font-medium text-on-surface-primary">{props.item.name}</strong>
      <Show when={props.item.english !== ""}>
        <span class="ms-2 text-on-surface-tertiary">{props.item.english}</span>
      </Show>

      <div class="truncate font-mono text-smallest text-on-surface-tertiary">
        {props.item.entry.id}
      </div>
    </div>
    <div role="cell" class="text-on-surface-secondary">
      {props.item.entry.region ?? "—"}
    </div>
    <div role="cell" class="text-on-surface-secondary">
      {formatDate(props.item.updated) || "—"}
    </div>
    <DownloadCell item={props.item} onDownload={props.onDownload} />
  </div>
);

type Repos = "consolidated" | "writer" | "gateway";

const CatalogueToolbar = (props: {
  readonly gatewaysOffered: boolean;
  readonly filters: Filters;
  readonly repos: Repos;
  readonly onRepos: (repos: Repos) => void;
}) => (
  <div class="flex flex-wrap items-center gap-3">
    <PanelHeader title={t("Projects Available on WACS")} />
    <SegmentedControl
      size="md"
      label={m.landing_repos_label()}
      items={[
        { value: "consolidated", label: m.landing_repos_consolidated() },
        { value: "writer", label: m.landing_repos_writer() },
        ...(props.gatewaysOffered
          ? [{ value: "gateway" as const, label: t("Gateway languages") }]
          : []),
      ]}
      value={props.repos}
      onChange={props.onRepos}
    />
    <Input
      type="search"
      size="lg"
      wrapperClass="w-full min-w-64 sm:w-auto sm:flex-1"
      class="w-full"
      icon={<SearchIcon size={20} aria-hidden="true" />}
      aria-label={
        props.repos === "writer"
          ? t("Search Writer projects by language")
          : m.landing_search_or_link()
      }
      placeholder={
        props.repos === "writer"
          ? m.writer_languages_placeholder()
          : t("Search 'english' or 'axd'…")
      }
      value={props.filters.query()}
      onInput={(event) => props.filters.setQuery(event.currentTarget.value)}
    />
  </div>
);

const TableHead = (props: {
  readonly filters: Filters;
  readonly count: number;
  readonly total: number;
}) => (
  <div
    role="rowgroup"
    class="scrollbar-subtle shrink-0 overflow-hidden [scrollbar-gutter:stable] border-b border-surface-border"
  >
    <div
      role="row"
      aria-rowindex={1}
      data-catalogue={props.count}
      class={cx(COLUMNS, "text-on-surface-secondary")}
    >
      <For each={SORTABLE}>
        {([column, label]) => (
          <ColumnHeader
            column={column}
            label={label()}
            filters={props.filters}
            total={props.total}
          />
        )}
      </For>
      <div role="columnheader">
        <span class="sr-only">{t("Download")}</span>
      </div>
    </div>
  </div>
);

const TableBody = (props: {
  readonly filters: Filters;
  readonly entries: readonly CatalogueEntry[] | undefined;
  readonly virtualRows: readonly { key: string; item: CatalogueRow; estimate: number }[];
  readonly rowIndex: ReadonlyMap<string, number>;
  readonly onDownload: (entry: CatalogueEntry, from: DOMRect) => void;
}) => (
  <VirtualList<CatalogueRow>
    role="rowgroup"
    class="scrollbar-subtle min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
    sections={
      props.virtualRows.length > 0 && repositoryUrl(props.filters.query()) === undefined
        ? [{ key: "catalogue", rows: props.virtualRows }]
        : []
    }
    empty={
      <Show
        when={repositoryUrl(props.filters.query())}
        fallback={
          <Show
            when={props.entries}
            fallback={
              <p class="py-8 text-center text-body text-on-surface-tertiary">
                {t("Loading projects…")}
              </p>
            }
          >
            <NoMatch
              query={props.filters.query().trim()}
              regions={[...props.filters.regionFilter()]}
              onDropRegion={(name) => props.filters.toggleRegion(name, false)}
            />
          </Show>
        }
      >
        {(url) => <CloneOffer url={url()} />}
      </Show>
    }
    row={(item) => (
      <CatalogueRowView
        item={item()}
        index={props.rowIndex.get(item().entry.id) ?? 0}
        onDownload={props.onDownload}
      />
    )}
  />
);

const downloadReasonFor = (services: ReturnType<typeof useShell>["services"]) => {
  const transport = transportFor(services.settings, services.hostInfo.kind());
  const reachable = (url: string): boolean =>
    services.hostInfo.kind() !== "web" || through(transport, url) !== url;
  return (entry: CatalogueEntry): string => {
    if (entry.gitUrl === "") return t("Sample data — this row names no repository to download.");
    if (!reachable(entry.gitUrl))
      return t("This browser has no way to reach the server this project is on.");
    return "";
  };
};

export function WacsProjects(props: { readonly downloads: DownloadTracker }) {
  const shell = useShell();
  const { services } = shell;
  const catalogue = catalogueFor(services.settings);
  const gatewaysOffered = services.settings.get(shellKeys(services.settings).showGatewayProjects);

  const downloadReason = downloadReasonFor(services);

  const { entries, problem } = createCatalogueEntries(services, catalogue);
  const [busy, setBusy] = createSignal("", { name: "catalogueBusy" });
  const filters = createCatalogueFilters(entries);

  const { rows, rowIndex, virtualRows, codeColumn } = createCatalogueRows(
    entries,
    filters,
    busy,
    downloadReason,
  );

  const navigate = useNavigate();
  const [repos, setRepos] = createSignal<Repos>("consolidated", { name: "catalogueRepos" });

  const download = (entry: CatalogueEntry, from: DOMRect): void => {
    // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
    const { downloads } = props;
    downloadEntry(services, downloads, setBusy, entry, from);
  };

  return (
    <section class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <CatalogueToolbar
        gatewaysOffered={gatewaysOffered}
        filters={filters}
        repos={repos()}
        onRepos={(next) => {
          setRepos(next);
          if (next !== "writer") filters.setKind(next === "gateway" ? "gateway" : "translation");
        }}
      />

      <Show when={repos() === "writer"}>
        <WriterTable
          query={filters.query()}
          class="flex-1"
          onPick={(language) => void navigate({ to: "/migrate", search: { language } })}
        />
      </Show>

      <div
        class={cx("flex min-h-0 min-w-0 flex-1 flex-col gap-3", repos() === "writer" && "hidden")}
      >
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
          <TableHead filters={filters} count={rows().length} total={(entries() ?? []).length} />
          <TableBody
            filters={filters}
            entries={entries()}
            virtualRows={virtualRows()}
            rowIndex={rowIndex()}
            onDownload={download}
          />
        </Card>
      </div>
    </section>
  );
}
