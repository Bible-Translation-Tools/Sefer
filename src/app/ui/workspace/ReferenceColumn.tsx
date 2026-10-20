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

import { Effect, Option, Result } from "effect";
import BookMarked from "lucide-solid/icons/book-marked";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import Download from "lucide-solid/icons/download";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import Trash from "lucide-solid/icons/trash-2";
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
import { listProjects, type ProjectSummary } from "../landing/summaries";
import { Button, EmptyState, IconButton, Menu, MenuItem, MenuLabel } from "../primitives";

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
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
};

type HelpsRead =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly rows: readonly HelpText[] }
  | { readonly state: "failed"; readonly offline: boolean };

export interface ReferenceColumnProps {
  readonly onBound?: (count: number) => void;
  readonly onFolded?: (folded: boolean) => void;
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
  const [gateways, setGateways] = createSignal<readonly CatalogueEntry[] | undefined>(undefined, {
    name: "referenceGateways",
  });
  const [notes, setNotes] = createSignal<HelpsRead | undefined>(undefined, {
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

  const removeNotes = (resource: Resource): void => {
    if (chosen() === resource.id) setChosen(undefined);
    void removeHelp(services, resource);
  };

  const notesFailure = () => {
    const read = notes();
    return read?.state === "failed" ? read : undefined;
  };

  const fetchHelp = (help: HelpText): void => {
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

  const nameOf = (resource: Resource | undefined): string => {
    if (resource === undefined) return "";
    const name = languageName(resource.language);
    if (name === undefined) return resource.title;
    return isBible(resource)
      ? `${name} (${resource.language ?? ""})`
      : `${resource.title} · ${name} (${resource.language ?? ""})`;
  };

  const [folded, setFolded] = createSignal(false, { name: "referenceFolded" });
  const fold = (next: boolean): void => {
    setFolded(next);
    props.onFolded?.(next);
  };

  const [showProjects, setShowProjects] = createSignal(false, { name: "referenceShowProjects" });
  const [showOthers, setShowOthers] = createSignal(false, { name: "referenceShowOthers" });
  const [showHelps, setShowHelps] = createSignal(false, { name: "referenceShowHelps" });
  const ROW = "px-6";

  const GroupToggle = (groupProps: {
    readonly testId: string;
    readonly label: string;
    readonly open: boolean;
    readonly onToggle: () => void;
  }) => (
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

  const RowText = (rowProps: { readonly name: string; readonly detail?: string }) => (
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="truncate">{rowProps.name}</span>
      <Show when={rowProps.detail !== undefined && rowProps.detail !== rowProps.name}>
        <span class="truncate text-smallest text-on-surface-tertiary">{rowProps.detail}</span>
      </Show>
    </span>
  );

  const LanguagePicker = () => (
    <Menu
      label={t("Reference language")}
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

  return (
    <aside
      aria-label={t("Reference texts")}
      class="flex h-full min-w-0 flex-col gap-3 py-4 pe-[7.5px]"
      data-references={entries().length}
    >
      <Show
        when={!folded()}
        fallback={
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
