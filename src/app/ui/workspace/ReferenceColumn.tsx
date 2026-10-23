/**
 * The reference column: the texts this project is being translated FROM and
 * ALONGSIDE, at the passage the editor is showing — and the one place a
 * reader chooses one.
 *
 * It shows ONE READ-ONLY EDITOR (`ReferencePane`) at a time over the book
 * the reader has open, painted by the same projection as the editor beside
 * it, straight on the page (`bare`): a split stack of panes was noise in a
 * workspace meant to stay quiet (Will, 2026-10-08). Not a card holding a
 * regex-sliced passage: that could not show markup, could not be scrolled,
 * and would disagree with the editor about what a verse looks like. A pane is
 * the same `decoField` over the same `DocStructure`, so the two sides cannot
 * drift. The whole column is shut from the editor's crumb strip
 * (`shell.referenceOpen`) and nowhere else: a second button here that folded
 * it to cards was one close too many (Will, 2026-10-22).
 *
 * Which text is on show is the "Reference language" menu above the pane:
 * first the texts on this device — what the project has picked or declares,
 * then the Library's own copies, scripture before helps (the PO's two words:
 * source texts, reference material) — then, folded away, Reference material:
 * one list at a time under a segmented toggle with a search box pinned above
 * it (Will, 2026-10-22). Translation Notes are the ones the Language API
 * lists, one per language (Will, 2026-10-15); Bibles are WA-Catalog's ULBs in
 * the official gateway languages and nothing else (the PO, 2026-10-22: not
 * the dozen other English ULBs, never the UDB); Your projects are the
 * reader's other projects (a neighbouring heart language reads well beside a
 * translation; Will, 2026-10-08). A download lands in the Library's folder
 * through `arrival.ts`, never the projects folder, and is then picked. This
 * menu is the one place notes and source texts are offered: they are not on
 * the projects page.
 *
 * With nothing picked, the pane shows what the project DECLARES
 * (`Library.resolve` falls back to it; Will, 2026-10-06), so there is no
 * "default given once" to remember: choosing another text is the only way to
 * replace it. A declared text that is not on this device is offered for
 * download, never fetched behind the reader's back. A project that declares
 * nothing is offered English first.
 *
 * The pane is remounted, not reconciled, for a different text or book: it
 * is an editor over one book's text, and a new text is a new document.
 */

import { Effect, Option, Result } from "effect";
import BookMarked from "lucide-solid/icons/book-marked";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import Download from "lucide-solid/icons/download";
import Search from "lucide-solid/icons/search";
import Trash from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";

import { Observability } from "#core/observability";
import { remoteVerdict } from "#core/remote/remote";
import { answers, type Resource, type Role } from "#core/resources/library";
import {
  highestVersions,
  normaliseRepoUrl,
  type RelatedResource,
} from "#core/resources/relationships";

import { announceSourceTexts, libraryRevision, sourceTextCopy } from "../../arrival";
import { listSourceTexts, listTranslationNotes, type ListedText } from "../../catalogue";
import { describe, remoteReasonOf } from "../../describe";
import { t } from "../../i18n";
import { downloadHelp, helpDownloads, removeHelp } from "../../kinds/download";
import { KIND_ROLES, roleFor } from "../../kinds/table";
import { uiLocale } from "../../locale";
import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { ResourcePane } from "../kinds/registry";
import { listProjects, type ProjectSummary } from "../landing/summaries";
import {
  Button,
  EmptyState,
  Input,
  Menu,
  MenuItem,
  Popover,
  SegmentedControl,
  cx,
} from "../primitives";

const ROLES: readonly Role[] = KIND_ROLES;

interface Entry {
  readonly resource: Resource;
  readonly role: Role;
  readonly declared: boolean;
}

const isBible = (resource: Resource): boolean => roleFor(resource) === "source";

const languageName = (code: string | undefined): string | undefined => {
  if (code === undefined || code === "") return undefined;
  try {
    return new Intl.DisplayNames([uiLocale()], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
};

type Listing =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly rows: readonly ListedText[] }
  | { readonly state: "failed"; readonly offline: boolean };

type Shelf = "notes" | "bibles" | "projects";

/** Whether `query` (already lowercased and trimmed) is in any of `fields`; an empty query matches everything. */
const matches = (query: string, ...fields: readonly (string | undefined)[]): boolean =>
  query === "" || fields.some((field) => field?.toLowerCase().includes(query) === true);

type Shown = { readonly entry: Entry; readonly book: string } | undefined;

interface PickerModel {
  readonly busy: () => boolean;
  readonly fetching: () => string;
  readonly nameOf: (resource: Resource | undefined) => string;
  readonly shown: () => Shown;
  readonly installed: () => readonly Resource[];
  readonly show: (resource: Resource) => void;
  readonly offer: () => void;
  readonly otherProjects: () => readonly ProjectSummary[];
  readonly showProject: (row: ProjectSummary) => void;
  readonly notes: () => Listing | undefined;
  readonly helps: () => readonly ListedText[];
  readonly heldHelps: () => readonly Resource[];
  readonly removeNotes: (resource: Resource) => void;
  readonly fetchHelp: (help: ListedText) => void;
  readonly bibles: () => Listing | undefined;
  readonly offeredBibles: () => readonly ListedText[];
  readonly fetchBible: (text: ListedText) => void;
  readonly showMaterial: () => boolean;
  readonly setShowMaterial: (open: boolean) => void;
  readonly shelf: () => Shelf;
  readonly setShelf: (shelf: Shelf) => void;
  readonly query: () => string;
  readonly setQuery: (query: string) => void;
}

const ROW = "px-6";

function GroupToggle(props: {
  readonly testId: string;
  readonly label: string;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabindex={-1}
      data-testid={props.testId}
      aria-expanded={props.open ? "true" : "false"}
      class={`${ROW} flex h-12 w-full cursor-pointer items-center gap-3 text-start text-small font-semibold text-on-surface-primary outline-none hover:bg-surface-secondary focus-visible:bg-surface-secondary`}
      onClick={() => props.onToggle()}
    >
      <span class="min-w-0 flex-1">{props.label}</span>
      <Show when={props.open} fallback={<ChevronDown aria-hidden="true" class="size-5" />}>
        <ChevronUp aria-hidden="true" class="size-5" />
      </Show>
    </button>
  );
}

function RowText(props: { readonly name: string; readonly detail?: string }) {
  return (
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="truncate">{props.name}</span>
      <Show when={props.detail !== undefined && props.detail !== props.name}>
        <span class="truncate text-smallest text-on-surface-tertiary">{props.detail}</span>
      </Show>
    </span>
  );
}

function HeldNotesRow(props: { readonly resource: Resource; readonly model: PickerModel }) {
  return (
    <div
      class={`${ROW} flex min-h-12 items-center gap-3 text-small text-on-surface-primary`}
      data-testid="reference-held-notes"
      data-language={props.resource.language}
    >
      <RowText
        name={`${languageName(props.resource.language) ?? props.resource.title} (${props.resource.language ?? ""})`}
        detail={t("On this device")}
      />
      <button
        type="button"
        role="menuitem"
        tabindex={-1}
        data-testid="reference-remove-notes"
        title={t("Remove {title} from this device", {
          title: props.model.nameOf(props.resource),
        })}
        class="flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-small text-on-surface-secondary outline-none hover:bg-surface-secondary focus-visible:bg-surface-secondary"
        onClick={() => props.model.removeNotes(props.resource)}
      >
        <Trash aria-hidden="true" class="size-4" />
        {t("Remove")}
      </button>
    </div>
  );
}

/** One downloadable text: its language, the language's own name under it, and a download mark. */
function ListedRow(props: {
  readonly text: ListedText;
  readonly name: string;
  readonly testId: string;
  readonly downloading: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <MenuItem
      class={ROW}
      data-testid={props.testId}
      title={m.reference_download_title({ title: props.name })}
      onSelect={() => props.onSelect()}
    >
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate">{props.name}</span>
        <Show
          when={
            props.text.nationalName !== "" && props.text.nationalName !== props.text.languageName
          }
        >
          <span
            dir={props.text.direction}
            class="truncate text-start text-smallest text-on-surface-tertiary"
          >
            {props.text.nationalName}
          </span>
        </Show>
      </span>
      <Show
        when={props.downloading}
        fallback={<Download aria-hidden="true" class="size-5 shrink-0" />}
      >
        <span
          role="status"
          aria-label={t("Downloading")}
          class="size-5 shrink-0 animate-spin rounded-full border-2 border-on-surface-tertiary border-t-transparent"
        />
      </Show>
    </MenuItem>
  );
}

function ListingStatus(props: { readonly listing: Listing | undefined; readonly empty: boolean }) {
  const note = (): string | undefined => {
    const listing = props.listing;
    if (listing === undefined || listing.state === "loading") return t("Loading the list…");
    if (listing.state === "failed")
      return listing.offline
        ? t("You are offline. Open this menu again to retry.")
        : t("Could not read the list. Open this menu again to retry.");
    return props.empty ? t("Nothing matches.") : undefined;
  };
  return (
    <Show when={note()}>
      {(text) => (
        <p role="status" class={`${ROW} py-3 text-small text-on-surface-tertiary`}>
          {text()}
        </p>
      )}
    </Show>
  );
}

const textName = (text: ListedText): string =>
  `${text.languageName || text.language} (${text.language})`;

function NotesShelf(props: { readonly model: PickerModel }) {
  const query = (): string => props.model.query().trim().toLowerCase();
  const held = () =>
    props.model
      .heldHelps()
      .filter((resource) =>
        matches(query(), languageName(resource.language), resource.language, resource.title),
      );
  const offered = () =>
    props.model
      .helps()
      .filter((help) => matches(query(), help.languageName, help.nationalName, help.language));
  return (
    <div role="group" aria-label={t("Translation Notes")} data-testid="reference-notes">
      <For each={held()}>
        {(resource) => <HeldNotesRow resource={resource} model={props.model} />}
      </For>
      <For each={offered()}>
        {(help) => (
          <ListedRow
            text={help}
            name={textName(help)}
            testId={`pick-help-${help.repository}`}
            downloading={helpDownloads().has(help.repository)}
            onSelect={() => props.model.fetchHelp(help)}
          />
        )}
      </For>
      <ListingStatus
        listing={props.model.notes()}
        empty={held().length === 0 && offered().length === 0}
      />
    </div>
  );
}

function BiblesShelf(props: { readonly model: PickerModel }) {
  const offered = () => {
    const query = props.model.query().trim().toLowerCase();
    return props.model
      .offeredBibles()
      .filter((text) =>
        matches(query, text.languageName, text.nationalName, text.language, text.title),
      );
  };
  return (
    <div role="group" aria-label={t("Bibles")} data-testid="reference-bibles">
      <For each={offered()}>
        {(text) => (
          <ListedRow
            text={text}
            name={text.title === "ULB" ? textName(text) : `${textName(text)} · ${text.title}`}
            testId={`pick-${text.repository}`}
            downloading={false}
            onSelect={() => props.model.fetchBible(text)}
          />
        )}
      </For>
      <ListingStatus listing={props.model.bibles()} empty={offered().length === 0} />
    </div>
  );
}

function ProjectsShelf(props: { readonly model: PickerModel }) {
  const offered = () => {
    const query = props.model.query().trim().toLowerCase();
    return props.model
      .otherProjects()
      .filter((row) => matches(query, row.name, row.language, languageName(row.language)));
  };
  return (
    <div role="group" aria-label={t("Your projects")} data-testid="reference-other-projects">
      <For each={offered()}>
        {(row) => (
          <MenuItem
            class={ROW}
            data-testid={`pick-${row.folder}`}
            onSelect={() => props.model.showProject(row)}
          >
            <RowText name={row.name} detail={languageName(row.language) ?? row.language} />
          </MenuItem>
        )}
      </For>
      <Show when={offered().length === 0}>
        <p role="status" class={`${ROW} py-3 text-small text-on-surface-tertiary`}>
          {props.model.otherProjects().length === 0
            ? t("No other projects on this device.")
            : t("Nothing matches.")}
        </p>
      </Show>
    </div>
  );
}

/** Keys the menu would take to move between its rows, kept for the toggle and the search box. */
const KEPT_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

function ReferenceMaterialGroup(props: { readonly model: PickerModel }) {
  return (
    <>
      <GroupToggle
        testId="reference-material"
        label={m.reference_material()}
        open={props.model.showMaterial()}
        onToggle={() => props.model.setShowMaterial(!props.model.showMaterial())}
      />
      <Show when={props.model.showMaterial()}>
        <div
          class="sticky -top-1 z-10 flex flex-col gap-2 border-b border-surface-border bg-surface-primary px-3 pt-1 pb-3"
          onKeyDown={(event) => {
            if (KEPT_KEYS.has(event.key)) event.stopPropagation();
          }}
        >
          <SegmentedControl
            label={t("Kind of reference material")}
            class="w-full"
            items={[
              { value: "notes", label: m.reference_shelf_notes() },
              { value: "bibles", label: m.reference_shelf_bibles() },
              { value: "projects", label: m.reference_shelf_projects() },
            ]}
            value={props.model.shelf()}
            onChange={(shelf) => props.model.setShelf(shelf)}
          />
          <Input
            type="search"
            size="sm"
            wrapperClass="w-full"
            class="w-full"
            icon={<Search class="size-4" />}
            data-testid="reference-search"
            aria-label={t("Search by language")}
            placeholder={m.reference_search_placeholder()}
            value={props.model.query()}
            onInput={(event) => props.model.setQuery(event.currentTarget.value)}
          />
        </div>
        <Switch>
          <Match when={props.model.shelf() === "notes"}>
            <NotesShelf model={props.model} />
          </Match>
          <Match when={props.model.shelf() === "bibles"}>
            <BiblesShelf model={props.model} />
          </Match>
          <Match when={props.model.shelf() === "projects"}>
            <ProjectsShelf model={props.model} />
          </Match>
        </Switch>
      </Show>
    </>
  );
}

function LanguagePicker(props: { readonly model: PickerModel }) {
  return (
    <Menu
      label={m.reference_language()}
      onOpenChange={(open) => {
        if (!open) return;
        props.model.setShowMaterial(false);
        props.model.setQuery("");
        props.model.setShelf(props.model.installed().some(isBible) ? "notes" : "bibles");
        props.model.offer();
      }}
      side="bottom"
      align="start"
      class="w-96"
      fitViewport
      trigger={
        <button
          type="button"
          data-testid="reference-language"
          disabled={props.model.busy()}
          class="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-2xl bg-surface-primary p-3 text-start transition-colors hover:bg-surface-secondary disabled:cursor-wait"
        >
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-small text-on-surface-secondary">{m.reference_language()}</span>
            <span class="truncate text-small font-semibold text-on-surface-primary">
              {props.model.fetching() === ""
                ? props.model.nameOf(props.model.shown()?.entry.resource) || m.reference_none_yet()
                : t("Getting {language}…", { language: props.model.fetching() })}
            </span>
          </span>
          <ChevronDown aria-hidden="true" class="size-5 shrink-0 text-on-surface-primary" />
        </button>
      }
    >
      <div class="scrollbar-padded max-h-[min(60vh,25.5rem)] overflow-y-auto py-1">
        <For each={props.model.installed()}>
          {(resource) => (
            <MenuItem class={ROW} onSelect={() => props.model.show(resource)}>
              <RowText name={props.model.nameOf(resource)} detail={resource.title} />
              <Show when={props.model.shown()?.entry.resource.id === resource.id}>
                <Check aria-label={t("Showing")} class="size-5 shrink-0 text-brand" />
              </Show>
            </MenuItem>
          )}
        </For>
        <ReferenceMaterialGroup model={props.model} />
      </div>
    </Menu>
  );
}

const readLibraryState = (
  services: ReturnType<typeof useShell>["services"],
  project: string,
  declared: readonly RelatedResource[],
) =>
  Effect.gen(function* () {
    const picked = new Set(
      (yield* services.library.picked(project)).map((each) => each.resource.id),
    );
    const found: Entry[] = [];
    for (const role of ROLES)
      for (const resource of yield* services.library.resolve(project, role))
        found.push({ resource, role, declared: !picked.has(resource.id) });
    const held = yield* services.library.resources();
    const absent = declared.filter((ref) => !held.some((resource) => answers(resource, ref)));
    const library = held.filter((resource) => resource.root.startsWith(`${services.libraryRoot}/`));
    return { found, absent, library };
  });

export interface ReferenceColumnProps {
  readonly onBound?: (count: number) => void;
  /**
   * `gateway`: the panels layout's reference panel — one split dropdown,
   * language then text, over the text on show, no column padding. `column`
   * otherwise.
   */
  readonly variant?: "column" | "gateway";
}

export function ReferenceColumn(props: ReferenceColumnProps) {
  const shell = useShell();
  const { services } = shell;
  const [entries, setEntries] = createSignal<readonly Entry[]>([], { name: "referenceEntries" });
  const [loading, setLoading] = createSignal(true, { name: "referenceLoading" });
  const [copies, setCopies] = createSignal<readonly Resource[]>([], { name: "referenceCopies" });
  const [projects, setProjects] = createSignal<readonly ProjectSummary[] | undefined>(undefined, {
    name: "referenceProjects",
  });
  const [bibles, setBibles] = createSignal<Listing | undefined>(undefined, {
    name: "referenceBibles",
  });
  const [notes, setNotes] = createSignal<Listing | undefined>(undefined, {
    name: "referenceNotes",
  });
  const [missing, setMissing] = createSignal<readonly RelatedResource[]>([], {
    name: "referenceMissing",
  });
  const [busy, setBusy] = createSignal(false, { name: "referenceBusy" });
  const [fetching, setFetching] = createSignal("", { name: "referenceFetching" });
  const [bound, setBound] = createSignal(0, { name: "referenceBound" });

  const report = (count: number): void => props.onBound?.(count);

  const declared = (): readonly RelatedResource[] =>
    Option.match(shell.project()?.metadata() ?? Option.none(), {
      onNone: (): readonly RelatedResource[] => [],
      onSome: (metadata) => highestVersions(metadata.related),
    });

  createEffect(
    () => ({
      project: shell.project()?.root,
      book: shell.focused()?.id,
      tick: bound(),
      library: libraryRevision(),
      declared: declared(),
    }),
    ({ project, declared }) => {
      if (project === undefined) {
        setEntries([]);
        setMissing([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      void services
        .run(readLibraryState(services, project, declared))
        // oxlint-disable-next-line solid/reactivity
        .then(({ found, absent, library }) => {
          setEntries(found);
          setMissing(absent);
          setCopies(library);
          setLoading(false);
          report(found.length);
        });
    },
  );

  const numberAt = (ordinal: number | null | undefined): number | undefined => {
    const book = shell.focused();
    if (book === undefined || ordinal === undefined || ordinal === null) return undefined;
    const label = book.structure().chapters[ordinal]?.label ?? "";
    const numbered = Number.parseInt(label, 10);
    return Number.isNaN(numbered) ? undefined : numbered;
  };

  const clip = (): number | null => numberAt(shell.chapter()) ?? null;

  /** Reads a Language API list once, and again only after it failed. */
  const list = (
    read: () => Listing | undefined,
    write: (listing: Listing) => void,
    fetchList: () => Promise<readonly ListedText[]>,
  ): void => {
    const held = read();
    if (held !== undefined && held.state !== "failed") return;
    write({ state: "loading" });
    void fetchList()
      .then((rows) => write({ state: "ready", rows }))
      .catch((cause: unknown) =>
        write({
          state: "failed",
          offline: cause instanceof TypeError || globalThis.navigator?.onLine === false,
        }),
      );
  };

  const readProjects = () =>
    services.run(
      listProjects(
        services.projectsRoot,
        services.fixtureProject,
        services.settings.get(shellKeys(services.settings).recentProjects),
      ),
    );
  // Read once up front as well as on opening a menu: a project's metadata is
  // what names a language the browser cannot (`nxi`), on the closed button too.
  void readProjects().then(setProjects);

  const offer = (): void => {
    if (projects() === undefined) void readProjects().then(setProjects);
    list(notes, setNotes, listTranslationNotes);
    list(bibles, setBibles, listSourceTexts);
  };

  const installed = (): readonly Resource[] => {
    const seen = new Map<string, Resource>();
    for (const entry of entries()) seen.set(entry.resource.id, entry.resource);
    for (const resource of [
      ...copies().filter(isBible),
      ...copies().filter((candidate) => !isBible(candidate)),
    ])
      if (!seen.has(resource.id)) seen.set(resource.id, resource);
    return [...seen.values()];
  };

  const otherProjects = (): readonly ProjectSummary[] => {
    const open = shell.project()?.root;
    return (projects() ?? []).filter(
      (row) => row.root !== open && !installed().some((resource) => resource.root === row.root),
    );
  };

  /** The gateway Bibles with no copy here; English first for a project that declares no source text. */
  const offeredBibles = (): readonly ListedText[] => {
    const read = bibles();
    if (read?.state !== "ready") return [];
    const held = new Set(
      copies().flatMap((resource) =>
        resource.upstream === undefined ? [] : [normaliseRepoUrl(resource.upstream.url)],
      ),
    );
    const offered = read.rows.filter((text) => !held.has(normaliseRepoUrl(text.url)));
    if (declared().length > 0) return offered;
    return [
      ...offered.filter((text) => text.language === "en"),
      ...offered.filter((text) => text.language !== "en"),
    ];
  };

  /**
   * A text's LANGUAGE, as the split dropdown groups by it: one row per
   * language, however many texts it has (ULB, UDB, Notes…). Lower-cased tag;
   * "" for every text that names no language, so they share one row.
   */
  const languageOf = (resource: Resource): string => (resource.language ?? "").toLowerCase();
  const projectLanguageOf = (row: ProjectSummary): string => row.languageTag.toLowerCase();
  /**
   * Names for tags the browser cannot name (`nxi`), from what names them
   * here: the reader's projects' and the library texts' own metadata, and
   * the catalogue's rows.
   */
  const knownNames = createMemo(
    (): ReadonlyMap<string, string> => {
      const names = new Map<string, string>();
      const note = (tag: string | undefined, name: string | undefined): void => {
        const key = tag?.toLowerCase() ?? "";
        if (key !== "" && name !== undefined && name !== "" && name.toLowerCase() !== key)
          names.set(key, name);
      };
      for (const row of projects() ?? []) note(row.languageTag, row.language);
      for (const resource of installed()) note(resource.language, resource.languageName);
      for (const text of [...offeredBibles(), ...helps()]) note(text.language, text.languageName);
      return names;
    },
    { name: "referenceLanguageNames" },
  );
  /** A language's name: the browser's when it knows the tag, else the one found here, else the tag. */
  const nameOfLanguage = (key: string): string => {
    const browser = languageName(key);
    if (browser !== undefined && browser.toLowerCase() !== key.toLowerCase()) return browser;
    return knownNames().get(key.toLowerCase()) ?? browser ?? key;
  };
  /** What the left half calls a language: its name and tag, or that it is unknown. */
  const languageLabel = (key: string): string =>
    key === "" ? m.reference_no_language() : `${nameOfLanguage(key)} (${key})`;
  /** The text last on show in each language, so returning to it returns to that text. */
  const [lastIn, setLastIn] = createSignal<Readonly<Record<string, string>>>(
    {},
    { name: "referenceLastIn" },
  );
  /** The bound texts grouped by language, in the order they are bound. */
  const languageTabs = createMemo(
    (): readonly { readonly key: string; readonly entries: readonly Entry[] }[] => {
      const groups = new Map<string, Entry[]>();
      for (const entry of entries()) {
        const key = languageOf(entry.resource);
        const held = groups.get(key);
        if (held === undefined) groups.set(key, [entry]);
        else held.push(entry);
      }
      return [...groups].map(([key, grouped]) => ({ key, entries: grouped }));
    },
    { name: "referenceLanguageTabs" },
  );
  /** The text a language opens on: the last one shown in it, else its scripture. */
  const openingOf = (group: readonly Entry[], key: string): Entry | undefined =>
    group.find((entry) => entry.resource.id === lastIn()[key]) ??
    group.find((entry) => isBible(entry.resource)) ??
    group[0];
  const [chosen, setChosen] = createSignal<string | undefined>(undefined, {
    name: "referenceShown",
  });

  const show = (resource: Resource): void => {
    const project = shell.project();
    if (project === undefined) return;
    setChosen(resource.id);
    setLastIn((held) => ({ ...held, [languageOf(resource)]: resource.id }));
    if (entries().some((entry) => entry.resource.id === resource.id)) return;
    void services
      .run(services.library.pick(project.root, roleFor(resource), resource.id))
      .then(() => setBound((held) => held + 1));
  };

  const showProject = (row: ProjectSummary): void => {
    setBusy(true);
    void services
      .run(Effect.result(services.library.add(row.root)))
      // oxlint-disable-next-line solid/reactivity
      .then((outcome) => {
        setBusy(false);
        if (Result.isFailure(outcome)) {
          shell.report(
            t("could not add {name}: {reason}", {
              name: row.name,
              reason: outcome.failure.description,
            }),
          );
          return;
        }
        show(outcome.success);
      });
  };

  /** Downloads in flight from the split dropdown's language list, by repository. */
  const [pulling, setPulling] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "referencePulling",
  });
  const pull = (key: string, on: boolean): void => {
    setPulling((held) => {
      const next = new Set(held);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  /** From the split dropdown's language list (`keep`), a download stays there rather than going on show. */
  const fetchBible = (text: ListedText, keep = false): void => {
    const name = text.languageName || text.language;
    const operation = services.composition.observability.operation("import.remote", {
      "import.source": "reference",
      "import.host": services.hostInfo.kind(),
      "catalogue.type": "gateway",
    });
    if (keep) pull(text.repository, true);
    else {
      setBusy(true);
      setFetching(name);
    }
    void services
      .run(
        Effect.provideService(
          sourceTextCopy(services, text.url, text.repository),
          Observability,
          operation,
        ),
      )
      // oxlint-disable-next-line solid/reactivity
      .then((resource) => {
        operation.end("passed", { "import.phase": "complete" });
        if (!keep) show(resource);
      })
      .catch((cause: unknown) => {
        operation.end(remoteVerdict(remoteReasonOf(cause)));
        shell.report(t("could not add {name}: {reason}", { name, reason: describe(cause) }));
      })
      .finally(() => {
        if (keep) pull(text.repository, false);
        else {
          setBusy(false);
          setFetching("");
        }
      });
  };

  const heldHelps = (): readonly Resource[] => copies().filter((resource) => !isBible(resource));

  /**
   * The Translation Notes this device does not hold yet, A–Z by language as
   * the catalogue gives them. Held means the same URL, or notes in the same
   * language: a device with `WycliffeAssociates/en_tn` is not offered
   * `WA-Catalog/en_tn` as a second English (Will, 2026-10-15; their book
   * folders are the same git trees).
   */
  const helps = (): readonly ListedText[] => {
    const read = notes();
    if (read?.state !== "ready") return [];
    const urls = new Set(
      heldHelps().flatMap((resource) =>
        resource.upstream === undefined ? [] : [normaliseRepoUrl(resource.upstream.url)],
      ),
    );
    const languages = new Set(
      heldHelps().flatMap((resource) =>
        resource.language === undefined ? [] : [resource.language.toLowerCase()],
      ),
    );
    return read.rows.filter(
      (help) =>
        !urls.has(normaliseRepoUrl(help.url)) && !languages.has(help.language.toLowerCase()),
    );
  };

  const removeNotes = (resource: Resource): void => {
    if (chosen() === resource.id) setChosen(undefined);
    void removeHelp(services, resource);
  };

  const fetchHelp = (help: ListedText): void => {
    setBusy(true);
    setFetching(
      t("Translation Notes · {language}", { language: help.languageName || help.language }),
    );
    void downloadHelp(services, help)
      // oxlint-disable-next-line solid/reactivity
      .then((resource) => show(resource))
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        setFetching("");
      });
  };

  const download = (): void => {
    const project = shell.project();
    if (project === undefined) return;
    setBusy(true);
    void announceSourceTexts(services, project.root).finally(() => {
      setBusy(false);
      setBound((held) => held + 1);
    });
  };

  const shown = createMemo(
    (): Shown => {
      const list = entries();
      const book = shell.focused()?.id;
      const entry = list.find((each) => each.resource.id === chosen()) ?? list[0];
      return entry === undefined || book === undefined ? undefined : { entry, book };
    },
    {
      name: "referenceShownPane",
      equals: (a: Shown, b: Shown) =>
        a?.entry.resource.id === b?.entry.resource.id &&
        a?.entry.declared === b?.entry.declared &&
        a?.book === b?.book,
    },
  );

  const nameOf = (resource: Resource | undefined): string => {
    if (resource === undefined) return "";
    const tag = resource.language ?? "";
    if (tag === "") return resource.title;
    const name = nameOfLanguage(tag);
    return isBible(resource)
      ? `${name} (${resource.language ?? ""})`
      : `${resource.title} · ${name} (${resource.language ?? ""})`;
  };

  const [showMaterial, setShowMaterial] = createSignal(false, { name: "referenceShowMaterial" });
  const [shelf, setShelf] = createSignal<Shelf>("notes", { name: "referenceShelf" });
  const [query, setQuery] = createSignal("", { name: "referenceQuery" });
  const picker: PickerModel = {
    busy,
    fetching,
    nameOf,
    shown,
    installed,
    show,
    offer,
    otherProjects,
    showProject,
    notes,
    helps,
    heldHelps,
    removeNotes,
    fetchHelp,
    bibles,
    offeredBibles,
    fetchBible,
    showMaterial,
    setShowMaterial,
    shelf,
    setShelf,
    query,
    setQuery,
  };

  /** The split dropdown's language list, open or shut. */
  const [managing, setManaging] = createSignal(false, { name: "referenceManaging" });
  const manage = (open: boolean): void => {
    setManaging(open);
    if (open) offer();
  };
  /** A listing still on its way: nothing read yet, or the read in flight. */
  const listing = (read: Listing | undefined): boolean =>
    read === undefined || read.state === "loading";
  /** A row of the add list: what it is called, how to sort it, and what its button does. */
  type Offer =
    | {
        readonly kind: "held";
        readonly key: string;
        readonly name: string;
        readonly add: () => void;
      }
    | {
        readonly kind: "download";
        readonly key: string;
        readonly name: string;
        readonly download: () => void;
        readonly pulling: () => boolean;
      };
  const byName = (a: Offer, b: Offer): number => a.name.localeCompare(b.name);

  /**
   * The left half: LANGUAGES only, one row each. Those on this device (its
   * texts, and the reader's other projects) A–Z, then those to download A–Z.
   * Choosing a held language opens its scripture; what else it holds is the
   * right half's.
   */
  const offers = (): readonly Offer[] => {
    const texts = new Map<string, Resource[]>();
    for (const resource of installed()) {
      const key = languageOf(resource);
      texts.set(key, [...(texts.get(key) ?? []), resource]);
    }
    const projectsIn = new Map<string, ProjectSummary[]>();
    for (const row of otherProjects()) {
      const key = projectLanguageOf(row);
      projectsIn.set(key, [...(projectsIn.get(key) ?? []), row]);
    }
    const heldKeys = new Set([...texts.keys(), ...projectsIn.keys()]);
    const held: Offer[] = [...heldKeys].map((key): Offer => {
      const here = texts.get(key) ?? [];
      const projectsHere = projectsIn.get(key) ?? [];
      return {
        kind: "held",
        key,
        name: languageLabel(key),
        add: () => {
          const opening = here.find(isBible) ?? here[0];
          if (opening !== undefined) show(opening);
          else if (projectsHere[0] !== undefined) showProject(projectsHere[0]);
        },
      };
    });
    // To download: a language with a gateway Bible, or only Translation
    // Notes, and nothing here yet. Its Bible first when it has one.
    const toGet = new Map<string, Offer>();
    for (const text of offeredBibles()) {
      const key = text.language.toLowerCase();
      if (heldKeys.has(key) || toGet.has(key)) continue;
      toGet.set(key, {
        kind: "download",
        key: text.repository,
        name: textName(text),
        download: () => fetchBible(text, true),
        pulling: () => pulling().has(text.repository),
      });
    }
    for (const help of helps()) {
      const key = help.language.toLowerCase();
      if (heldKeys.has(key) || toGet.has(key)) continue;
      toGet.set(key, {
        kind: "download",
        key: help.repository,
        name: textName(help),
        download: () => fetchHelp(help),
        pulling: () => helpDownloads().has(help.repository),
      });
    }
    return [...held.sort(byName), ...[...toGet.values()].sort(byName)];
  };
  /**
   * The split dropdown's right half: everything in the language on show, of
   * every kind. What is on this device (its scriptures, its Translation
   * Notes…), the reader's other projects in it, then what there is to
   * download: its gateway Bibles and its Translation Notes. Named by its
   * shorthand (`ULB`, `REG`) where it has one, not its full title.
   */
  const ResourcePicker = (pickerProps: { readonly resource: Resource }) => {
    const key = (): string => languageOf(pickerProps.resource);
    const texts = (): readonly Resource[] =>
      installed().filter((each) => languageOf(each) === key());
    const projectsHere = (): readonly ProjectSummary[] =>
      otherProjects().filter((row) => projectLanguageOf(row) === key());
    const biblesHere = (): readonly ListedText[] =>
      offeredBibles().filter((text) => text.language.toLowerCase() === key());
    const notesHere = (): readonly ListedText[] =>
      helps().filter((help) => help.language.toLowerCase() === key());
    return (
      <Menu
        label={m.reference_resource()}
        triggerClass="min-w-0"
        onOpenChange={(open) => {
          if (open) offer();
        }}
        side="bottom"
        // Its menu ends where the control does, flush with the panel's
        // right edge, not hanging past it.
        align="end"
        class="w-80"
        fitViewport
        trigger={
          <button type="button" data-testid="resource-picker" class={HALF}>
            <span class="min-w-0 flex-1 truncate" title={pickerProps.resource.title}>
              {pickerProps.resource.abbreviation?.toUpperCase() ?? pickerProps.resource.title}
            </span>
            <ChevronDown aria-hidden="true" class="size-5 shrink-0" />
          </button>
        }
      >
        <For each={texts()}>
          {(text) => (
            <MenuItem class={ROW} onSelect={() => show(text)}>
              <span class="min-w-0 flex-1 truncate">{text.title}</span>
              <Show when={text.id === pickerProps.resource.id}>
                <Check aria-label={m.reference_showing()} class="size-5 shrink-0 text-brand" />
              </Show>
            </MenuItem>
          )}
        </For>
        <For each={projectsHere()}>
          {(row) => (
            <MenuItem class={ROW} onSelect={() => showProject(row)}>
              <span class="min-w-0 flex-1 truncate">{row.name}</span>
            </MenuItem>
          )}
        </For>
        <For each={biblesHere()}>
          {(text) => (
            <MenuItem class={ROW} onSelect={() => fetchBible(text)}>
              <span class="min-w-0 flex-1 truncate">{text.title}</span>
              <Download aria-hidden="true" class="size-5 shrink-0" />
            </MenuItem>
          )}
        </For>
        <For each={notesHere()}>
          {(help) => (
            <MenuItem class={ROW} onSelect={() => fetchHelp(help)}>
              <span class="min-w-0 flex-1 truncate">{m.reference_shelf_notes()}</span>
              <Show
                when={helpDownloads().has(help.repository)}
                fallback={<Download aria-hidden="true" class="size-5 shrink-0" />}
              >
                <span
                  role="status"
                  aria-label={m.reference_downloading()}
                  class="size-5 shrink-0 animate-spin rounded-full border-2 border-on-surface-tertiary border-t-transparent"
                />
              </Show>
            </MenuItem>
          )}
        </For>
      </Menu>
    );
  };

  /** The language a group is called by, as the split dropdown names it. */
  const groupName = (group: {
    readonly key: string;
    readonly entries: readonly Entry[];
  }): string => (group.key === "" ? m.reference_no_language() : nameOfLanguage(group.key));
  /** The language of the text on show, if one is. */
  const shownLanguage = (): string | undefined => {
    const held = shown();
    return held === undefined ? undefined : languageOf(held.entry.resource);
  };
  /**
   * One half of the split dropdown: md — 3rem (48px) with the 1px border
   * above and below, 14px, a 20px chevron, 24px sides — level with the
   * editor's action bar.
   */
  const HALF =
    "flex h-11.5 min-w-0 cursor-pointer items-center gap-3 px-6 text-start text-small font-semibold text-on-surface-primary transition-colors hover:bg-surface-secondary";

  /**
   * The split view's one control: | English ⌄ | ULB ⌄ |. The left half picks
   * the language — the ones already beside this project, then the add list —
   * and the right half picks the text within it.
   */
  /**
   * A grace period before a download starts: two seconds in which the row
   * reads "Starting…" and pressing it again calls it off. Nothing has been
   * fetched yet, so there is nothing to undo — a mis-tap costs nothing. Once
   * the clone has begun it runs to the end: the git hosts cannot stop one
   * part-way yet, and a half-stopped clone leaves a folder that blocks the
   * next try.
   */
  const DOWNLOAD_GRACE_MS = 2000;
  const [starting, setStarting] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "referenceStarting",
  });
  const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const settle = (key: string): void => {
    graceTimers.delete(key);
    setStarting((held) => {
      const next = new Set(held);
      next.delete(key);
      return next;
    });
  };
  const startSoon = (key: string, download: () => void): void => {
    setStarting((held) => new Set(held).add(key));
    graceTimers.set(
      key,
      setTimeout(() => {
        settle(key);
        download();
      }, DOWNLOAD_GRACE_MS),
    );
  };
  const callOff = (key: string): void => {
    clearTimeout(graceTimers.get(key));
    settle(key);
  };
  // Leaving the screen inside the grace period calls the download off too.
  onCleanup(() => {
    for (const timer of graceTimers.values()) clearTimeout(timer);
  });

  const GatewayPicker = () => (
    // The panel's whole width. The language takes what is left over; the text,
    // by its shorthand, only what it needs.
    <div
      data-testid="gateway-picker"
      class="flex w-full shrink-0 overflow-hidden rounded-lg border border-surface-border"
    >
      <Popover
        label={m.reference_language()}
        side="bottom"
        align="start"
        variant="menu"
        class="w-96 p-0"
        fitViewport
        open={managing()}
        onOpenChange={manage}
        triggerClass="min-w-0 flex-1"
        trigger={
          <button type="button" data-testid="gateway-language" class={cx(HALF, "w-full")}>
            <span class="min-w-0 flex-1 truncate">
              {(() => {
                const key = shownLanguage();
                const group = languageTabs().find((each) => each.key === key);
                return group === undefined ? m.reference_choose_language() : groupName(group);
              })()}
            </span>
            <ChevronDown aria-hidden="true" class="size-5 shrink-0" />
          </button>
        }
      >
        {/* One list, A–Z, no headings and no add or remove: every language
            there is, on this device or to download. The one on show is
            selected; choosing another shows it instead. One still to download
            says so in its row. */}
        <ul
          data-testid="language-list"
          class="scrollbar-padded flex max-h-[min(70vh,32rem)] flex-col overflow-y-auto py-2"
        >
          <Show when={listing(bibles())}>
            <li class="px-4 py-2 text-small text-on-surface-tertiary">
              {m.reference_list_loading()}
            </li>
          </Show>
          <For each={[...offers()].sort(byName)}>
            {(offer) => (
              <li data-testid={`gateway-language-${offer.key}`}>
                <Show
                  when={offer.kind === "held" ? offer : undefined}
                  fallback={
                    // To download: the whole row is the action, blue like a
                    // link. For two seconds it is "Starting…", and pressing
                    // it again calls it off; then the bar, and nothing to press.
                    offer.kind === "download" && (
                      <button
                        type="button"
                        aria-label={
                          starting().has(offer.key)
                            ? m.reference_download_cancel({ name: offer.name })
                            : m.reference_download_named({ name: offer.name })
                        }
                        disabled={offer.pulling()}
                        class="flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 text-start text-small text-on-surface-primary transition-colors hover:bg-surface-secondary disabled:cursor-default disabled:hover:bg-transparent"
                        onClick={() => {
                          if (starting().has(offer.key)) callOff(offer.key);
                          else startSoon(offer.key, () => offer.download());
                        }}
                      >
                        <span class="min-w-0 flex-1 truncate" title={offer.name}>
                          {offer.name}
                        </span>
                        <Show
                          when={offer.pulling()}
                          fallback={
                            <Show
                              when={starting().has(offer.key)}
                              fallback={
                                <span class="flex shrink-0 items-center gap-1.5 font-medium text-brand">
                                  <Download aria-hidden="true" class="size-5" />
                                  {m.reference_download()}
                                </span>
                              }
                            >
                              <span class="flex shrink-0 items-center gap-3">
                                <span class="text-on-surface-secondary">
                                  {m.reference_download_starting()}
                                </span>
                                <span class="flex items-center gap-1.5 font-medium text-brand">
                                  <X aria-hidden="true" class="size-5" />
                                  {m.reference_cancel()}
                                </span>
                              </span>
                            </Show>
                          }
                        >
                          {/* No byte count to show, so the bar runs until the copy lands. */}
                          <span
                            role="progressbar"
                            aria-label={m.reference_downloading_named({ name: offer.name })}
                            class="relative h-2 w-24 shrink-0 overflow-hidden rounded-full bg-surface-secondary"
                          >
                            <span class="absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-brand" />
                          </span>
                        </Show>
                      </button>
                    )
                  }
                >
                  {(held) => (
                    <button
                      type="button"
                      aria-current={shownLanguage() === held().key ? "true" : undefined}
                      class="flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 text-start text-small text-on-surface-primary transition-colors hover:bg-surface-secondary aria-[current]:bg-brand-light aria-[current]:font-semibold aria-[current]:text-brand"
                      onClick={() => {
                        const group = languageTabs().find((each) => each.key === held().key);
                        const opening =
                          group === undefined ? undefined : openingOf(group.entries, group.key);
                        if (opening !== undefined) setChosen(opening.resource.id);
                        else held().add();
                        setManaging(false);
                      }}
                    >
                      <span class="min-w-0 flex-1 truncate" title={held().name}>
                        {held().name}
                      </span>
                      <Show when={shownLanguage() === held().key}>
                        <Check aria-label={m.reference_active()} class="size-5 shrink-0" />
                      </Show>
                    </button>
                  )}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Popover>
      <Show when={shown()}>
        {(held) => (
          <div class="flex max-w-[50%] min-w-0 shrink-0 border-s border-surface-border">
            <ResourcePicker resource={held().entry.resource} />
          </div>
        )}
      </Show>
    </div>
  );

  return (
    <aside
      aria-label={t("Reference texts")}
      class={
        props.variant === "gateway"
          ? "flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3"
          : "flex h-full min-w-0 flex-col gap-3 py-4 pe-[7.5px]"
      }
      data-references={entries().length}
    >
      <Show when={props.variant === "gateway"} fallback={<LanguagePicker model={picker} />}>
        <GatewayPicker />
        <Show when={fetching() !== ""}>
          <p role="status" class="text-small text-on-surface-secondary">
            {m.reference_getting({ language: fetching() })}
          </p>
        </Show>
      </Show>

      <Show when={!loading() && missing().length > 0 && entries().every((entry) => entry.declared)}>
        <div
          data-testid="declared-missing"
          class="flex shrink-0 flex-col gap-1.5 rounded-md bg-surface-secondary px-3 py-2 text-small"
        >
          <p class="text-on-surface-secondary">
            {t("This project's source text is not on this device: {texts}.", {
              texts: missing()
                .map((ref) =>
                  ref.version === undefined
                    ? `${ref.language}_${ref.resource}`
                    : `${ref.language}_${ref.resource} ${ref.version}`,
                )
                .join(", "),
            })}
          </p>
          <Button variant="secondary" size="sm" disabled={busy()} onClick={download}>
            {t("Download")}
          </Button>
        </div>
      </Show>

      <Show
        when={shown()}
        keyed
        fallback={
          <Show when={!loading()}>
            <EmptyState
              icon={<BookMarked size={22} />}
              title={
                fetching() === ""
                  ? t("No source text yet")
                  : t("Getting {language}…", { language: fetching() })
              }
              description={
                fetching() === ""
                  ? t("Choose a reference language above to read beside this project.")
                  : t("Downloading it once, to read beside this project.")
              }
            />
          </Show>
        }
      >
        {(held) => (
          <div class="flex min-h-0 flex-1 flex-col gap-3">
            <ResourcePane
              resource={held.entry.resource}
              role={held.entry.role}
              bookId={held.book}
              clip={clip}
              followControl={props.variant === "column" || props.variant === undefined}
            />
          </div>
        )}
      </Show>
    </aside>
  );
}
