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
 * drift. The panel is shown and hidden by the editor's "Show reference"
 * (`shell.referenceSplit`) and nowhere else: a second button here that folded
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
import ChevronDown from "lucide-solid/icons/chevron-down";
import CircleCheck from "lucide-solid/icons/circle-check";
import Download from "lucide-solid/icons/download";
import Globe from "lucide-solid/icons/globe";
import MoreVertical from "lucide-solid/icons/more-vertical";
import Pilcrow from "lucide-solid/icons/pilcrow";
import Search from "lucide-solid/icons/search";
import Trash from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import { Observability } from "#core/observability";
import { remoteVerdict } from "#core/remote/remote";
import { answers, type Resource, type Role } from "#core/resources/library";
import {
  highestVersions,
  normaliseRepoUrl,
  type RelatedResource,
} from "#core/resources/relationships";

import { announceSourceTexts, libraryRevision, ownerAndRepo, sourceTextCopy } from "../../arrival";
import { listSourceTexts, listTranslationNotes, type ListedText } from "../../catalogue";
import { findCommand, runCommandAndWait } from "../../commands";
import { describe, remoteReasonOf } from "../../describe";
import { downloadRuns } from "../../downloadRuns";
import { downloadHelp, helpDownloads, removeHelp } from "../../kinds/download";
import { KIND_ROLES, roleFor } from "../../kinds/table";
import { uiLocale } from "../../locale";
import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { ResourcePane } from "../kinds/registry";
import { listProjects, type ProjectSummary } from "../landing/summaries";
import { Button, EmptyState, IconButton, Input, Menu, MenuItem, Popover, cx } from "../primitives";

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

type Shown = { readonly entry: Entry; readonly book: string } | undefined;

const ROW = "px-6";

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

/**
 * The reference panel: one split dropdown, language then text, over the text
 * on show.
 */
export function ReferenceColumn() {
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
            m.workspace_could_not_add_name_reason({
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
  /** Resolves to whether the text arrived; a failure is said to the person here. */
  const fetchBible = (text: ListedText, keep = false): Promise<boolean> => {
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
    return (
      services
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
          return true;
        })
        .catch((cause: unknown) => {
          operation.end(remoteVerdict(remoteReasonOf(cause)));
          shell.report(m.workspace_could_not_add_name_reason({ name, reason: describe(cause) }));
          return false;
        })
        .finally(() => {
          if (keep) pull(text.repository, false);
          else {
            setBusy(false);
            setFetching("");
          }
        })
    );
  };

  const heldHelps = (): readonly Resource[] => copies().filter((resource) => !isBible(resource));

  /**
   * Deletes every Library copy in a language from this device (Thomas,
   * 2026-11-16); showing one, the panel falls back to what is left. The
   * reader's own projects in it stay: they are not the Library's to delete.
   */
  const removeLanguage = (key: string): void => {
    for (const resource of copies()) {
      if (languageOf(resource) !== key) continue;
      if (!resource.root.startsWith(`${services.libraryRoot}/`)) continue;
      if (chosen() === resource.id) setChosen(undefined);
      void removeHelp(services, resource);
    }
  };

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

  const fetchHelp = (help: ListedText): Promise<boolean> => {
    setBusy(true);
    setFetching(
      m.workspace_translation_notes_language({ language: help.languageName || help.language }),
    );
    return (
      downloadHelp(services, help)
        // oxlint-disable-next-line solid/reactivity
        .then((resource) => {
          show(resource);
          return true;
        })
        .catch(() => false)
        .finally(() => {
          setBusy(false);
          setFetching("");
        })
    );
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

  /**
   * One language in the dropdown: an accordion whose body is every resource
   * in it (Thomas, 2026-11-16). Held languages list what is on this device
   * first, then what there is to fetch in the same language; a language
   * still to download lists each of its resources, each downloaded on its own
   * for now (one-click "whole language" is an open question for paisano).
   */
  type Item =
    | {
        readonly kind: "text";
        readonly key: string;
        readonly name: string;
        readonly resource: Resource;
        /** `owner/repo`, when another text in the language has the same name. */
        readonly detail?: string;
      }
    | {
        readonly kind: "project";
        readonly key: string;
        readonly name: string;
        readonly row: ProjectSummary;
      }
    | {
        readonly kind: "fetch";
        readonly key: string;
        readonly name: string;
        readonly download: () => Promise<boolean>;
        readonly pulling: () => boolean;
      };
  type Language = { readonly key: string; readonly name: string; readonly items: readonly Item[] };
  const byName = (a: Language, b: Language): number => a.name.localeCompare(b.name);

  /**
   * What a text is by name — its shorthand (`ulb`), else its title; notes
   * are all one. Held and offered copies with the same name are one text,
   * whichever repository either came from.
   */
  const shortName = (resource: Resource): string =>
    isBible(resource) ? (resource.abbreviation ?? resource.title).toLowerCase() : "notes";
  const fetchItems = (key: string): Item[] => [
    ...offeredBibles()
      .filter(
        (text) =>
          text.language.toLowerCase() === key &&
          !installed().some(
            (resource) =>
              languageOf(resource) === key && shortName(resource) === text.title.toLowerCase(),
          ),
      )
      .map((text): Item => ({
        kind: "fetch",
        key: text.repository,
        name: text.title,
        download: () => fetchBible(text, true),
        pulling: () => pulling().has(text.repository),
      })),
    ...helps()
      .filter((help) => help.language.toLowerCase() === key)
      .map((help): Item => ({
        kind: "fetch",
        key: help.repository,
        name: m.reference_shelf_notes(),
        download: () => fetchHelp(help),
        pulling: () => helpDownloads().has(help.repository),
      })),
  ];

  /** The two groups: on this device, and to download, each A–Z by language. */
  const languages = createMemo(
    (): { readonly held: readonly Language[]; readonly toGet: readonly Language[] } => {
      const held = new Map<string, Item[]>();
      const add = (key: string, item: Item): void => {
        held.set(key, [...(held.get(key) ?? []), item]);
      };
      // One row per repository: the project's copy and a downloaded copy of
      // the SAME repository are one text, the first (the project's, as
      // `installed` lists it) standing for both. Two repositories are two
      // rows even when they share a name (Will, 2026-11-17): WA's ULB and
      // another organisation's can differ, so each says whose it is.
      const seen = new Set<string>();
      const texts: Resource[] = [];
      for (const resource of installed()) {
        const same =
          resource.upstream === undefined ? resource.id : normaliseRepoUrl(resource.upstream.url);
        if (seen.has(same)) continue;
        seen.add(same);
        texts.push(resource);
      }
      const nameOf = (resource: Resource): string =>
        isBible(resource) ? resource.title : m.reference_shelf_notes();
      const named = (resource: Resource): string => `${languageOf(resource)}:${nameOf(resource)}`;
      const counts = new Map<string, number>();
      for (const resource of texts)
        counts.set(named(resource), (counts.get(named(resource)) ?? 0) + 1);
      for (const resource of texts) {
        const upstream = resource.upstream;
        const shared = (counts.get(named(resource)) ?? 0) > 1;
        const whose = shared && upstream !== undefined ? ownerAndRepo(upstream.url) : undefined;
        add(languageOf(resource), {
          kind: "text",
          key: resource.id,
          name: nameOf(resource),
          resource,
          ...(whose === undefined ? {} : { detail: `${whose.owner}/${whose.repo}` }),
        });
      }
      for (const row of otherProjects())
        add(projectLanguageOf(row), { kind: "project", key: row.root, name: row.name, row });
      const heldList = [...held].map(([key, items]): Language => ({
        key,
        name: languageLabel(key),
        items: [...items, ...fetchItems(key)],
      }));
      const toGet = new Set<string>();
      for (const text of [...offeredBibles(), ...helps()]) {
        const key = text.language.toLowerCase();
        if (!held.has(key)) toGet.add(key);
      }
      const toGetList = [...toGet].map((key): Language => ({
        key,
        name: languageLabel(key),
        items: fetchItems(key),
      }));
      return { held: heldList.sort(byName), toGet: toGetList.sort(byName) };
    },
    { name: "referenceLanguages" },
  );

  /**
   * The filter at the top of the dropdown (Will, 2026-11-17): it narrows
   * both groups, by language name, tag or a resource's name; the groups stay.
   */
  const [filter, setFilter] = createSignal("", { name: "referenceFilter" });
  const passes = (language: Language): boolean => {
    const wanted = filter().trim().toLowerCase();
    if (wanted === "") return true;
    return [language.name, language.key, ...language.items.map((item) => item.name)].some((said) =>
      said.toLowerCase().includes(wanted),
    );
  };
  const heldShown = createMemo(() => languages().held.filter(passes), {
    name: "referenceHeldShown",
  });
  const toGetShown = createMemo(() => languages().toGet.filter(passes), {
    name: "referenceToGetShown",
  });

  /** Which languages are open in the dropdown; the one on show opens with it. */
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "referenceExpanded",
  });
  const toggle = (key: string): void => {
    setExpanded((held) => {
      const next = new Set(held);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  /** The language of the text on show, if one is. */
  const shownLanguage = (): string | undefined => {
    const held = shown();
    return held === undefined ? undefined : languageOf(held.entry.resource);
  };
  /** The split dropdown's language list, open or shut. */
  const [managing, setManaging] = createSignal(false, { name: "referenceManaging" });
  const manage = (open: boolean): void => {
    setManaging(open);
    if (!open) return;
    setFilter("");
    offer();
    const key = shownLanguage();
    setExpanded(new Set(key === undefined ? [] : [key]));
  };
  /** A listing still on its way: nothing read yet, or the read in flight. */
  const listing = (read: Listing | undefined): boolean =>
    read === undefined || read.state === "loading";

  /**
   * A download from this list is the same machine as any other
   * (`src/core/remote/download.ts`): for two seconds the row reads
   * "Starting…" and pressing it again calls it off, since nothing has been
   * fetched yet. Once the clone has begun it runs to the end.
   */
  const asked = new Set<string>();
  const startSoon = (key: string, download: () => Promise<boolean>): void => {
    asked.add(key);
    downloadRuns.ask(key, async () => {
      if (!(await download())) throw new Error("the download did not arrive");
    });
  };
  // Leaving the screen inside the window calls the download off too.
  onCleanup(() => {
    for (const key of asked) downloadRuns.cancel(key);
  });
  const starting = (key: string): boolean => downloadRuns.of(key).kind === "pending";

  const ROW_BUTTON =
    "flex w-full cursor-pointer items-center gap-3 text-start text-small transition-colors hover:bg-surface-secondary disabled:cursor-default disabled:hover:bg-transparent";

  /** One resource under an open language: show it, or fetch it. */
  const FetchRow = (rowProps: { readonly item: Extract<Item, { kind: "fetch" }> }) => {
    const item = rowProps.item; // oxlint-disable-line solid/reactivity -- a row is rebuilt with its list
    return (
      <button
        type="button"
        data-testid={`reference-fetch-${item.key}`}
        aria-label={
          starting(item.key)
            ? m.reference_download_cancel({ name: item.name })
            : m.reference_download_named({ name: item.name })
        }
        disabled={item.pulling()}
        class={cx(ROW_BUTTON, "py-3 ps-6 pe-3 text-on-surface-primary")}
        onClick={() => {
          if (starting(item.key)) downloadRuns.cancel(item.key);
          else startSoon(item.key, () => item.download());
        }}
      >
        <span class="min-w-0 flex-1 break-words">{item.name}</span>
        <Show
          when={item.pulling()}
          fallback={
            <Show
              when={starting(item.key)}
              fallback={<Download aria-hidden="true" class="size-5 shrink-0" />}
            >
              <span class="flex shrink-0 items-center gap-1.5 text-on-surface-secondary">
                {m.common_starting()}
                <X aria-hidden="true" class="size-5" />
              </span>
            </Show>
          }
        >
          {/* No byte count to show, so the bar runs until the copy lands. */}
          <span
            role="progressbar"
            aria-label={m.common_downloading_name({ name: item.name })}
            class="relative h-2 w-16 shrink-0 overflow-hidden rounded-full bg-surface-secondary"
          >
            <span class="absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-brand" />
          </span>
        </Show>
      </button>
    );
  };

  const HeldRow = (rowProps: { readonly item: Exclude<Item, { kind: "fetch" }> }) => {
    const item = rowProps.item; // oxlint-disable-line solid/reactivity -- a row is rebuilt with its list
    const current = (): boolean =>
      item.kind === "text" && shown()?.entry.resource.id === item.resource.id;
    return (
      <div class="flex items-center">
        <button
          type="button"
          aria-current={current() ? "true" : undefined}
          class={cx(
            ROW_BUTTON,
            "py-3 ps-6 pe-3 text-on-surface-primary aria-[current]:font-medium aria-[current]:text-brand",
          )}
          onClick={() => {
            if (item.kind === "text") show(item.resource);
            else if (item.kind === "project") showProject(item.row);
            setManaging(false);
          }}
        >
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="break-words">{item.name}</span>
            <Show when={item.kind === "text" ? item.detail : undefined}>
              {(detail) => (
                <span class="break-all text-caption text-on-surface-tertiary">({detail()})</span>
              )}
            </Show>
          </span>
          <Show when={current()}>
            <CircleCheck aria-label={m.reference_showing()} class="size-5 shrink-0" />
          </Show>
        </button>
      </div>
    );
  };

  /** A language's accordion: its name, where it is, and its resources when open. */
  const LanguageRow = (rowProps: { readonly language: Language; readonly held: boolean }) => {
    const open = (): boolean => expanded().has(rowProps.language.key);
    const active = (): boolean => rowProps.held && shownLanguage() === rowProps.language.key;
    return (
      <li
        data-testid={`gateway-language-${rowProps.language.key}`}
        class="border-b border-surface-border last:border-b-0"
      >
        <div class="flex items-center">
          <button
            type="button"
            aria-expanded={open() ? "true" : "false"}
            class={cx(ROW_BUTTON, "p-3", rowProps.held && "pe-1")}
            onClick={() => {
              toggle(rowProps.language.key);
            }}
          >
            <span class="flex min-w-0 flex-1 flex-col">
              <span
                class={cx(
                  "break-words font-medium",
                  active() ? "text-brand" : "text-on-surface-primary",
                )}
              >
                {rowProps.language.name}
              </span>
              <span class="truncate text-caption text-on-surface-tertiary">
                {rowProps.held ? m.reference_installed() : m.reference_available()}
              </span>
            </span>
            <Show when={!rowProps.held}>
              <Download aria-hidden="true" class="size-5 shrink-0" />
            </Show>
          </button>
          <Show when={rowProps.held}>
            {/* What can be done to the language as a whole; the chevron opens it. */}
            <Menu
              label={m.reference_language_actions({ name: rowProps.language.name })}
              side="bottom"
              align="end"
              class="w-64"
              fitViewport
              trigger={
                <IconButton
                  data-testid="reference-language-menu"
                  label={m.reference_language_actions({ name: rowProps.language.name })}
                  icon={<MoreVertical />}
                />
              }
            >
              <MenuItem
                class={ROW}
                disabled
                title={m.reference_import_soon()}
                onSelect={() => undefined}
              >
                {m.reference_check_updates()}
              </MenuItem>
              <MenuItem
                class={ROW}
                disabled
                title={m.reference_import_soon()}
                onSelect={() => undefined}
              >
                {m.reference_export_language()}
              </MenuItem>
              <MenuItem
                class={ROW}
                data-testid="reference-remove-language"
                icon={<Trash aria-hidden="true" />}
                onSelect={() => removeLanguage(rowProps.language.key)}
              >
                {m.reference_remove_language()}
              </MenuItem>
            </Menu>
            <button
              type="button"
              tabindex="-1"
              aria-hidden="true"
              class="flex h-12 shrink-0 cursor-pointer items-center pe-3 ps-1"
              onClick={() => {
                toggle(rowProps.language.key);
              }}
            >
              <ChevronDown class={cx("size-5 transition-transform", open() && "rotate-180")} />
            </button>
          </Show>
        </div>
        <Show when={open()}>
          <ul class="pb-2">
            <For each={rowProps.language.items}>
              {(item) => (
                <li>
                  <Show
                    when={item.kind === "fetch" ? item : undefined}
                    // SAFETY: the `when` above took every "fetch" item, so this one is not.
                    fallback={<HeldRow item={item as Exclude<Item, { kind: "fetch" }>} />}
                  >
                    {(fetch) => <FetchRow item={fetch()} />}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </li>
    );
  };

  const GROUP_HEAD = "flex items-center gap-3 p-3 text-small font-semibold text-on-surface-primary";

  /**
   * Formatting: one control (Thomas, 2026-11-16; Will, 2026-11-17). It
   * matches every book's formatting to the Bible on show here, so the ¶
   * acts on the text beside it. Format book and Format project stay in the
   * command palette.
   */
  const FormatButton = () => {
    // A whole project takes a moment; the ¶ turns while it runs (Will, 2026-11-17).
    const [matching, setMatching] = createSignal(false, { name: "referenceMatching" });
    const bible = (): Resource | undefined => {
      const entry = shown()?.entry;
      return entry !== undefined && entry.role === "source" ? entry.resource : undefined;
    };
    return (
      <IconButton
        data-testid="toolbar-overlay"
        label={
          bible() === undefined
            ? m.refine_formatting()
            : m.reference_match_formatting_to({ name: bible()!.title })
        }
        icon={
          <Show when={matching()} fallback={<Pilcrow />}>
            <span
              role="status"
              aria-label={m.common_loading()}
              class="size-5 animate-spin rounded-full border-2 border-on-surface-tertiary border-t-transparent"
            />
          </Show>
        }
        aria-busy={matching() ? "true" : undefined}
        disabled={
          matching() ||
          bible() === undefined ||
          findCommand("overlay.project")?.available() !== true
        }
        onClick={() => {
          const resource = bible();
          if (resource === undefined) return;
          setMatching(true);
          void runCommandAndWait("overlay.project", resource.id).finally(() => setMatching(false));
        }}
      />
    );
  };

  const GatewayPicker = () => (
    <div data-testid="gateway-picker" class="flex w-full shrink-0 items-center gap-controls">
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
          <button
            type="button"
            data-testid="gateway-language"
            class="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg bg-surface-primary p-3 text-start text-small text-on-surface-primary transition-colors hover:bg-surface-secondary"
          >
            <Globe aria-hidden="true" class="size-5 shrink-0" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate font-semibold">
                {(() => {
                  const key = shownLanguage();
                  return key === undefined ? m.reference_choose_language() : nameOfLanguage(key);
                })()}
              </span>
              <Show when={shown()}>
                {(held) => (
                  <span class="truncate text-caption text-on-surface-tertiary">
                    {held().entry.resource.title}
                  </span>
                )}
              </Show>
            </span>
            <ChevronDown aria-hidden="true" class="size-5 shrink-0" />
          </button>
        }
      >
        <div
          data-testid="language-list"
          class="scrollbar-padded flex max-h-[min(70vh,32rem)] flex-col overflow-y-auto py-2"
        >
          <div class="px-3 pb-2">
            <Input
              data-testid="reference-filter"
              wrapperClass="w-full"
              type="search"
              value={filter()}
              placeholder={m.reference_filter_languages()}
              aria-label={m.reference_filter_languages()}
              icon={<Search aria-hidden="true" />}
              onInput={(event) => setFilter(event.currentTarget.value)}
            />
          </div>
          <h3 class={GROUP_HEAD}>{m.reference_installed_count({ count: heldShown().length })}</h3>
          <ul>
            <For each={heldShown()}>{(language) => <LanguageRow language={language} held />}</For>
          </ul>
          {/* The two groups read as two (Will, 2026-11-17): the panel's 2px rule between them. */}
          <span aria-hidden="true" class="my-3 block h-0.5 shrink-0 bg-surface-border" />
          <div class={GROUP_HEAD}>
            <h3 class="min-w-0 flex-1">
              {m.reference_available_count({ count: toGetShown().length })}
            </h3>
            {/* Sideloading a reference text has no flow yet; the place is held for it. */}
            <button
              type="button"
              data-testid="reference-import"
              disabled
              title={m.reference_import_soon()}
              class="font-medium text-brand underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              {m.reference_import()}
            </button>
          </div>
          <Show when={listing(bibles())}>
            <p class="p-3 text-small text-on-surface-tertiary">{m.reference_list_loading()}</p>
          </Show>
          <ul>
            <For each={toGetShown()}>
              {(language) => <LanguageRow language={language} held={false} />}
            </For>
          </ul>
        </div>
      </Popover>
      <FormatButton />
    </div>
  );

  return (
    <aside
      aria-label={m.workspace_reference_texts()}
      class="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3"
      data-references={entries().length}
    >
      <GatewayPicker />
      <Show when={fetching() !== ""}>
        <p role="status" class="text-small text-on-surface-secondary">
          {m.common_getting_language({ language: fetching() })}
        </p>
      </Show>

      <Show when={!loading() && missing().length > 0 && entries().every((entry) => entry.declared)}>
        <div
          data-testid="declared-missing"
          class="flex shrink-0 flex-col gap-1.5 rounded-md bg-surface-secondary px-3 py-2 text-small"
        >
          <p class="text-on-surface-secondary">
            {m.workspace_this_projects_source_text_is({
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
            {m.common_download()}
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
                  ? m.workspace_no_source_text_yet()
                  : m.common_getting_language({ language: fetching() })
              }
              description={
                fetching() === ""
                  ? m.workspace_choose_a_reference_language_above()
                  : m.workspace_downloading_it_once_to_read()
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
              followControl={false}
            />
          </div>
        )}
      </Show>
    </aside>
  );
}
