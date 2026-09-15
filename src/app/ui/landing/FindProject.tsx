/**
 * Find Project — the remote catalogue browser, built to the mockup in
 * planning/03-ui/design-direction.md: a filter card on the left, a large search
 * field and a sortable four-column table on the right.
 *
 * The rows come from `src/app/catalogue.ts`, which is either the Language API
 * or twelve sample rows depending on whether this build was given a URL. The
 * table says which, because a screen full of plausible sample data that claims
 * to be live is worse than an empty one.
 *
 * Two of the mockup's four columns — Region and Date — are not in the live
 * payload. They are drawn anyway and print an em dash: the columns are the
 * design's, the blanks are the API's, and inventing values to fill them would
 * hide exactly the gap someone needs to see.
 *
 * Download clones rather than fetching an archive. Sefer can read a zip a
 * person hands it (see the import hub), but what this payload carries is
 * `repo_url` — a git URL — and `cloneRepository` is what takes one. A row with
 * no URL, or a build with no transfer configured, gets a disabled link with
 * the reason in a tooltip.
 */

import { Link } from "@tanstack/solid-router";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import Download from "lucide-solid/icons/download";
import Globe from "lucide-solid/icons/globe";
import Plus from "lucide-solid/icons/plus";
import SearchIcon from "lucide-solid/icons/search";
import { For, Show, createMemo, createSignal } from "solid-js";

import { cloneRepository } from "../../../core/remote/clone";
import { catalogueFor, type CatalogueEntry, type ProjectType } from "../../catalogue";
import { describe } from "../../describe";
import { env, giteaHostFor } from "../../env";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  Badge,
  Button,
  Card,
  Input,
  SegmentedControl,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  toasts,
  type SortDirection,
} from "../primitives";
import { formatDate } from "./summaries";

type NameStyle = "natural" | "anglicized";

type Column = "code" | "language" | "region" | "date";

const ALL_REGIONS = "*";

const lastSegment = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

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
  /** The language as this reader asked to see it — natural or anglicized. */
  readonly name: string;
  /** Empty when Download is offered; otherwise why it is not. */
  readonly refusal: string;
  /** True while this row's clone is running. A value, never a signal read. */
  readonly downloading: boolean;
}

export function FindProject(props: { readonly onDownloaded: () => void }) {
  const shell = useShell();
  const { services } = shell;
  // One catalogue per mount. It is a pure value over `env`, so there is nothing
  // to keep reactive and nothing to dispose.
  const catalogue = catalogueFor();

  const giteaHost = giteaHostFor(services.hostInfo.kind());
  const transfersConfigured =
    giteaHost !== null && (services.hostInfo.kind() !== "web" || env.gitCorsProxyUrl !== null);

  const [entries, setEntries] = createSignal<readonly CatalogueEntry[] | undefined>(undefined, {
    name: "catalogueEntries",
  });
  const [problem, setProblem] = createSignal("", { name: "catalogueProblem" });
  const [query, setQuery] = createSignal("", { name: "catalogueQuery" });
  const [nameStyle, setNameStyle] = createSignal<NameStyle>("natural", { name: "nameStyle" });
  const [type, setType] = createSignal<ProjectType>("translation", { name: "projectType" });
  const [region, setRegion] = createSignal(ALL_REGIONS, { name: "catalogueRegion" });
  const [column, setColumn] = createSignal<Column>("language", { name: "catalogueSort" });
  const [direction, setDirection] = createSignal<SortDirection>("asc", {
    name: "catalogueDirection",
  });
  const [busy, setBusy] = createSignal("", { name: "catalogueBusy" });

  void catalogue
    .entries()
    .then(setEntries)
    .catch((cause: unknown) => {
      setEntries([]);
      setProblem(describe(cause));
    });

  const nameOf = (entry: CatalogueEntry): string =>
    nameStyle() === "natural" ? entry.naturalName : entry.anglicizedName;

  /** Region options, each with the count of rows it would leave. */
  const regions = createMemo(
    () => {
      const counted = new Map<string, number>();
      for (const entry of entries() ?? []) {
        if (entry.region === undefined) continue;
        counted.set(entry.region, (counted.get(entry.region) ?? 0) + 1);
      }
      return [...counted.entries()].sort(([left], [right]) => left.localeCompare(right));
    },
    { name: "catalogueRegions" },
  );

  const filtered = createMemo(
    () => {
      const needle = query().trim().toLowerCase();
      return (entries() ?? []).filter((entry) => {
        if (entry.type !== type()) return false;
        if (region() !== ALL_REGIONS && entry.region !== region()) return false;
        if (needle === "") return true;
        return (
          entry.code.toLowerCase().includes(needle) ||
          entry.naturalName.toLowerCase().includes(needle) ||
          entry.anglicizedName.toLowerCase().includes(needle) ||
          entry.owner.toLowerCase().includes(needle) ||
          entry.repo.toLowerCase().includes(needle)
        );
      });
    },
    { name: "catalogueFiltered" },
  );

  const sorted = createMemo(
    () => {
      const key = column();
      const sign = direction() === "desc" ? -1 : 1;
      const value = (entry: CatalogueEntry): string => {
        switch (key) {
          case "code":
            return entry.code;
          case "language":
            return nameOf(entry);
          case "region":
            return entry.region ?? "";
          case "date":
            return entry.updated ?? "";
        }
      };
      return [...filtered()].sort((left, right) => sign * value(left).localeCompare(value(right)));
    },
    { name: "catalogueSorted" },
  );

  const downloadReason = (entry: CatalogueEntry): string => {
    if (entry.cloneUrl === "") return t("Sample data — this row names no repository to download.");
    if (!transfersConfigured)
      return t("Transfers are not configured for this build: set VITE_SEFER_GIT_CORS_PROXY_URL.");
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
        name: nameOf(entry),
        refusal: downloadReason(entry),
        downloading: entry.id === running,
      }));
    },
    { name: "catalogueRows" },
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
      .run(cloneRepository(entry.cloneUrl, into))
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
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
      <Card class="flex w-full shrink-0 flex-col gap-4 lg:w-72" data-find-filters>
        <div class="space-y-1">
          <h2 class="text-h4 font-bold text-on-surface-primary">{t("Find Project")}</h2>
          <Link
            to="/projects"
            search={true}
            class="inline-flex items-center gap-1 text-smallest text-on-surface-tertiary no-underline hover:text-on-surface-secondary"
          >
            <ArrowLeft size={13} aria-hidden="true" />
            {t("Go back")}
          </Link>
        </div>

        <div class="space-y-1.5">
          <SegmentedControl
            label={t("Language name")}
            size="sm"
            value={nameStyle()}
            onChange={setNameStyle}
            items={[
              { value: "natural", label: t("Natural") },
              { value: "anglicized", label: t("Anglicized") },
            ]}
          />
          <p class="text-smallest text-on-surface-tertiary">
            {t("Show each language written as its own speakers write it, or in English.")}
          </p>
        </div>

        <div class="space-y-1.5">
          <SegmentedControl
            label={t("Project type")}
            size="sm"
            value={type()}
            onChange={setType}
            items={[
              { value: "translation", label: t("Translation") },
              { value: "gateway", label: t("Gateway") },
            ]}
          />
          <p class="text-smallest text-on-surface-tertiary">
            {t("Gateway projects are the curated wa-catalog set others translate from.")}
          </p>
        </div>

        <label class="space-y-1.5">
          <span class="flex items-center gap-1 text-smallest font-medium text-on-surface-secondary">
            <Globe size={13} aria-hidden="true" />
            {t("Region")}
          </span>
          <Select
            size="sm"
            wrapperClass="w-full"
            class="w-full"
            value={region()}
            onChange={(event) => setRegion(event.currentTarget.value)}
          >
            <option value={ALL_REGIONS}>
              {t("All regions ({count})", { count: (entries() ?? []).length })}
            </option>
            <For each={regions()}>
              {([name, count]) => (
                <option value={name}>{t("{name} ({count})", { name, count })}</option>
              )}
            </For>
          </Select>
        </label>

        <Link to="/start/create" search={true} class="no-underline">
          <Button variant="secondary" class="w-full" icon={<Plus size={15} aria-hidden="true" />}>
            {t("Create new project")}
          </Button>
        </Link>
      </Card>

      <div class="min-w-0 flex-1 space-y-3">
        <Input
          type="search"
          size="md"
          class="h-11 text-body"
          wrapperClass="w-full"
          icon={<SearchIcon size={17} aria-hidden="true" />}
          aria-label={t("Search projects")}
          placeholder={t("Search 'english' or 'axd'…")}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />

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
          <Table data-catalogue={rows().length}>
            <TableHead>
              <TableRow>
                <TableHeader sort={sortOf("code")} onSort={() => toggleSort("code")}>
                  {t("Code")}
                </TableHeader>
                <TableHeader sort={sortOf("language")} onSort={() => toggleSort("language")}>
                  {t("Language")}
                </TableHeader>
                <TableHeader sort={sortOf("region")} onSort={() => toggleSort("region")}>
                  {t("Region")}
                </TableHeader>
                <TableHeader sort={sortOf("date")} onSort={() => toggleSort("date")}>
                  {t("Date")}
                </TableHeader>
                <TableHeader>
                  <span class="sr-only">{t("Download")}</span>
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {/* Keyed by the row's own id, so a row is UPDATED rather than
                  torn down and rebuilt when the memo produces a fresh object —
                  which it does on every name-style flip. The callback takes an
                  accessor, and `<For>` gives each row its own: that is the
                  per-key projection the HUGE_FAN_OUT diagnostic asks for, done
                  by the list itself rather than by a store beside it. */}
              <For
                each={rows()}
                keyed={(row) => row.entry.id}
                fallback={
                  <TableRow>
                    <TableCell colspan={5} class="py-8 text-center text-on-surface-tertiary">
                      <Show when={entries()} fallback={t("Loading projects…")}>
                        {t("No results. Try a different search or filter.")}
                      </Show>
                    </TableCell>
                  </TableRow>
                }
              >
                {(row) => {
                  const entry = () => row().entry;
                  return (
                    <TableRow data-entry={entry().id}>
                      <TableCell class="font-mono text-smallest text-on-surface-tertiary">
                        {entry().code}
                      </TableCell>
                      <TableCell>
                        <strong class="font-medium text-on-surface-primary">{row().name}</strong>
                        <span class="ms-2 text-smallest text-on-surface-tertiary">
                          {entry().owner}/{entry().repo}
                        </span>
                      </TableCell>
                      <TableCell class="text-on-surface-secondary">
                        {entry().region ?? "—"}
                      </TableCell>
                      <TableCell class="text-on-surface-secondary">
                        {formatDate(entry().updated) || "—"}
                      </TableCell>
                      <TableCell class="text-end">
                        <Show
                          when={row().refusal === ""}
                          fallback={
                            <Tooltip label={row().refusal}>
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
                            loading={row().downloading}
                            icon={<Download size={13} aria-hidden="true" />}
                            onClick={() => download(entry())}
                          >
                            {t("Download")}
                          </Button>
                        </Show>
                      </TableCell>
                    </TableRow>
                  );
                }}
              </For>
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
