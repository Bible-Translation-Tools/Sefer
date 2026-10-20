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
 * drift. The whole column can be shut from the editor's crumb strip
 * (`shell.referenceOpen`), or folded here to a stack of cards, one per text.
 *
 * Which text is on show is the "Reference language" menu above the pane. In
 * order: the texts on this device — what the project has picked or declares,
 * then the Library's own copies, scripture before helps (the PO's two words:
 * source texts, reference material) — then, folded away, the reader's other
 * projects (a neighbouring heart language reads well beside a translation;
 * Will, 2026-10-08), then reference material — the Translation Notes the
 * Language API lists, one per language, and nothing else (Will, 2026-10-15)
 * — then the catalogue's other gateway languages, to download. A download
 * lands in the Library's folder through `arrival.ts`, never the projects
 * folder, and is then picked. This menu is the one place notes are offered:
 * they are not on the projects page.
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
import Globe from "lucide-solid/icons/globe";
import Heart from "lucide-solid/icons/heart";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import Plus from "lucide-solid/icons/plus";
import Trash from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { Observability } from "#core/observability";
import { remoteVerdict } from "#core/remote/remote";
import { answers, type Resource, type Role } from "#core/resources/library";
import {
  highestVersions,
  normaliseRepoUrl,
  type RelatedResource,
} from "#core/resources/relationships";

import { announceSourceTexts, libraryRevision, sourceTextCopy } from "../../arrival";
import {
  catalogueFor,
  gatewayTexts,
  listTranslationNotes,
  type CatalogueEntry,
  type HelpText,
} from "../../catalogue";
import { describe, remoteReasonOf } from "../../describe";
import { t } from "../../i18n";
import { downloadHelp, helpDownloads, removeHelp } from "../../kinds/download";
import { KIND_ROLES, roleFor } from "../../kinds/table";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { ResourceCard, ResourcePane } from "../kinds/registry";
import { flyCard } from "../landing/downloads";
import { listProjects, type ProjectSummary } from "../landing/summaries";
import {
  Button,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  MenuLabel,
  Popover,
  cx,
} from "../primitives";

/**
 * The roles the column shows, in the order it shows them: every role some
 * kind is picked under (`app/kinds/table.ts`), scripture's first.
 */
const ROLES: readonly Role[] = KIND_ROLES;

interface Entry {
  readonly resource: Resource;
  readonly role: Role;
  /** Shown because the project declares it, not because anyone picked it. */
  readonly declared: boolean;
}

/** Scripture is picked as a source text; everything else is reference material. */
const isBible = (resource: Resource): boolean => roleFor(resource) === "source";

/** "English", from a language tag; the tag itself when the browser does not know it. */
const languageName = (code: string | undefined): string | undefined => {
  if (code === undefined || code === "") return undefined;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** The catalogue's Translation Notes, as far as the menu has read them. */
type HelpsRead =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly rows: readonly HelpText[] }
  /** `offline`: the request never reached the API (`fetch` rejects with a `TypeError`). */
  | { readonly state: "failed"; readonly offline: boolean };

export interface ReferenceColumnProps {
  /**
   * How many resources are bound, reported as it changes. The ROUTE owns the
   * split, and a split with nothing to show in it collapses to the picker —
   * which is a layout decision about the row, so the row is told rather than
   * asking the Library a second time.
   */
  readonly onBound?: (count: number) => void;
  /**
   * Folded to its cards, or open: the ROUTE narrows the column for the cards,
   * as it does when nothing is bound.
   */
  readonly onFolded?: (folded: boolean) => void;
  /**
   * `panel`: Refine's language panels, a design tweak. Every text the project
   * shows is a TAB, one on show at a time, and "+" is the language menu; no
   * fold, no column padding. `column` otherwise.
   */
  readonly variant?: "column" | "panel";
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
}) {
  const closable = (): boolean => props.onClose !== undefined;
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
        <Show
          when={props.refining === true}
          fallback={<Globe aria-hidden="true" class="size-5 shrink-0" />}
        >
          <Heart aria-hidden="true" class="size-5 shrink-0" />
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
  /** The Library's own copies on this device: source texts and reference material. */
  const [copies, setCopies] = createSignal<readonly Resource[]>([], { name: "referenceCopies" });
  /** The reader's other projects, read when the menu first opens. */
  const [projects, setProjects] = createSignal<readonly ProjectSummary[] | undefined>(undefined, {
    name: "referenceProjects",
  });
  /** The catalogue's gateway texts, read when the menu first opens. */
  const [gateways, setGateways] = createSignal<readonly CatalogueEntry[] | undefined>(undefined, {
    name: "referenceGateways",
  });
  /**
   * The Translation Notes the catalogue lists, read when the menu first
   * opens; read again on the next open after a failure.
   */
  const [notes, setNotes] = createSignal<HelpsRead | undefined>(undefined, {
    name: "referenceNotes",
  });
  /** Declared source texts with no copy on this device. */
  const [missing, setMissing] = createSignal<readonly RelatedResource[]>([], {
    name: "referenceMissing",
  });
  const [busy, setBusy] = createSignal(false, { name: "referenceBusy" });
  /** What is being fetched right now, said in the column while it is. */
  const [fetching, setFetching] = createSignal("", { name: "referenceFetching" });
  /** Raised by a pick, so the bindings re-resolve. */
  const [bound, setBound] = createSignal(0, { name: "referenceBound" });

  // Named here rather than called from inside the resolve's `.then`, where a
  // bare `props.onBound` is a reactive read the Solid lint flags — correctly,
  // since a promise callback is not a tracked scope. The prop is a setter that
  // never changes; this is the one-line way to say so.
  const report = (count: number): void => props.onBound?.(count);

  /** What the open project declares as its source texts, at the version to hold. */
  const declared = (): readonly RelatedResource[] =>
    Option.match(shell.project()?.metadata() ?? Option.none(), {
      onNone: (): readonly RelatedResource[] => [],
      onSome: (metadata) => highestVersions(metadata.related),
    });

  /**
   * The BINDINGS, and nothing about the passage.
   *
   * It does not re-run on scroll: a pane holds the whole book, so the only
   * things that can change what is on screen here are the project, the open
   * book and a pick — and each of those is a reason to rebuild the pane
   * rather than to update it.
   */
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
        .run(
          Effect.gen(function* () {
            const picked = new Set(
              (yield* services.library.picked(project)).map((each) => each.resource.id),
            );
            const found: Entry[] = [];
            for (const role of ROLES)
              for (const resource of yield* services.library.resolve(project, role))
                found.push({ resource, role, declared: !picked.has(resource.id) });
            const held = yield* services.library.resources();
            const absent = declared.filter(
              (ref) => !held.some((resource) => answers(resource, ref)),
            );
            const library = held.filter((resource) =>
              resource.root.startsWith(`${services.libraryRoot}/`),
            );
            return { found, absent, library };
          }),
        )
        // oxlint-disable-next-line solid/reactivity -- a promise continuation: runs once, when the bindings resolve
        .then(({ found, absent, library }) => {
          setEntries(found);
          setMissing(absent);
          setCopies(library);
          setLoading(false);
          report(found.length);
        });
    },
  );

  /**
   * Where the reader is, as a chapter NUMBER rather than an ordinal.
   *
   * The ordinal is an index into the OPEN book's chapter table, whose row 0 is
   * the front matter; the reference is a different file of the same book and
   * may count its rows differently. `\c`'s own label is the one thing the two
   * texts are guaranteed to agree about, so it is what crosses the gap.
   */
  const numberAt = (ordinal: number | null | undefined): number | undefined => {
    const book = shell.focused();
    if (book === undefined || ordinal === undefined || ordinal === null) return undefined;
    const label = book.structure().chapters[ordinal]?.label ?? "";
    const numbered = Number.parseInt(label, 10);
    return Number.isNaN(numbered) ? undefined : numbered;
  };

  /** The chapter the editor is CLIPPED to, if it is clipped at all. */
  const clip = (): number | null => numberAt(shell.chapter()) ?? null;

  /**
   * The other projects and the catalogue's gateway texts, read once, the
   * first time the menu opens: a directory listing and a network read, whose
   * answers only change when someone imports on another screen.
   */
  const offer = (): void => {
    if (projects() === undefined) {
      const recent = services.settings.get(shellKeys(services.settings).recentProjects);
      void services
        .run(listProjects(services.projectsRoot, services.fixtureProject, recent))
        .then(setProjects);
    }
    if (gateways() === undefined)
      void catalogueFor(services.settings)
        .entries()
        .then(({ rows }) => setGateways(gatewayTexts(rows)))
        .catch(() => setGateways([]));
    const read = notes();
    if (read === undefined || read.state === "failed") {
      setNotes({ state: "loading" });
      void listTranslationNotes()
        .then((rows) => setNotes({ state: "ready", rows }))
        .catch((cause: unknown) =>
          setNotes({
            state: "failed",
            offline: cause instanceof TypeError || globalThis.navigator?.onLine === false,
          }),
        );
    }
  };

  /** On this device: what the project shows, then the Library's copies, scripture first. */
  const installed = (): readonly Resource[] => {
    const seen = new Map<string, Resource>();
    for (const entry of entries()) seen.set(entry.resource.id, entry.resource);
    for (const resource of [...copies().filter(isBible), ...copies().filter((r) => !isBible(r))])
      if (!seen.has(resource.id)) seen.set(resource.id, resource);
    return [...seen.values()];
  };

  /** The reader's projects that are not the open one and not already on show. */
  const otherProjects = (): readonly ProjectSummary[] => {
    const open = shell.project()?.root;
    return (projects() ?? []).filter(
      (row) => row.root !== open && !installed().some((resource) => resource.root === row.root),
    );
  };

  /**
   * Gateway texts with no copy on this device, by the URL they would be
   * cloned from. English first for a project that declares no source text.
   */
  const downloadable = (): readonly CatalogueEntry[] => {
    const held = new Set(
      copies().flatMap((resource) =>
        resource.upstream === undefined ? [] : [normaliseRepoUrl(resource.upstream.url)],
      ),
    );
    const offered = (gateways() ?? []).filter((entry) => !held.has(normaliseRepoUrl(entry.gitUrl)));
    if (declared().length > 0) return offered;
    return [
      ...offered.filter((entry) => entry.code === "en"),
      ...offered.filter((entry) => entry.code !== "en"),
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

  /** Which text the column shows, by resource id; the first when none was chosen. */
  const [chosen, setChosen] = createSignal<string | undefined>(undefined, {
    name: "referenceShown",
  });

  /** Picks `resource` for this project if it is not already on show, then shows it. */
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

  /**
   * Registers another project with the Library (`add` is idempotent — it
   * re-reads the metadata and replaces the entry), then shows it.
   */
  const showProject = (row: ProjectSummary): void => {
    setBusy(true);
    void services
      .run(Effect.result(services.library.add(row.root)))
      // oxlint-disable-next-line solid/reactivity -- a promise continuation: runs once, when the project is registered
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

  /** Downloads in flight from the panel's language list, by catalogue id or repository. */
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

  /**
   * Downloads a gateway text into the Library (once per device), then shows
   * it — or, from the panel's language list (`keep`), leaves it there to Add.
   */
  const fetchText = (entry: CatalogueEntry, keep = false): void => {
    const name = entry.anglicizedName || entry.naturalName;
    const operation = services.composition.observability.operation("import.remote", {
      "import.source": "reference",
      "import.host": services.hostInfo.kind(),
      "catalogue.type": entry.type,
    });
    if (keep) pull(entry.id, true);
    else {
      setBusy(true);
      setFetching(name);
    }
    void services
      .run(
        Effect.provideService(
          sourceTextCopy(services, entry.gitUrl, entry.id),
          Observability,
          operation,
        ),
      )
      // oxlint-disable-next-line solid/reactivity -- a promise continuation: runs once, when the copy is here
      .then((resource) => {
        operation.end("passed", { "import.phase": "complete" });
        if (!keep) show(resource);
      })
      .catch((cause: unknown) => {
        operation.end(remoteVerdict(remoteReasonOf(cause)));
        shell.report(t("could not add {name}: {reason}", { name, reason: describe(cause) }));
      })
      .finally(() => {
        if (keep) pull(entry.id, false);
        else {
          setBusy(false);
          setFetching("");
        }
      });
  };

  /** Reference material in the Library's own folder: what Remove may take off this device. */
  const heldHelps = (): readonly Resource[] => copies().filter((resource) => !isBible(resource));

  /**
   * The Translation Notes this device does not hold yet, A–Z by language as
   * the catalogue gives them. Held means the same URL, or notes in the same
   * language: a device with `WycliffeAssociates/en_tn` is not offered
   * `WA-Catalog/en_tn` as a second English (Will, 2026-10-15; their book
   * folders are the same git trees).
   */
  const helps = (): readonly HelpText[] => {
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

  /** Takes downloaded notes off this device; the pickers re-read when the Library says so. */
  const removeNotes = (resource: Resource): void => {
    if (chosen() === resource.id) setChosen(undefined);
    void removeHelp(services, resource);
  };

  /** Why the notes list could not be read, while that is the last word. */
  const notesFailure = () => {
    const read = notes();
    return read?.state === "failed" ? read : undefined;
  };

  /** Downloads reference material into the Library (once per device), then shows it. */
  const fetchHelp = (help: HelpText, keep = false): void => {
    if (!keep) {
      setBusy(true);
      setFetching(
        t("Translation Notes · {language}", { language: help.languageName || help.language }),
      );
    }
    void downloadHelp(services, help)
      // oxlint-disable-next-line solid/reactivity -- a promise continuation: runs once, when the copy is here
      .then((resource) => {
        if (!keep) show(resource);
      })
      // The toast has said why; nothing more to do here.
      .catch(() => undefined)
      .finally(() => {
        if (keep) return;
        setBusy(false);
        setFetching("");
      });
  };

  /** Pulls the declared source texts that are not here, then shows them. */
  const download = (): void => {
    const project = shell.project();
    if (project === undefined) return;
    setBusy(true);
    void announceSourceTexts(services, project.root).finally(() => {
      setBusy(false);
      setBound((held) => held + 1);
    });
  };

  /**
   * The ONE pane, and the book it reads: a different text, or a different
   * book, is a new pane. Compared by ids so a re-resolve that finds the same
   * text does not rebuild the editor inside it.
   */
  type Shown = { readonly entry: Entry; readonly book: string } | undefined;
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

  /** "English (en)", or the title when the text names no language. */
  const nameOf = (resource: Resource | undefined): string => {
    if (resource === undefined) return "";
    const name = languageName(resource.language);
    if (name === undefined) return resource.title;
    // Reference material says what it is: "English (en)" alone would not tell
    // a language's notes from its scripture.
    return isBible(resource)
      ? `${name} (${resource.language ?? ""})`
      : `${resource.title} · ${name} (${resource.language ?? ""})`;
  };

  /** Folded to a stack of cards, one per installed text. */
  const [folded, setFolded] = createSignal(false, { name: "referenceFolded" });
  const fold = (next: boolean): void => {
    setFolded(next);
    props.onFolded?.(next);
  };

  const [showProjects, setShowProjects] = createSignal(false, { name: "referenceShowProjects" });
  const [showOthers, setShowOthers] = createSignal(false, { name: "referenceShowOthers" });
  const [showHelps, setShowHelps] = createSignal(false, { name: "referenceShowHelps" });
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
  /** Rows: 48px, 24px sides; the menu's own 8px plus 4px here is 12px above and below. */
  const ROW = "px-6";

  /** A folded group's header row: its name and count, and the way to open it. */
  const GroupToggle = (groupProps: {
    readonly testId: string;
    readonly label: string;
    readonly open: boolean;
    readonly onToggle: () => void;
  }) => (
    // A menu row the arrow keys reach, like the rows it opens; pressing it
    // folds or unfolds the group and leaves the menu open.
    <button
      type="button"
      role="menuitem"
      tabindex={-1}
      data-testid={groupProps.testId}
      aria-expanded={groupProps.open ? "true" : "false"}
      class={`${ROW} flex h-12 w-full cursor-pointer items-center gap-3 text-start text-small font-semibold text-on-surface-primary outline-none hover:bg-surface-secondary focus-visible:bg-surface-secondary`}
      onClick={() => groupProps.onToggle()}
    >
      <span class="min-w-0 flex-1">{groupProps.label}</span>
      <Show when={groupProps.open} fallback={<ChevronDown aria-hidden="true" class="size-5" />}>
        <ChevronUp aria-hidden="true" class="size-5" />
      </Show>
    </button>
  );

  /** A row's two lines: what it is called, and what it is. */
  const RowText = (rowProps: { readonly name: string; readonly detail?: string }) => (
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="truncate">{rowProps.name}</span>
      <Show when={rowProps.detail !== undefined && rowProps.detail !== rowProps.name}>
        <span class="truncate text-smallest text-on-surface-tertiary">{rowProps.detail}</span>
      </Show>
    </span>
  );

  /**
   * The reference language: what is on this device, and below it, folded
   * away, the reader's other projects and the gateway languages to download.
   */
  const LanguagePicker = (pickerProps: { readonly trigger?: JSX.Element }) => (
    <Menu
      label={t("Reference language")}
      // Folded again each time it opens: the texts on this device come first.
      onOpenChange={(open) => {
        if (!open) return;
        setShowProjects(false);
        setShowOthers(false);
        setShowHelps(false);
        offer();
      }}
      side="bottom"
      align="start"
      class="w-80"
      fitViewport
      trigger={
        pickerProps.trigger ?? (
          <button
            type="button"
            data-testid="reference-language"
            disabled={busy()}
            class="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-2xl bg-surface-primary p-3 text-start transition-colors hover:bg-surface-secondary disabled:cursor-wait"
          >
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="text-small text-on-surface-secondary">{t("Reference language")}</span>
              <span class="truncate text-small font-semibold text-on-surface-primary">
                {fetching() === ""
                  ? nameOf(shown()?.entry.resource) || t("None yet")
                  : t("Getting {language}…", { language: fetching() })}
              </span>
            </span>
            <ChevronDown aria-hidden="true" class="size-5 shrink-0 text-on-surface-primary" />
          </button>
        )
      }
    >
      <div class="scrollbar-padded max-h-[min(60vh,25.5rem)] overflow-y-auto py-1">
        <For each={installed()}>
          {(resource) => (
            <MenuItem class={ROW} onSelect={() => show(resource)}>
              <RowText name={nameOf(resource)} detail={resource.title} />
              <Show when={shown()?.entry.resource.id === resource.id}>
                <Check aria-label={t("Showing")} class="size-5 shrink-0 text-brand" />
              </Show>
            </MenuItem>
          )}
        </For>
        <Show when={otherProjects().length > 0}>
          <GroupToggle
            testId="reference-other-projects"
            label={t("Your other projects ({count})", { count: otherProjects().length })}
            open={showProjects()}
            onToggle={() => setShowProjects(!showProjects())}
          />
          <Show when={showProjects()}>
            <For each={otherProjects()}>
              {(row) => (
                <MenuItem
                  class={ROW}
                  data-testid={`pick-${row.folder}`}
                  onSelect={() => showProject(row)}
                >
                  <RowText name={row.name} detail={languageName(row.language) ?? row.language} />
                </MenuItem>
              )}
            </For>
          </Show>
        </Show>
        {/* Shown while the list is read and when it could not be, so the
            group does not appear from nowhere, nor vanish without a word. */}
        <Show
          when={
            notes() !== undefined &&
            (notes()?.state !== "ready" || helps().length > 0 || heldHelps().length > 0)
          }
        >
          <GroupToggle
            testId="reference-material"
            label={
              notes()?.state === "ready"
                ? t("Reference material ({count})", {
                    count: heldHelps().length + helps().length,
                  })
                : t("Reference material")
            }
            open={showHelps()}
            onToggle={() => setShowHelps(!showHelps())}
          />
          <Show when={showHelps()}>
            <div role="group" aria-label={t("Translation Notes")} data-testid="reference-notes">
              <MenuLabel inset={ROW}>{t("Translation Notes")}</MenuLabel>
              {/* On this device first, each with Remove. Not a MenuItem: the
                  row itself does nothing (choosing it is in the list above),
                  and Remove leaves the menu open so the row is seen to go. */}
              <For each={heldHelps()}>
                {(resource) => (
                  <div
                    class={`${ROW} flex min-h-12 items-center gap-3 text-small text-on-surface-primary`}
                    data-testid="reference-held-notes"
                    data-language={resource.language}
                  >
                    <RowText
                      name={`${languageName(resource.language) ?? resource.title} (${resource.language ?? ""})`}
                      detail={t("On this device")}
                    />
                    <button
                      type="button"
                      role="menuitem"
                      tabindex={-1}
                      data-testid="reference-remove-notes"
                      title={t("Remove {title} from this device", {
                        title: nameOf(resource),
                      })}
                      class="flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-small text-on-surface-secondary outline-none hover:bg-surface-secondary focus-visible:bg-surface-secondary"
                      onClick={() => removeNotes(resource)}
                    >
                      <Trash aria-hidden="true" class="size-4" />
                      {t("Remove")}
                    </button>
                  </div>
                )}
              </For>
              <Show when={notes()?.state === "loading"}>
                <p role="status" class={`${ROW} py-3 text-small text-on-surface-tertiary`}>
                  {t("Loading the list…")}
                </p>
              </Show>
              <Show when={notesFailure()}>
                {(failure) => (
                  <p role="status" class={`${ROW} py-3 text-small text-on-surface-tertiary`}>
                    {failure().offline
                      ? t("You are offline. Open this menu again to retry.")
                      : t("Could not read the list. Open this menu again to retry.")}
                  </p>
                )}
              </Show>
              <For each={helps()}>
                {(help) => (
                  <MenuItem
                    class={ROW}
                    data-testid={`pick-help-${help.repository}`}
                    title={t("Download {title} to read beside this project", {
                      title: t("Translation Notes · {language}", {
                        language: help.languageName || help.language,
                      }),
                    })}
                    onSelect={() => fetchHelp(help)}
                  >
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate">
                        {`${help.languageName || help.language} (${help.language})`}
                      </span>
                      <Show
                        when={help.nationalName !== "" && help.nationalName !== help.languageName}
                      >
                        <span
                          dir={help.direction}
                          class="truncate text-start text-smallest text-on-surface-tertiary"
                        >
                          {help.nationalName}
                        </span>
                      </Show>
                    </span>
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
            </div>
          </Show>
        </Show>
        <Show when={downloadable().length > 0}>
          <GroupToggle
            testId="reference-other-languages"
            label={t("Other languages ({count})", { count: downloadable().length })}
            open={showOthers()}
            onToggle={() => setShowOthers(!showOthers())}
          />
          <Show when={showOthers()}>
            <For each={downloadable()}>
              {(entry) => (
                <MenuItem
                  class={ROW}
                  data-testid={`pick-${entry.code}`}
                  title={t("Download {language} to read beside this project", {
                    language: entry.anglicizedName || entry.naturalName,
                  })}
                  onSelect={() => fetchText(entry)}
                >
                  <span class="min-w-0 flex-1 truncate">
                    {entry.anglicizedName || entry.naturalName}
                  </span>
                  <Download aria-hidden="true" class="size-5 shrink-0" />
                </MenuItem>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </Menu>
  );

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
    const toGet: Offer[] = downloadable().flatMap((entry): Offer[] => {
      const key = entry.code.toLowerCase();
      if (languages.has(key) || offered.has(key)) return [];
      offered.add(key);
      return [
        {
          kind: "download",
          key: entry.id,
          name: `${entry.anglicizedName || entry.naturalName} (${entry.code})`,
          download: () => fetchText(entry, true),
          pulling: () => pulling().has(entry.id),
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
  const ResourcePicker = (pickerProps: { readonly resource: Resource }) => {
    const key = (): string => languageOf(pickerProps.resource);
    const texts = (): readonly Resource[] =>
      installed().filter((each) => languageOf(each) === key());
    const notesHere = (): readonly HelpText[] =>
      helps().filter((help) => help.language.toLowerCase() === key());
    return (
      <Menu
        label={t("Resource")}
        onOpenChange={(open) => {
          if (open) offer();
        }}
        side="bottom"
        align="start"
        class="w-80"
        fitViewport
        trigger={
          <button
            type="button"
            data-testid="resource-picker"
            class="flex min-h-12 w-full max-w-sm cursor-pointer items-center gap-3 rounded-lg px-3 text-start text-small font-semibold text-on-surface-primary transition-colors hover:bg-surface-secondary"
          >
            <span class="min-w-0 flex-1 truncate">{pickerProps.resource.title}</span>
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
      <h3 class="px-4 pt-2 pb-1 text-smallest font-semibold text-on-surface-secondary">
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
      <h3 class="px-4 pt-2 pb-1 text-smallest font-semibold text-on-surface-secondary">
        {t("Available")}
      </h3>
      <Show when={gateways() === undefined}>
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

  return (
    <aside
      ref={setAside}
      aria-label={t("Reference texts")}
      class={
        props.variant === "panel"
          ? "flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3"
          : "flex h-full min-w-0 flex-col gap-3 py-4 pe-[7.5px]"
      }
      data-references={entries().length}
    >
      <Show
        when={!folded()}
        fallback={
          // Folded: one card per text on this device; pressing one opens the
          // column on it.
          <div class="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <For each={installed()}>
              {(resource) => (
                <ResourceCard
                  resource={resource}
                  bookId={shell.focused()?.id ?? ""}
                  language={languageName(resource.language) ?? resource.title}
                  onOpen={() => {
                    show(resource);
                    fold(false);
                  }}
                />
              )}
            </For>
          </div>
        }
      >
        <Show
          when={props.variant === "panel"}
          fallback={
            <div class="flex items-center gap-controls">
              <div class="min-w-0 flex-1">
                <LanguagePicker />
              </div>
              <IconButton
                variant="subtle"
                data-testid="reference-fold"
                label={t("Collapse the reference text")}
                icon={<PanelLeftClose />}
                onClick={() => fold(true)}
              />
            </div>
          }
        >
          <div
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
                  />
                )}
              </For>
              <Show when={props.heart}>
                {(heart) => (
                  <LanguageTab
                    testId="language-tab-heart"
                    name={heart().name}
                    code={heart().code}
                    refining
                    active={heart().active}
                    onSelect={() => {
                      setManaging(false);
                      heart().onActivate(true);
                    }}
                  />
                )}
              </Show>
            </div>
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
                <Button variant="tertiary" data-testid="reference-add">
                  <Plus aria-hidden="true" />
                  {t("Add")}
                </Button>
              }
            >
              <LanguageList />
            </Popover>
            {props.trailing}
          </div>
          <Show when={fetching() !== ""}>
            <p role="status" class="text-small text-on-surface-secondary">
              {t("Getting {language}…", { language: fetching() })}
            </p>
          </Show>
        </Show>

        {/* Only while nothing is picked: a person who chose a text has
            answered the question this row asks. */}
        <Show
          when={!loading() && missing().length > 0 && entries().every((entry) => entry.declared)}
        >
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

        {/* One text, straight on the page: the menu above says whose it is. */}
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
                followControl={props.variant !== "panel"}
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
      </Show>
    </aside>
  );
}
