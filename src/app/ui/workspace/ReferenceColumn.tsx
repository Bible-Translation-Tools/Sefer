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
import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from "solid-js";

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
import { Button, EmptyState, Input, Menu, MenuItem, SegmentedControl } from "../primitives";

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

  const offer = (): void => {
    if (projects() === undefined) {
      const recent = services.settings.get(shellKeys(services.settings).recentProjects);
      void services
        .run(listProjects(services.projectsRoot, services.fixtureProject, recent))
        .then(setProjects);
    }
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

  const [chosen, setChosen] = createSignal<string | undefined>(undefined, {
    name: "referenceShown",
  });

  const show = (resource: Resource): void => {
    const project = shell.project();
    if (project === undefined) return;
    setChosen(resource.id);
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

  const fetchBible = (text: ListedText): void => {
    const name = text.languageName || text.language;
    const operation = services.composition.observability.operation("import.remote", {
      "import.source": "reference",
      "import.host": services.hostInfo.kind(),
      "catalogue.type": "gateway",
    });
    setBusy(true);
    setFetching(name);
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
        show(resource);
      })
      .catch((cause: unknown) => {
        operation.end(remoteVerdict(remoteReasonOf(cause)));
        shell.report(t("could not add {name}: {reason}", { name, reason: describe(cause) }));
      })
      .finally(() => {
        setBusy(false);
        setFetching("");
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
    const name = languageName(resource.language);
    if (name === undefined) return resource.title;
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
  return (
    <aside
      aria-label={t("Reference texts")}
      class="flex h-full min-w-0 flex-col gap-3 py-4 pe-[7.5px]"
      data-references={entries().length}
    >
      <LanguagePicker model={picker} />

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
          <div class="flex min-h-0 flex-1 flex-col">
            <ResourcePane
              resource={held.entry.resource}
              role={held.entry.role}
              bookId={held.book}
              clip={clip}
            />
          </div>
        )}
      </Show>
    </aside>
  );
}
