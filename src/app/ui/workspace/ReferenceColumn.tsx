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

import type { JSX } from "@solidjs/web";
import { Effect, Option, Result } from "effect";
import BookMarked from "lucide-solid/icons/book-marked";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import Download from "lucide-solid/icons/download";
import MoreHorizontal from "lucide-solid/icons/ellipsis";
import Globe from "lucide-solid/icons/globe";
import Heart from "lucide-solid/icons/heart";
import Plus from "lucide-solid/icons/plus";
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
  untrack,
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
import { flyCard } from "../landing/downloads";
import { listProjects, type ProjectSummary } from "../landing/summaries";
import {
  Button,
  EmptyState,
  IconButton,
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
   * `panel`: Refine's language panels, a design tweak. Every text the project
   * shows is a TAB, one on show at a time, and "+" is the language menu; no
   * fold, no column padding. `gateway`: the split view's reference panel —
   * no tabs, one split dropdown, language then text, over the text on show.
   * `column` otherwise.
   */
  readonly variant?: "column" | "panel" | "gateway";
  /**
   * The heart language, as one more tab after the gateways (the joined panel).
   * The column does not draw the editor; it shows `editor` under the strip
   * while this tab is the active one, and its own pane otherwise.
   */
  readonly heart?: {
    readonly name: string;
    readonly code: string;
    readonly active: boolean;
    /** `true`: the heart tab was chosen; `false`: a gateway tab was. */
    readonly onActivate: (heart: boolean) => void;
  };
  readonly editor?: JSX.Element;
  /** Drawn at the end of the tab strip: the panel's split or join button. */
  readonly trailing?: JSX.Element;
}

/**
 * One language tab: the full name, and the bare code only when the name would
 * not fit — shortening is how a tab truncates. Measured, not a breakpoint: the
 * name's own width (an invisible copy of it) against the room the tab has
 * after its padding and badge, re-checked whenever the tab is resized.
 */
export function LanguageTab(props: {
  readonly name: string;
  readonly code: string;
  readonly active: boolean;
  /** The heart language: the one being refined, and the one that is editable. */
  readonly refining?: boolean;
  readonly testId?: string;
  readonly onSelect?: () => void;
  /** Takes it off the tabs: an × on the tab while it is the active one. */
  readonly onClose?: () => void;
  /** The language it stands for, for the add list's flight to it. */
  readonly languageKey?: string;
  /** `false` when the strip is short of room: the icons go before the names do. */
  readonly showIcon?: boolean;
}) {
  // The × only on the tab on show.
  const closable = (): boolean => props.active && props.onClose !== undefined;
  // The label is two layers in one grid cell: an invisible copy of the full
  // name, which gives the tab its natural width and shrinks when the strip is
  // short of room, and the visible text over it. The name shows while the copy
  // has room for all of it (`scrollWidth` is its whole width, `clientWidth`
  // what it was given); otherwise the code.
  const [ghost, setGhost] = createSignal<HTMLSpanElement>();
  const [fits, setFits] = createSignal(true, { name: "languageTabFits" });
  createEffect(
    () => ({ copy: ghost(), name: props.name }),
    ({ copy }) => {
      if (copy === undefined) return;
      const measure = (): void => {
        setFits(copy.scrollWidth <= copy.clientWidth);
      };
      const observer = new ResizeObserver(measure);
      observer.observe(copy);
      measure();
      return () => observer.disconnect();
    },
  );
  return (
    <div
      data-current={props.active ? "" : undefined}
      data-tab-language={props.languageKey}
      data-short={fits() ? undefined : ""}
      class="-mb-px flex h-12 min-w-0 shrink items-center rounded-t-[12px] border-b-2 text-small font-semibold transition-colors data-current:border-brand data-current:text-brand not-data-current:border-transparent not-data-current:text-on-surface-primary not-data-current:hover:bg-surface-secondary"
    >
      <button
        type="button"
        role="tab"
        aria-selected={props.active ? "true" : "false"}
        data-testid={props.testId}
        title={props.name}
        class={cx(
          "flex h-full min-w-0 cursor-pointer items-center gap-2 text-start",
          closable() ? "ps-4 pe-2" : "px-4",
        )}
        onClick={() => props.onSelect?.()}
      >
        {/* What kind of language it is: a gateway to read beside, or the
            heart language being refined. */}
        <Show when={props.showIcon !== false}>
          <Show
            when={props.refining === true}
            fallback={<Globe aria-hidden="true" class="size-5 shrink-0" />}
          >
            <Heart aria-hidden="true" class="size-5 shrink-0" />
          </Show>
        </Show>
        <span class="grid min-w-0">
          <span
            ref={setGhost}
            aria-hidden="true"
            class="invisible col-start-1 row-start-1 min-w-0 overflow-hidden whitespace-nowrap"
          >
            {props.name}
          </span>
          <span class="col-start-1 row-start-1 truncate text-start">
            {fits() ? props.name : props.code}
          </span>
        </span>
        <Show when={props.refining === true}>
          <span class="shrink-0 rounded-full bg-brand-light px-2 py-0.5 text-smallest font-medium text-brand">
            {t("Refinement")}
          </span>
        </Show>
      </button>
      <Show when={closable()}>
        <button
          type="button"
          data-testid={props.testId === undefined ? undefined : `${props.testId}-close`}
          aria-label={t("Remove {name} from the tabs", { name: props.name })}
          title={t("Remove {name} from the tabs", { name: props.name })}
          class="me-3 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-surface-secondary"
          onClick={() => props.onClose?.()}
        >
          <X aria-hidden="true" class="size-5" />
        </button>
      </Show>
    </div>
  );
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

  /**
   * A text's LANGUAGE, as the panel variant groups by it: one tab, and one
   * row in the Add dropdown, per language, however many texts it has (ULB,
   * UDB, Notes…). Lower-cased tag; the id when a text names no language.
   */
  const languageOf = (resource: Resource): string =>
    (resource.language ?? resource.id).toLowerCase();
  /** The text last on show in each language, so returning to its tab returns to it. */
  const [lastIn, setLastIn] = createSignal<Readonly<Record<string, string>>>(
    {},
    { name: "referenceLastIn" },
  );
  /** The tabs: the bound texts grouped by language, in the order they are bound. */
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
  /** The text a language's tab opens on: the last one shown in it, else its scripture. */
  const openingOf = (group: readonly Entry[], key: string): Entry | undefined =>
    group.find((entry) => entry.resource.id === lastIn()[key]) ??
    group.find((entry) => isBible(entry.resource)) ??
    group[0];
  /** Takes every picked text in a language off the tabs; declared ones stay. */
  const unpickLanguage = (key: string): void => {
    for (const entry of entries())
      if (languageOf(entry.resource) === key && !entry.declared) unpick(entry);
  };

  const [chosen, setChosen] = createSignal<string | undefined>(undefined, {
    name: "referenceShown",
  });

  const show = (resource: Resource): void => {
    const project = shell.project();
    if (project === undefined) return;
    setChosen(resource.id);
    setLastIn((held) => ({ ...held, [languageOf(resource)]: resource.id }));
    // The joined panel: what was just chosen is what goes on show.
    props.heart?.onActivate(false);
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

  /** Downloads in flight from the panel's language list, by repository. */
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

  /** From the panel's language list (`keep`), a download stays there to Add rather than going on show. */
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

  /**
   * The panel variant's "+": the panel shows its language list in place of
   * the text — what is on this device, to add as a tab or take off the tabs,
   * then what can be downloaded.
   */
  const [managing, setManaging] = createSignal(false, { name: "referenceManaging" });
  const manage = (open: boolean): void => {
    setManaging(open);
    if (open) offer();
  };
  /** The entry a resource is a tab as, if it is one. */
  // The joined panel: with no gateway tabs left, the heart language is the one
  // on show — not an empty pane behind a tab that no longer exists.
  createEffect(
    () => !loading() && entries().length === 0,
    (none) => {
      if (none) props.heart?.onActivate(true);
    },
  );

  /** Takes a picked text off the tabs. It stays on this device, and in every other project. */
  const unpick = (entry: Entry): void => {
    const project = shell.project();
    if (project === undefined) return;
    if (chosen() === entry.resource.id) setChosen(undefined);
    void services
      .run(services.library.unpick(project.root, entry.role, entry.resource.id))
      .then(() => setBound((held) => held + 1));
  };

  /** A listing still on its way: nothing read yet, or the read in flight. */
  const listing = (read: Listing | undefined): boolean =>
    read === undefined || read.state === "loading";
  /** Why a list could not be read, while that is the last word. */
  const notesFailure = () => {
    const read = notes()?.state === "failed" ? notes() : bibles();
    return read?.state === "failed" ? read : undefined;
  };

  /** A row of the add list: what it is called, how to sort it, and what its button does. */
  type Offer =
    | {
        readonly kind: "held";
        readonly key: string;
        readonly name: string;
        readonly added: () => boolean;
        /** `from`: where the row's name is, for the flight to its tab. */
        readonly add: (from: DOMRect) => void;
        /** Takes it off the tabs again; absent where that cannot be done. */
        readonly remove?: () => void;
        /** `false` while every text it has on the tabs is one the project declares. */
        readonly removable?: () => boolean;
      }
    | {
        readonly kind: "download";
        readonly key: string;
        readonly name: string;
        readonly download: () => void;
        readonly pulling: () => boolean;
      };
  const byName = (a: Offer, b: Offer): number => a.name.localeCompare(b.name);

  const [aside, setAside] = createSignal<HTMLElement>();
  const tabIds = (): ReadonlySet<string> =>
    new Set(
      [...(aside()?.querySelectorAll<HTMLElement>("[data-tab-language]") ?? [])].map(
        (tab) => tab.dataset.tabLanguage ?? "",
      ),
    );
  /**
   * Flies the added row's name up to its new tab: a ghost from the row to the
   * tab once the tab is drawn (looked for every 50ms, for up to 3s, since a
   * pick re-resolves the bindings first). `which` picks the tab; for another
   * project, whose resource id is not known until it is registered, it is the
   * tab that was not there before.
   */
  const flyToTab = (from: DOMRect, label: string, which: (id: string) => boolean): void => {
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true) return;
    let tries = 0;
    const look = (): void => {
      const tab = [...(aside()?.querySelectorAll<HTMLElement>("[data-tab-language]") ?? [])].find(
        (each) => which(each.dataset.tabLanguage ?? ""),
      );
      if (tab !== undefined) flyCard(from, tab, label);
      else if ((tries += 1) < 60) setTimeout(look, 50);
    };
    look();
  };

  /**
   * What the add list offers: everything on this device (and the reader's
   * other projects), A–Z — those already a tab say Added — then everything to
   * download, A–Z. A download stays in the list once it lands, now with Add.
   */
  const offers = (): readonly Offer[] => {
    // One row per LANGUAGE on this device, whatever texts it holds; it opens
    // on its scripture. Removing takes all of its texts off the tabs.
    const languages = new Map<string, Resource[]>();
    for (const resource of installed()) {
      const key = languageOf(resource);
      const held = languages.get(key);
      if (held === undefined) languages.set(key, [resource]);
      else held.push(resource);
    }
    const labelOf = (key: string, fallback: string): string =>
      `${languageName(key) ?? fallback} (${key})`;
    const held: Offer[] = [...languages].map(([key, texts]): Offer => {
      const name = labelOf(key, texts[0]?.title ?? key);
      const inTabs = (): readonly Entry[] =>
        entries().filter((entry) => languageOf(entry.resource) === key);
      return {
        kind: "held",
        key,
        name,
        added: () => inTabs().length > 0,
        add: (from) => {
          const opening = texts.find(isBible) ?? texts[0];
          if (opening === undefined) return;
          show(opening);
          flyToTab(from, name, (id) => id === key);
        },
        remove: () => unpickLanguage(key),
        removable: () => !inTabs().every((entry) => entry.declared),
      };
    });
    for (const row of otherProjects()) {
      const key = (row.languageTag || row.root).toLowerCase();
      if (languages.has(key)) continue;
      languages.set(key, []);
      const name = row.languageTag === "" ? row.name : labelOf(key, row.language || row.name);
      held.push({
        kind: "held",
        key,
        name,
        added: () => false,
        add: (from) => {
          const before = tabIds();
          showProject(row);
          flyToTab(from, name, (id) => !before.has(id));
        },
      });
    }
    // Languages to download: one row each, never one already on this device.
    const offered = new Set<string>();
    const toGet: Offer[] = offeredBibles().flatMap((text): Offer[] => {
      const key = text.language.toLowerCase();
      if (languages.has(key) || offered.has(key)) return [];
      offered.add(key);
      return [
        {
          kind: "download",
          key: text.repository,
          name: textName(text),
          download: () => fetchBible(text, true),
          pulling: () => pulling().has(text.repository),
        },
      ];
    });
    return [...held.sort(byName), ...toGet.sort(byName)];
  };
  const downloaded = (): readonly Offer[] => offers().filter((offer) => offer.kind === "held");
  const available = (): readonly Offer[] => offers().filter((offer) => offer.kind === "download");

  /**
   * The panel's add list (the panel variant's "+"): one list under one title,
   * what is on this device first, then what can be downloaded — each A–Z.
   * Add makes it a tab, flies it up there, and the row then says Added; Download turns into a
   * progress bar and leaves the row, now with Add, when it lands. Taking a
   * text off the tabs is the × on its tab.
   */
  /**
   * The panel variant's choice of text WITHIN a language tab: every text on
   * this device in that language — its scriptures, its Translation Notes… —
   * and, to download, the notes this language has and the device does not.
   */
  const ResourcePicker = (pickerProps: {
    readonly resource: Resource;
    /** The trigger's own look, for the split dropdown's right half. */
    readonly triggerClass?: string;
    /** Name the text by its shorthand (`ULB`, `REG`) where it has one, not its full title. */
    readonly short?: boolean;
  }) => {
    const key = (): string => languageOf(pickerProps.resource);
    const texts = (): readonly Resource[] =>
      installed().filter((each) => languageOf(each) === key());
    const notesHere = (): readonly ListedText[] =>
      helps().filter((help) => help.language.toLowerCase() === key());
    return (
      <Menu
        label={t("Resource")}
        triggerClass="min-w-0"
        onOpenChange={(open) => {
          if (open) offer();
        }}
        side="bottom"
        // The split dropdown's right half: its menu ends where the control
        // does, flush with the panel's right edge, not hanging past it.
        align={pickerProps.short === true ? "end" : "start"}
        class="w-80"
        fitViewport
        trigger={
          <button
            type="button"
            data-testid="resource-picker"
            class={
              pickerProps.triggerClass ??
              "flex min-h-12 w-full max-w-sm cursor-pointer items-center gap-3 rounded-lg px-3 text-start text-small font-semibold text-on-surface-primary transition-colors hover:bg-surface-secondary"
            }
          >
            <span class="min-w-0 flex-1 truncate" title={pickerProps.resource.title}>
              {pickerProps.short === true
                ? (pickerProps.resource.identifier?.toUpperCase() ?? pickerProps.resource.title)
                : pickerProps.resource.title}
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
                <Check aria-label={t("Showing")} class="size-5 shrink-0 text-brand" />
              </Show>
            </MenuItem>
          )}
        </For>
        <For each={notesHere()}>
          {(help) => (
            <MenuItem class={ROW} onSelect={() => fetchHelp(help)}>
              <span class="min-w-0 flex-1 truncate">{t("Translation Notes")}</span>
              <Show
                when={helpDownloads().has(help.repository)}
                fallback={<Download aria-hidden="true" class="size-5 shrink-0" />}
              >
                <span
                  role="status"
                  aria-label={t("Downloading")}
                  class="size-5 shrink-0 animate-spin rounded-full border-2 border-on-surface-tertiary border-t-transparent"
                />
              </Show>
            </MenuItem>
          )}
        </For>
      </Menu>
    );
  };

  /**
   * How tight the tab strip is, so it gives up room in order: 0, everything;
   * 1, + Add and Split/Join fold into a "…" menu; 2, the language icons go
   * too. Past that, names shorten to codes (each tab's own measure). It
   * steps up while any tab has fallen back to its code, and back down once
   * the strip is clearly wider than where it stepped up.
   */
  const [tight, setTight] = createSignal<0 | 1 | 2>(0, { name: "referenceStripTight" });
  const [strip, setStrip] = createSignal<HTMLElement>();
  // Cramped: the strip overflows, or some tab has had to fall back to its code.
  const cramped = (element: HTMLElement): boolean =>
    element.scrollWidth > element.clientWidth + 1 || element.querySelector("[data-short]") !== null;
  createEffect(
    () => ({ element: strip(), tabs: languageTabs().length }),
    ({ element }) => {
      if (element === undefined) return;
      // The width each step was taken at. A step is only undone once the
      // strip is clearly wider than that, so a strip on the edge does not
      // fold and unfold on every frame; and only WIDTH changes count, since
      // folding changes the strip's own height.
      const takenAt: number[] = [];
      let width = -1;
      let frame = 0;
      // Two frames: one to draw a step, one for each tab's own measure (a
      // ResizeObserver, which reports after layout) to land.
      const later = (then: () => void): void => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(then);
        });
      };
      const check = (): void => {
        const now = untrack(tight);
        const room = element.clientWidth;
        const back = takenAt[now - 1];
        if (now > 0 && back !== undefined && room > back + 16) {
          takenAt.length = now - 1;
          setTight(now === 2 ? 1 : 0);
          later(check);
        } else if (now < 2 && cramped(element)) {
          takenAt[now] = room;
          setTight(now === 0 ? 1 : 2);
          later(check);
        }
      };
      const observer = new ResizeObserver(() => {
        if (element.clientWidth === width) return;
        width = element.clientWidth;
        later(check);
      });
      observer.observe(element);
      later(check);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
      };
    },
  );

  /** One row's action: Add, Remove, Download, or the bar while it downloads. */
  const offerAction = (offer: Offer): JSX.Element => {
    if (offer.kind === "download")
      return (
        <Show
          when={offer.pulling()}
          fallback={
            <Button variant="tertiary" onClick={() => offer.download()}>
              <Download aria-hidden="true" />
              {t("Download")}
            </Button>
          }
        >
          {/* No byte count to show, so the bar runs until the copy lands. */}
          <div
            role="progressbar"
            aria-label={t("Downloading {name}", { name: offer.name })}
            class="relative h-2 w-24 shrink-0 overflow-hidden rounded-full bg-surface-secondary"
          >
            <div class="absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-brand" />
          </div>
        </Show>
      );
    return (
      <Show
        when={offer.added()}
        fallback={
          <Button
            variant="tertiary"
            disabled={busy()}
            onClick={(event) => {
              const button = event.currentTarget;
              const row = button.closest("li")?.querySelector("span") ?? button;
              offer.add(row.getBoundingClientRect());
            }}
          >
            <Plus aria-hidden="true" />
            {t("Add")}
          </Button>
        }
      >
        <Show
          when={offer.remove !== undefined && offer.removable?.() !== false}
          fallback={<span class="text-small text-on-surface-tertiary">{t("Project source")}</span>}
        >
          <Button variant="tertiary" onClick={() => offer.remove?.()}>
            <X aria-hidden="true" />
            {t("Remove")}
          </Button>
        </Show>
      </Show>
    );
  };

  /**
   * The Add dropdown (the panel variant): what is downloaded, then what is
   * available, each A–Z, one line a language — "Name (code)" and its action.
   * Add makes it a tab (and flies it there) and turns into Remove; Remove
   * takes it off the tabs and turns back into Add; Download runs a bar, and
   * the language moves up to Downloaded when it lands.
   */
  const LanguageList = () => (
    <div
      data-testid="language-list"
      class="scrollbar-padded flex max-h-[min(70vh,32rem)] flex-col overflow-y-auto py-2"
    >
      <h3 class="flex h-12 shrink-0 items-center px-4 text-small font-bold text-on-surface-primary">
        {t("Downloaded")}
      </h3>
      <Show when={downloaded().length === 0}>
        <p class="px-4 py-2 text-small text-on-surface-tertiary">{t("Nothing downloaded yet.")}</p>
      </Show>
      <ul>
        <For each={downloaded()}>
          {(offer) => (
            <li
              data-testid={`language-offer-${offer.key}`}
              class="flex min-h-12 items-center gap-3 px-4 text-small text-on-surface-primary"
            >
              <span class="min-w-0 flex-1 truncate" title={offer.name}>
                {offer.name}
              </span>
              {offerAction(offer)}
            </li>
          )}
        </For>
      </ul>
      <h3 class="flex h-12 shrink-0 items-center px-4 text-small font-bold text-on-surface-primary">
        {t("Available")}
      </h3>
      <Show when={listing(bibles())}>
        <p class="px-4 py-2 text-small text-on-surface-tertiary">{t("Loading the list…")}</p>
      </Show>
      <Show when={notesFailure()}>
        {(failure) => (
          <p role="status" class="px-4 py-2 text-small text-on-surface-tertiary">
            {failure().offline
              ? t("You are offline. Open this list again to retry.")
              : t("Could not read the list. Open this list again to retry.")}
          </p>
        )}
      </Show>
      <ul>
        <For each={available()}>
          {(offer) => (
            <li
              data-testid={`language-offer-${offer.key}`}
              class="flex min-h-12 items-center gap-3 px-4 text-small text-on-surface-primary"
            >
              <span class="min-w-0 flex-1 truncate" title={offer.name}>
                {offer.name}
              </span>
              {offerAction(offer)}
            </li>
          )}
        </For>
      </ul>
    </div>
  );

  /** The language a tab group is called by, as the tabs and the split dropdown name it. */
  const groupName = (group: { readonly key: string; readonly entries: readonly Entry[] }): string =>
    languageName(group.key) ?? group.entries[0]?.resource.title ?? group.key;
  /** The language of the text on show, if one is. */
  const shownLanguage = (): string | undefined => {
    const held = shown();
    return held === undefined ? undefined : languageOf(held.entry.resource);
  };
  /**
   * One half of the split dropdown: md — 48px with the 1px border above and
   * below, 14px, a 20px chevron, 24px sides — level with the editor's action bar.
   */
  const HALF =
    "flex h-[46px] min-w-0 cursor-pointer items-center gap-3 px-6 text-start text-small font-semibold text-on-surface-primary transition-colors hover:bg-surface-secondary";

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
        label={t("Reference language")}
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
                return group === undefined ? t("Choose a language") : groupName(group);
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
            <li class="px-4 py-2 text-small text-on-surface-tertiary">{t("Loading the list…")}</li>
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
                            ? t("Cancel downloading {name}", { name: offer.name })
                            : t("Download {name}", { name: offer.name })
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
                                  {t("Download")}
                                </span>
                              }
                            >
                              <span class="flex shrink-0 items-center gap-3">
                                <span class="text-on-surface-secondary">{t("Starting…")}</span>
                                <span class="flex items-center gap-1.5 font-medium text-brand">
                                  <X aria-hidden="true" class="size-5" />
                                  {t("Cancel")}
                                </span>
                              </span>
                            </Show>
                          }
                        >
                          {/* No byte count to show, so the bar runs until the copy lands. */}
                          <span
                            role="progressbar"
                            aria-label={t("Downloading {name}", { name: offer.name })}
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
                      onClick={(event) => {
                        const group = languageTabs().find((each) => each.key === held().key);
                        const opening =
                          group === undefined ? undefined : openingOf(group.entries, group.key);
                        if (opening !== undefined) setChosen(opening.resource.id);
                        else held().add(event.currentTarget.getBoundingClientRect());
                        setManaging(false);
                      }}
                    >
                      <span class="min-w-0 flex-1 truncate" title={held().name}>
                        {held().name}
                      </span>
                      <Show when={shownLanguage() === held().key}>
                        <Check aria-label={t("Active")} class="size-5 shrink-0" />
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
            <ResourcePicker resource={held().entry.resource} triggerClass={HALF} short />
          </div>
        )}
      </Show>
    </div>
  );

  return (
    <aside
      ref={setAside}
      aria-label={t("Reference texts")}
      class={
        props.variant === "panel" || props.variant === "gateway"
          ? "flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3"
          : "flex h-full min-w-0 flex-col gap-3 py-4 pe-[7.5px]"
      }
      data-references={entries().length}
    >
      <Show
        when={props.variant === "panel" || props.variant === "gateway"}
        fallback={<LanguagePicker model={picker} />}
      >
        <Show when={props.variant === "gateway"}>
          <GatewayPicker />
        </Show>
        <Show when={props.variant !== "gateway"}>
          <div
            ref={setStrip}
            role="tablist"
            aria-label={t("Languages")}
            class="flex shrink-0 items-center gap-controls border-b border-surface-border"
          >
            <div class="flex min-w-0 items-end">
              <For each={languageTabs()}>
                {(group) => (
                  <LanguageTab
                    testId={`language-tab-${group.key}`}
                    name={languageName(group.key) ?? group.entries[0]?.resource.title ?? group.key}
                    code={group.key}
                    active={
                      props.heart?.active !== true &&
                      shown() !== undefined &&
                      languageOf(shown()!.entry.resource) === group.key
                    }
                    onSelect={() => {
                      const opening = openingOf(group.entries, group.key);
                      if (opening !== undefined) setChosen(opening.resource.id);
                      setManaging(false);
                      props.heart?.onActivate(false);
                    }}
                    onClose={
                      group.entries.every((entry) => entry.declared)
                        ? undefined
                        : () => unpickLanguage(group.key)
                    }
                    languageKey={group.key}
                    showIcon={tight() < 2}
                  />
                )}
              </For>
            </div>
            <Show
              when={tight() > 0}
              fallback={
                <>
                  <Popover
                    label={t("Add a reference language")}
                    side="bottom"
                    align="start"
                    variant="menu"
                    class="w-96 p-0"
                    fitViewport
                    open={managing()}
                    onOpenChange={manage}
                    trigger={
                      <Button
                        variant="tertiary"
                        class="shrink-0 [&>svg]:shrink-0"
                        data-testid="reference-add"
                      >
                        <Plus aria-hidden="true" />
                        {t("Add")}
                      </Button>
                    }
                  >
                    <LanguageList />
                  </Popover>
                  {props.trailing}
                </>
              }
            >
              {/* Short of room: Split/Join and the language list behind one "…". */}
              <Popover
                label={t("More")}
                side="bottom"
                align="start"
                variant="menu"
                class="w-96 p-0"
                fitViewport
                open={managing()}
                onOpenChange={manage}
                trigger={
                  <IconButton
                    variant="quiet"
                    class="shrink-0"
                    data-testid="reference-more"
                    label={t("More")}
                    icon={<MoreHorizontal />}
                  />
                }
              >
                <Show when={props.trailing !== undefined}>
                  <div class="flex border-b border-surface-border px-2 py-2">{props.trailing}</div>
                </Show>
                <LanguageList />
              </Popover>
            </Show>
            {/* The heart language, flush right: gateways, then Add and Split,
                then the one being refined at the far end. */}
            <Show when={props.heart}>
              {(heart) => (
                <div class="ms-auto flex min-w-0">
                  <LanguageTab
                    testId="language-tab-heart"
                    showIcon={tight() < 2}
                    name={heart().name}
                    code={heart().code}
                    refining
                    active={heart().active}
                    onSelect={() => {
                      setManaging(false);
                      heart().onActivate(true);
                    }}
                  />
                </div>
              )}
            </Show>
          </div>
        </Show>
        <Show when={fetching() !== ""}>
          <p role="status" class="text-small text-on-surface-secondary">
            {t("Getting {language}…", { language: fetching() })}
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
          <Show when={!loading() && props.heart?.active !== true}>
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
          <div
            class={props.heart?.active === true ? "hidden" : "flex min-h-0 flex-1 flex-col gap-3"}
          >
            <Show when={props.variant === "panel"}>
              <ResourcePicker resource={held.entry.resource} />
            </Show>
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
      <Show when={props.editor !== undefined}>
        {/* Hidden rather than unmounted, so switching tabs keeps the
            editor's place; the reference pane above does the same. */}
        <div class={props.heart?.active === true ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          {props.editor}
        </div>
      </Show>
    </aside>
  );
}
