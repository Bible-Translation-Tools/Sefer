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
 * Will, 2026-10-08), then the catalogue's other gateway languages, to
 * download. A download is a source text: it lands in the Library's folder
 * through `arrival.ts`, never the projects folder, and is then picked.
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
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
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
  HELP_TEXTS,
  type CatalogueEntry,
  type HelpText,
} from "../../catalogue";
import { describe, remoteReasonOf } from "../../describe";
import { t } from "../../i18n";
import { downloadHelp, helpUrl } from "../../kinds/download";
import { KIND_ROLES, roleFor } from "../../kinds/table";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { ResourceCard, ResourcePane } from "../kinds/registry";
import { listProjects, type ProjectSummary } from "../landing/summaries";
import { Button, EmptyState, IconButton, Menu, MenuItem } from "../primitives";

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

  /** Which text the column shows, by resource id; the first when none was chosen. */
  const [chosen, setChosen] = createSignal<string | undefined>(undefined, {
    name: "referenceShown",
  });

  /** Picks `resource` for this project if it is not already on show, then shows it. */
  const show = (resource: Resource): void => {
    const project = shell.project();
    if (project === undefined) return;
    setChosen(resource.id);
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

  /** Downloads a gateway text into the Library (once per device), then shows it. */
  const fetchText = (entry: CatalogueEntry): void => {
    const name = entry.anglicizedName || entry.naturalName;
    const operation = services.composition.observability.operation("import.remote", {
      "import.source": "reference",
      "import.host": services.hostInfo.kind(),
      "catalogue.type": entry.type,
    });
    setBusy(true);
    setFetching(name);
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

  /**
   * Reference material this device does not hold yet, by the URL it would be
   * cloned from: the helps the catalogue does not list (`HELP_TEXTS`).
   */
  const helps = (): readonly { readonly help: HelpText; readonly url: string }[] => {
    const held = new Set(
      copies().flatMap((resource) =>
        resource.upstream === undefined ? [] : [normaliseRepoUrl(resource.upstream.url)],
      ),
    );
    return HELP_TEXTS.flatMap((help) => {
      const url = helpUrl(services, help);
      return url === undefined || held.has(normaliseRepoUrl(url)) ? [] : [{ help, url }];
    });
  };

  /** Downloads reference material into the Library (once per device), then shows it. */
  const fetchHelp = (help: HelpText): void => {
    setBusy(true);
    setFetching(help.title);
    void downloadHelp(services, help)
      // oxlint-disable-next-line solid/reactivity -- a promise continuation: runs once, when the copy is here
      .then((resource) => show(resource))
      // The toast has said why; nothing more to do here.
      .catch(() => undefined)
      .finally(() => {
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
  const LanguagePicker = () => (
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
        <Show when={helps().length > 0}>
          <GroupToggle
            testId="reference-material"
            label={t("Reference material ({count})", { count: helps().length })}
            open={showHelps()}
            onToggle={() => setShowHelps(!showHelps())}
          />
          <Show when={showHelps()}>
            <For each={helps()}>
              {(entry) => (
                <MenuItem
                  class={ROW}
                  data-testid={`pick-help-${entry.help.repository}`}
                  title={t("Download {title} to read beside this project", {
                    title: entry.help.title,
                  })}
                  onSelect={() => fetchHelp(entry.help)}
                >
                  <RowText
                    name={entry.help.title}
                    detail={languageName(entry.help.language) ?? entry.help.language}
                  />
                  <Download aria-hidden="true" class="size-5 shrink-0" />
                </MenuItem>
              )}
            </For>
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

  return (
    <aside
      aria-label={t("Reference texts")}
      class="flex h-full min-w-0 flex-col gap-3 py-4 pe-[7.5px]"
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
      </Show>
    </aside>
  );
}
