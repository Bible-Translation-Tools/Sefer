import { anchorFrom, type ChapterRow, type EditorBook, type ProjectionName } from "@sefer/editor";
import type { Book, BookId } from "@sefer/text/book";
import { addressCode, chaptersAddress, type Address } from "@sefer/text/location/address";
import { addressAt, resolve } from "@sefer/text/location/locate";
import type { SourceStamp } from "@sefer/text/source";
import type { UseNavigateResult } from "@tanstack/solid-router";
import { Effect, Fiber, Option, Result, Stream } from "effect";
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js";

import { ProjectAnalysis, type BookSummary } from "#core/analysis/projectAnalysis";
import type { Finding } from "#core/findings/finding";
import { navigateTarget } from "#core/findings/findings";
import type { Inventory } from "#core/findings/inventory";
import type { Rung } from "#core/findings/suppressions";
import * as Fixes from "#core/fixes/fixes";
import { tocViewOf } from "#core/galley";
import { Repositories } from "#core/git/repository";
import type { SettingKey } from "#core/host/settings";
import { Observability } from "#core/observability";
import { openProject as openProjectEffect, type Project } from "#core/project/project";
import { mintSlug } from "#core/project/slug";
import { DEFAULT_JOURNAL_POLICY, type Restorable } from "#core/recovery/recovery";
import { pendingOnOpen } from "#core/recovery/reopen";
import { highestVersions } from "#core/resources/relationships";
import { SaveCoordinator } from "#core/save/saveCoordinator";
import { detectHost } from "#platform/host";

import { registerShellCommands, type ShellBridge } from "./commands";
import { useComposition } from "./CompositionContext";
import { editsReported } from "./editReports";
import { t } from "./i18n";
import { createResourceHandles, type ResourceHandles } from "./kinds/handles";
import { registerLegacyMarkers } from "./legacyMarkers";
import { createLocation, type Location } from "./location";
import { registerProjectCommands } from "./projectCommands";
import { noteRenamed } from "./projectNames";
import { composeServices, fixtureRequested, type Services } from "./services";
import {
  shellKeys,
  REFERENCE_WIDTH,
  SIDEBAR_WIDTH,
  type LastLocation,
  type LastLocations,
  type RecentProjects,
} from "./settings";
import type { ShellEvent } from "./shellEvent";
import { makeShellStores, type SaveState } from "./shellStores";
import { sousValues } from "./sousSettings";
import { makeSuppressionStore } from "./suppressions";
import { checkForChanges } from "./syncActions";
import { syncPreferences } from "./syncSettings";
import { syncWatch } from "./syncWatch";
import { applyEditorFontSize } from "./ui/theme";
import * as Workflows from "./workflows/references";

export type { SaveState } from "./shellStores";

export type RevealAt = "top" | "centre";

export interface Reveal {
  readonly bookId: BookId;
  readonly from: number;
  readonly to?: number;
  readonly at?: RevealAt;
}

export interface Shell {
  readonly services: Services;
  readonly project: Accessor<Project | undefined>;
  readonly openProject: (root: string) => Promise<void>;
  readonly recoveryOffer: Accessor<readonly Restorable[] | undefined>;
  readonly setRecoveryOffer: (offer: readonly Restorable[]) => void;
  readonly closeProject: () => Promise<void>;

  readonly focused: Accessor<EditorBook | undefined>;
  readonly focus: (bookId: BookId | undefined) => Promise<void>;

  readonly unsaved: (book: Book) => boolean;

  readonly saveState: (book: Book) => SaveState;
  readonly noteWritten: (bookIds: readonly BookId[], recorded: boolean) => void;

  readonly mode: Accessor<ProjectionName>;
  readonly setMode: (mode: ProjectionName) => void;
  readonly chapter: Accessor<number | null>;
  readonly setChapter: (ordinal: number | null) => void;
  readonly preferChapterView: Accessor<boolean>;

  readonly aim: (bookId: BookId, from: number, to?: number, at?: RevealAt) => void;
  readonly reveal: Accessor<Reveal | undefined>;

  readonly showChapter: (ordinal: number) => void;

  readonly showReference: (address: Address) => void;

  readonly location: Location;

  readonly openProjectAtStart: (root: string) => void;

  readonly caret: Accessor<number | undefined>;

  readonly noteCaret: (offset: number | undefined) => void;

  readonly place: Accessor<Address | undefined>;

  readonly resources: ResourceHandles;

  readonly noteChapterAtTop: (ordinal: number, place?: LastLocation["place"]) => void;

  readonly lastLocation: (root: string) => LastLocation | undefined;

  readonly finding: Accessor<Finding | undefined>;

  readonly findings: Accessor<readonly Finding[]>;
  readonly findingsPending: Accessor<boolean>;

  readonly suppressedFindings: Accessor<readonly Finding[]>;
  readonly suppress: (finding: Finding, rung: Rung) => Promise<boolean>;
  readonly unsuppress: (id: string) => Promise<boolean>;
  readonly suppressedBy: (finding: Finding) => Rung | undefined;

  readonly changed: (event: ShellEvent) => void;

  readonly report: (message: string) => void;
  readonly paletteOpen: Accessor<boolean>;
  readonly setPaletteOpen: (open: boolean) => void;

  readonly findingCounts: Accessor<{ readonly errors: number; readonly warnings: number }>;

  readonly summaryOf: (bookId: BookId) => BookSummary | undefined;

  readonly bookCensus: Accessor<readonly BookSummary[]>;

  readonly inventory: Accessor<Inventory>;

  readonly stampOf: (bookId: BookId) => SourceStamp | undefined;

  readonly historyDepth: Accessor<{ readonly undo: number; readonly redo: number }>;
  readonly chapterCount: Accessor<number>;

  readonly outline: Accessor<readonly ChapterRow[]>;

  readonly sidebarOpen: Accessor<boolean>;
  readonly setSidebarOpen: (open: boolean) => void;
  readonly sidebarShowing: Accessor<boolean>;
  readonly sidebarWidth: Accessor<number>;
  readonly setSidebarWidth: (fraction: number) => void;
  readonly referenceWidth: Accessor<number>;
  readonly setReferenceWidth: (fraction: number) => void;
  readonly referenceOpen: Accessor<boolean>;
  readonly setReferenceOpen: (open: boolean) => void;
  readonly recentProjects: Accessor<readonly RecentProject[]>;

  readonly slugFor: (root: string) => string;
  readonly slug: Accessor<string>;
  readonly rootForSlug: (slug: string) => string | undefined;
  readonly updateAvailable: Accessor<boolean>;
}

export type Navigate = UseNavigateResult<string>;

export interface RecentProject {
  readonly root: string;
  readonly name: string;
  readonly at: string;
}

interface Ready {
  readonly kind: "ready";
  readonly shell: Shell;
}

interface Failed {
  readonly kind: "failed";
  readonly reason: string;
}

export type ShellState = Ready | Failed | { readonly kind: "building" };

interface ShellHandle {
  readonly state: Accessor<ShellState>;
  readonly shell: () => Shell;
}

const ShellContext = createContext<ShellHandle | undefined>(undefined);

const handle = (): ShellHandle => {
  const held = useContext(ShellContext);
  if (held === undefined) throw new Error("useShell() must be called inside a <ProjectProvider>");
  return held;
};

export const useShellState = (): Accessor<ShellState> => handle().state;

export const useShell = (): Shell => handle().shell();

export const useServices = (): Services => useShell().services;

export const readyShell = (state: ShellState): Shell | undefined =>
  state.kind === "ready" ? state.shell : undefined;

const NO_CHAPTERS: readonly ChapterRow[] = Object.freeze([]);

const makeShell = (services: Services, navigate: Navigate): Shell => {
  const [project, setProject] = createSignal<Project | undefined>(undefined, { name: "project" });
  const [focused, setFocused] = createSignal<EditorBook | undefined>(undefined, {
    name: "focusedBook",
  });
  const [mode, setMode] = createSignal<ProjectionName>("default", { name: "mode" });
  const [pendingPlace, setPendingPlace] = createSignal<Address | undefined>(undefined, {
    name: "pendingPlace",
  });
  const [chapter, setChapter] = createSignal<number | null>(null, { name: "chapter" });
  const [landOnOpen, setLandOnOpen] = createSignal<string | undefined>(undefined, {
    name: "landOnOpen",
  });
  const location = createLocation(project);

  let live: Project | undefined;

  let unwatchSeats: (() => void) | undefined;
  onCleanup(() => unwatchSeats?.());

  const edits = {
    held: new Map<BookId, () => void>(),
    follow(bookId: BookId): void {
      edits.held.get(bookId)?.();
      edits.held.delete(bookId);
      const book = services.seated(bookId);
      if (book === undefined) return;
      edits.held.set(
        bookId,
        book.changes(() => {
          if (editsReported(bookId)) return;
          services.projectAnalysis.invalidate(bookId);
          changed({ kind: "book.apply", books: [bookId] });
        }),
      );
    },
  };
  const watchSeatedEdits = (): (() => void) => () => {
    for (const stop of edits.held.values()) stop();
    edits.held.clear();
  };
  const [paletteOpen, setPaletteOpen] = createSignal(false, { name: "paletteOpen" });
  const [cursor, setCursor] = createSignal(0, { name: "findingCursor" });
  const [reveal, setReveal] = createSignal<Reveal | undefined>(undefined, { name: "reveal" });

  const keys = shellKeys(services.settings);
  const [preferChapterView, setPreferChapterView] = createSignal(
    services.settings.get(keys.preferChapterView),
    { name: "preferChapterView" },
  );
  const watching = services.runtime.runFork(
    Stream.runForEach(services.settings.changes(keys.preferChapterView), (on) =>
      Effect.sync(() => setPreferChapterView(on)),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(watching));
  });

  const retime = (idleMs: number): Effect.Effect<void> =>
    services.recovery.setPolicy({
      idleMs,
      maxIntervalMs: Math.max(idleMs * 10, DEFAULT_JOURNAL_POLICY.maxIntervalMs),
    });
  const backing = services.runtime.runFork(
    Effect.flatMap(retime(services.settings.get(keys.backupIdleMs)), () =>
      Stream.runForEach(services.settings.changes(keys.backupIdleMs), retime),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(backing));
  });

  let copying = sousValues(services.settings.get(keys.sousSettings)).source_copy;
  services.galley.setSettings(sousValues(services.settings.get(keys.sousSettings)));
  const judging = services.runtime.runFork(
    Stream.runForEach(services.settings.changes(keys.sousSettings), (overrides) =>
      Effect.sync(() => {
        const next = sousValues(overrides);
        services.galley.setSettings(next);
        changed({ kind: "corpus.rejudge" });
        const project = live;
        const resend = next.source_copy && !copying && project !== undefined;
        copying = next.source_copy;
        if (!resend) {
          services.projectAnalysis.rejudge();
          return;
        }
        void services
          .run(Workflows.bindReferences(project.root, { fresh: true }))
          .then(() => services.projectAnalysis.rejudge());
      }),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(judging));
  });

  applyEditorFontSize(services.settings.get(keys.editorFontSize));
  const sizing = services.runtime.runFork(
    Stream.runForEach(services.settings.changes(keys.editorFontSize), (px) =>
      Effect.sync(() => applyEditorFontSize(px)),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(sizing));
  });

  const justMinted = new Map<string, string>();
  const slugFor = (root: string): string => {
    const held = { ...services.settings.get(keys.projectSlugs), ...Object.fromEntries(justMinted) };
    const minted = mintSlug(root, held);
    if (held[minted] !== root) {
      justMinted.set(minted, root);
      void services.run(
        Effect.ignore(services.settings.set(keys.projectSlugs, { ...held, [minted]: root })),
      );
    }
    return minted;
  };

  const slug = (): string => {
    const root = project()?.root;
    return root === undefined ? "" : slugFor(root);
  };

  const rootForSlug = (slug: string): string | undefined =>
    justMinted.get(slug) ?? services.settings.get(keys.projectSlugs)[slug];

  const asRows = (held: RecentProjects): readonly RecentProject[] =>
    Object.entries(held)
      .map(([root, at]) => ({ root, at, name: root.slice(root.lastIndexOf("/") + 1) || root }))
      .sort((left, right) => right.at.localeCompare(left.at));
  const [recentProjects, setRecentProjects] = createSignal<readonly RecentProject[]>(
    asRows(services.settings.get(keys.recentProjects)),
    { name: "recentProjects", equals: false },
  );
  const recents = services.runtime.runFork(
    Stream.runForEach(services.settings.changes(keys.recentProjects), (held) =>
      Effect.sync(() => setRecentProjects(asRows(held))),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(recents));
  });

  const [sidebarOpen, setSidebarOpen] = createSignal(services.settings.get(keys.sidebarOpen), {
    name: "sidebarOpen",
  });
  const [sidebarWidth, setSidebarWidth] = createSignal(services.settings.get(keys.sidebarWidth), {
    name: "sidebarWidth",
  });
  const [referenceWidth, setReferenceWidth] = createSignal(
    services.settings.get(keys.referenceWidth),
    { name: "referenceWidth" },
  );
  const [referenceOpen, setReferenceOpen] = createSignal(
    services.settings.get(keys.referenceOpen),
    { name: "referenceOpen" },
  );

  const [locations, setLocations] = createSignal<LastLocations>(
    services.settings.get(keys.lastLocation),
    { name: "lastLocations", equals: false },
  );

  const persist = <S,>(key: SettingKey<S>, value: S): void => {
    void services.run(Effect.result(services.settings.set(key, value)));
  };

  let widthWrite: ReturnType<typeof setTimeout> | undefined;
  let referenceWrite: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (widthWrite !== undefined) clearTimeout(widthWrite);
    if (referenceWrite !== undefined) clearTimeout(referenceWrite);
  });

  const [updateAvailable, setUpdateAvailable] = createSignal(false, { name: "updateAvailable" });
  if (detectHost() === "tauri") {
    const askAt = setTimeout(() => {
      void services
        .run(services.updater.check())
        .then((answer) => setUpdateAvailable(answer._tag === "Available"))
        .catch(() => setUpdateAvailable(false));
    }, 5000);
    onCleanup(() => clearTimeout(askAt));
  }

  const report = (message: string): void => {
    services.composition.observability.note("shell.report", "consumed", message);
  };

  const stores = makeShellStores({ services, open: () => live });
  const {
    changed,
    noteWritten,
    unsaved,
    saveState,
    stampOf,
    findings,
    findingsPending,
    findingCounts,
    summaryOf,
    bookCensus,
    inventory,
  } = stores;
  const suppressions = makeSuppressionStore({ services, changed });
  const suppressedFindings = (): readonly Finding[] => {
    findings();
    return services.projectAnalysis.suppressed();
  };

  const outline = createMemo<readonly ChapterRow[]>(
    () => {
      const book = focused();
      if (book === undefined) return NO_CHAPTERS;
      stampOf(book.id);
      return book.structure().chapters;
    },
    { name: "outline" },
  );

  const finding = (): Finding | undefined => {
    const list = findings();
    return list.length === 0 ? undefined : list[cursor() % list.length];
  };

  const [recoveryOffer, setRecoveryOffer] = createSignal<readonly Restorable[] | undefined>(
    undefined,
    { name: "recoveryOffer" },
  );

  const closeProject = async (): Promise<void> => {
    const staticOpen = untrack(() => project());
    setRecoveryOffer(undefined);
    unwatchSeats?.();
    unwatchSeats = undefined;
    live = undefined;
    setFocused(undefined);
    setProject(undefined);
    resources.releaseAll();
    suppressions.clear();
    stores.clear();
    if (staticOpen === undefined) return;
    const closing = services.composition.observability.operation("project.close", {
      "project.books": staticOpen.books.length,
    });
    await services.run(Effect.flatMap(Repositories, (lanes) => lanes.close(staticOpen.root)));
    await services.run(Effect.provideService(staticOpen.close(), Observability, closing));
    await services.run(services.save.forget());
    closing.end("passed");
  };

  let opening: { readonly root: string; readonly done: Promise<void> } | undefined;

  const openProject = (root: string): Promise<void> => {
    if (opening !== undefined && opening.root === root) return opening.done;
    const done = openProjectOnce(root).finally(() => {
      if (opening?.root === root) opening = undefined;
    });
    opening = { root, done };
    return done;
  };

  const openProjectOnce = async (root: string): Promise<void> => {
    await closeProject();
    const gesture = services.composition.observability.operation("project.open", {
      "project.root": root,
      "op.trigger": "shell",
    });
    const opened = await services.run(
      Effect.provideService(
        Effect.result(openProjectEffect(root, { seat: services.seat })),
        Observability,
        gesture,
      ),
    );
    if (Result.isFailure(opened)) {
      gesture.end("failed", { "project.error": opened.failure.reason });
      report(t("could not open {root}: {reason}", { root, reason: opened.failure.reason }));
      return;
    }
    const ready = opened.success;
    if (services.settings.get(keys.offerRecovery)) {
      void services
        .run(pendingOnOpen(services.recovery, ready.id, (text) => services.galley.hash(text)))
        .then(
          (found) => {
            if (opening?.root === root || live === ready) setRecoveryOffer(found);
          },
          () => setRecoveryOffer([]),
        );
    } else setRecoveryOffer([]);
    const started = performance.now();
    const legacy = registerLegacyMarkers(services.galley, function* () {
      for (const book of ready.books) yield book.source().text;
    });
    gesture.note("project.legacy_markers", "ready", undefined, {
      "project.legacy_markers": legacy.markers.map((m) => m.name).join(",") || "none",
      "project.legacy_refused": legacy.refused.length,
      "project.legacy_scan_ms": Math.round((performance.now() - started) * 1000) / 1000,
    });
    await services.run(
      Effect.provideService(
        Effect.gen(function* () {
          const coordinator = yield* SaveCoordinator;
          yield* Effect.forEach(ready.books, (book) => coordinator.adopt(book), {
            discard: true,
          });
          const analysis = yield* ProjectAnalysis;
          yield* Effect.promise(() => suppressions.load(root));
          yield* analysis.attach(ready, { first: lastLocation(root)?.bookId });
        }),
        Observability,
        gesture,
      ),
    );
    gesture.end("ready", { "project.books": ready.books.length });
    live = ready;
    void suppressions.prune();
    await services.run(
      services.library.declare(
        ready.root,
        Option.match(ready.metadata(), {
          onNone: () => [],
          onSome: (metadata) => highestVersions(metadata.related),
        }),
      ),
    );
    setProject(ready);
    setCursor(0);
    void services.run(services.admin.recordedName(root)).then((recorded) => {
      if (Option.isSome(recorded)) noteRenamed(root, recorded.value);
    });
    if (syncPreferences(services.settings, root).checkOnOpen) void checkForChanges(services, ready);
    else void syncWatch.refresh(services, ready).catch(() => undefined);
    const unwatchEdits = watchSeatedEdits();
    const unmountRecovery = services.recovery.mount(ready, (bookId) => {
      const book = ready.book(bookId);
      return book === undefined
        ? undefined
        : Option.getOrUndefined(services.save.baseline(book))?.hash;
    });
    const unwatchSwaps = ready.changed((bookId) => {
      edits.follow(bookId);
      changed({
        kind: services.seated(bookId) === undefined ? "seat.close" : "seat.open",
        books: [bookId],
      });
    });
    unwatchSeats = () => {
      unwatchSwaps();
      unwatchEdits();
      unmountRecovery();
    };
    changed({ kind: "project.open" });
    void services.run(Workflows.bindReferences(ready.root)).then((bound) => {
      const first = ready.books[0]?.id;
      if (live === ready && bound.ids.length > 0 && first !== undefined)
        services.projectAnalysis.invalidate(first);
    });
    report(t("opened {name} ({count} books)", { name: ready.root, count: ready.books.length }));
  };

  const openingChapter = (book: EditorBook, at: number | undefined): number | null => {
    if (!preferChapterView()) return null;
    if (at === undefined) return 0;
    const chapters = book.structure().chapters;
    let found = 0;
    for (const chapter of chapters) if (chapter.from <= at) found = chapter.ordinal;
    return found;
  };

  let honoured: Reveal | undefined;

  const focus = async (bookId: BookId | undefined): Promise<void> => {
    const staticProject = project();
    if (bookId === undefined || staticProject === undefined) {
      setFocused(undefined);
      return;
    }
    const seated = await services.run(
      Effect.gen(function* () {
        const book = yield* Effect.result(staticProject.instantiate(bookId));
        if (Result.isFailure(book)) return undefined;
        const coordinator = yield* SaveCoordinator;
        yield* coordinator.adopt(book.success);
        return book.success;
      }),
    );
    const editing = seated === undefined ? undefined : services.seated(bookId);
    if (editing === undefined) {
      report(t("could not open book {book}", { book: bookId }));
      return;
    }
    setFocused(editing);
    const aimed = reveal();
    const fresh = aimed !== undefined && aimed !== honoured && aimed.bookId === bookId;
    const at = fresh ? aimed.from : undefined;
    if (!fresh) setReveal(undefined);
    else honoured = aimed;

    const held = lastLocation(staticProject.root);
    const resume = at === undefined && held?.bookId === bookId ? held.at : undefined;

    const opening = openingChapter(editing, at);
    if (preferChapterView() && resume !== undefined) {
      setChapter(resume);
      remember(bookId, resume, resume);
      return;
    }
    setChapter(opening);
    remember(bookId, opening, resume);
  };

  let locationWrite: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (locationWrite !== undefined) clearTimeout(locationWrite);
  });

  const OFFSET_SETTLE = 250;
  let offsetWrite: ReturnType<typeof setTimeout> | undefined;

  const remember = (
    bookId: BookId | undefined,
    ordinal: number | null,
    at?: number,
    place?: LastLocation["place"],
  ): void => {
    const root = live?.root;
    if (root === undefined || bookId === undefined) return;
    // A writer, not a reader: a one-time read of the map it rewrites (Solid 2: STRICT_READ_UNTRACKED otherwise).
    const held = untrack(locations);
    const previous = held[root];
    const same = previous?.bookId === bookId;
    const carried = same ? previous.at : undefined;
    const where = at ?? carried;
    const where2 = place ?? (same ? previous.place : undefined);
    const next: LastLocations = {
      ...held,
      [root]: {
        bookId,
        chapter: ordinal,
        ...(where === undefined ? {} : { at: where }),
        ...(where2 === undefined ? {} : { place: where2 }),
      },
    };
    setLocations(next);
    if (locationWrite !== undefined) clearTimeout(locationWrite);
    locationWrite = setTimeout(() => {
      locationWrite = undefined;
      persist(keys.lastLocation, next);
    }, 400);
  };

  const [caret, setCaret] = createSignal<number | undefined>(undefined, { name: "caret" });

  const noteCaret = (offset: number | undefined): void => {
    setCaret(offset);
  };

  const place = createMemo(
    (held: Address | undefined): Address | undefined => {
      const at = caret();
      const book = focused();
      if (at === undefined || book === undefined) return undefined;
      const stamp = stampOf(book.id);
      const analysis = Option.getOrUndefined(services.projectAnalysis.analysis(book.id));
      if (stamp === undefined || analysis === undefined) return held;
      if (analysis.stamp.revision !== stamp.revision) return held;
      return addressAt(book.id, tocViewOf(analysis.analysis), at) ?? held;
    },
    {
      name: "place",
      equals: (a, b) =>
        a === b || (a !== undefined && b !== undefined && addressCode(a) === addressCode(b)),
    },
  );

  const resources = createResourceHandles(services);

  const noteChapterAtTop = (ordinal: number, place?: LastLocation["place"]): void => {
    // Records where the viewport got to: one-time snapshots, subscribing to nothing.
    const book = untrack(focused);
    if (book === undefined) return;
    const root = live?.root;
    if (root === undefined) return;
    const held = untrack(locations)[root];
    const sameBook = held?.bookId === book.id;
    const settled = held?.place?.chapter === place?.chapter && held?.place?.verse === place?.verse;
    if (sameBook && held.at === ordinal && settled) return;

    if (!sameBook || held.at !== ordinal) {
      if (offsetWrite !== undefined) {
        clearTimeout(offsetWrite);
        offsetWrite = undefined;
      }
      remember(book.id, untrack(chapter), ordinal, place);
      return;
    }

    if (offsetWrite !== undefined) clearTimeout(offsetWrite);
    offsetWrite = setTimeout(() => {
      offsetWrite = undefined;
      remember(book.id, untrack(chapter), ordinal, place);
    }, OFFSET_SETTLE);
  };

  const lastLocation = (root: string): LastLocation | undefined => locations()[root];

  const aim = (bookId: BookId, from: number, to?: number, at?: RevealAt): void => {
    setReveal({ bookId, from, to, at });
  };

  const showChapter = (ordinal: number): void => {
    const book = focused();
    if (book === undefined) return;
    remember(book.id, preferChapterView() ? ordinal : null, ordinal);
    if (preferChapterView()) {
      setChapter(ordinal);
      return;
    }
    const chapter = book.structure().chapters[ordinal];
    if (chapter === undefined) return;
    setChapter(null);
    aim(book.id, anchorFrom(chapter), undefined, "top");
  };

  const showReference = (address: Address): void => {
    if (project() === undefined) return;
    if (!location.holds(address.book)) {
      report(
        t("This project has no {book}", {
          book: location.label({ kind: "book", book: address.book }),
        }),
      );
      return;
    }
    if (address.kind !== "book") setPendingPlace(address);
    void navigate({
      to: "/project/$slug/book/$book",
      params: { slug: slug(), book: encodeURIComponent(address.book) },
    });
  };

  const openProjectAtStart = (root: string): void => {
    setLandOnOpen(root);
    void navigate({ to: "/project/$slug", params: { slug: slugFor(root) } });
  };

  createEffect(
    () => ({ open: project(), want: landOnOpen() }),
    ({ open, want }) => {
      if (open === undefined || want === undefined || open.root !== want) return;
      setLandOnOpen(undefined);
      const book = open.book("MAT") ?? open.books[0];
      if (book !== undefined) untrack(() => showReference(chaptersAddress(book.id, 1)));
    },
  );

  createEffect(
    () => ({ held: focused(), want: pendingPlace() }),
    ({ held, want }) => {
      if (want === undefined || held === undefined || held.id !== want.book) return;
      setPendingPlace(undefined);
      const analysis = held.structure().analysis;
      if (analysis == null) return;
      const place = (): string => location.label(want);
      untrack(() => {
        const found = resolve(tocViewOf(analysis), want);
        const chapters = held.structure().chapters;
        const ordinalAt = (offset: number): number =>
          chapters.findIndex((chapter) => chapter.from <= offset && offset < chapter.to);

        switch (found.kind) {
          case "found": {
            const at = ordinalAt(found.from);
            if (at >= 0) showChapter(at);
            if (want.kind === "verses") aim(held.id, found.from, undefined, "top");
            return;
          }
          case "missing": {
            if (found.within !== undefined) {
              const at = ordinalAt(found.within.from);
              if (at >= 0) showChapter(at);
            }
            report(t("{place} is not in this book", { place: place() }));
            return;
          }
          case "ambiguous": {
            const first = found.spans[0];
            if (first !== undefined) {
              const at = ordinalAt(first.from);
              if (at >= 0) showChapter(at);
              if (want.kind === "verses") aim(held.id, first.from, undefined, "top");
            }
            report(t("{place} appears more than once in this book", { place: place() }));
            return;
          }
        }
      });
    },
  );

  const stepFinding = (delta: 1 | -1): void => {
    const list = findings();
    if (list.length === 0) {
      report(t("no findings"));
      return;
    }
    const next = (cursor() + delta + list.length) % list.length;
    setCursor(next);
    const held = list[next];
    if (held === undefined) return;
    const target = navigateTarget(held);
    const held_project = project();
    if (held_project === undefined) return;
    aim(target.bookId, target.from);
    void navigate({
      to: "/project/$slug/book/$book",
      params: { slug: slugFor(held_project.root), book: encodeURIComponent(target.bookId) },
    });
    report(t("{code} at {from}", { code: held.code, from: target.from }));
  };

  const applyFix = (): void => {
    const held = finding();
    const book = focused();
    if (held === undefined || book === undefined) return;
    const analysis = Option.getOrUndefined(services.projectAnalysis.analysis(held.bookId));
    if (analysis === undefined) {
      report(t("no analysis for {book}", { book: held.bookId }));
      return;
    }
    const previewed = Fixes.preview(held, book, analysis.analysis);
    if (Result.isFailure(previewed)) {
      report(t("no fix: {reason}", { reason: previewed.failure.reason }));
      return;
    }
    const applied = Fixes.applyFix(previewed.success, book);
    report(
      Result.isSuccess(applied)
        ? t("applied {label}", { label: previewed.success.label })
        : t("refused by {rule}", { rule: applied.failure.rule }),
    );
    changed({ kind: "book.apply", books: [held.bookId] });
  };

  const shell: Shell = {
    services,
    project,
    openProject,
    recoveryOffer,
    setRecoveryOffer,
    closeProject,
    focused,
    focus,
    unsaved,
    saveState,
    changed,
    noteWritten,
    mode,
    setMode: (next) => {
      setMode(next);
    },
    chapter,
    setChapter: (ordinal) => {
      setChapter(ordinal);
      remember(focused()?.id, ordinal);
    },
    preferChapterView,
    aim,
    reveal,
    showChapter,
    showReference,
    openProjectAtStart,
    location,
    caret,
    noteCaret,
    place,
    resources,
    noteChapterAtTop,
    lastLocation,
    finding,
    findings,
    findingsPending,
    suppressedFindings,
    suppress: (target, rung) => suppressions.suppress(target, rung),
    unsuppress: (id) => suppressions.unsuppress(id),
    suppressedBy: (target) => suppressions.rungOf(target),
    report,
    paletteOpen,
    setPaletteOpen: (open) => {
      setPaletteOpen(open);
    },
    findingCounts,
    summaryOf,
    bookCensus,
    inventory,
    stampOf,
    historyDepth: () => {
      const book = focused();
      return book === undefined ? { undo: 0, redo: 0 } : stores.historyDepth(book.id);
    },
    chapterCount: () => outline().length,
    outline,
    sidebarOpen,
    setSidebarOpen: (open) => {
      setSidebarOpen(open);
      persist(keys.sidebarOpen, open);
    },
    sidebarShowing: () => sidebarOpen() && project() !== undefined,
    referenceOpen,
    setReferenceOpen: (open) => {
      setReferenceOpen(open);
      persist(keys.referenceOpen, open);
    },
    recentProjects,
    slugFor,
    slug,
    rootForSlug,
    updateAvailable,
    sidebarWidth,
    setSidebarWidth: (fraction) => {
      const clamped = Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, fraction));
      setSidebarWidth(clamped);
      if (widthWrite !== undefined) clearTimeout(widthWrite);
      widthWrite = setTimeout(() => {
        widthWrite = undefined;
        persist(keys.sidebarWidth, clamped);
      }, 400);
    },
    referenceWidth,
    setReferenceWidth: (fraction) => {
      const clamped = Math.min(REFERENCE_WIDTH.max, Math.max(REFERENCE_WIDTH.min, fraction));
      setReferenceWidth(clamped);
      if (referenceWrite !== undefined) clearTimeout(referenceWrite);
      referenceWrite = setTimeout(() => {
        referenceWrite = undefined;
        persist(keys.referenceWidth, clamped);
      }, 400);
    },
  };

  const bridge: ShellBridge = {
    services,
    slug: shell.slug,
    project: () => project(),
    focused: () => focused(),
    mode,
    setMode: shell.setMode,
    chapter,
    setChapter: shell.setChapter,
    chapterCount: shell.chapterCount,
    historyDepth: shell.historyDepth,
    stepFinding,
    applyFix,
    navigate,
    openProject,
    setPaletteOpen: shell.setPaletteOpen,
    sidebarOpen: shell.sidebarOpen,
    setSidebarOpen: shell.setSidebarOpen,
    aim,
    report,
    changed,
  };

  onCleanup(registerShellCommands(bridge));
  onCleanup(
    registerProjectCommands({
      services,
      root: () => project()?.root,
      ask: (root) => void navigate({ to: "/projects", search: { rename: root } }),
    }),
  );
  return shell;
};

export function ProjectProvider(props: ParentProps<{ readonly navigate: Navigate }>) {
  const composition = useComposition();
  const [state, setState] = createSignal<ShellState>({ kind: "building" }, { name: "shellState" });
  // Carried across the await below: the shell registers commands with onCleanup, outside any owner otherwise.
  const owner = getOwner();

  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  void composeServices(composition, { fixture: fixtureRequested() })
    .then((services) => {
      if (disposed) {
        void services.dispose();
        return;
      }
      // oxlint-disable-next-line solid/reactivity
      const shell = runWithOwner(owner, () => {
        onCleanup(() => {
          void services.dispose();
        });
        return makeShell(services, props.navigate);
      });
      if (shell === undefined) return;
      setState({ kind: "ready", shell });
    })
    .catch((cause: unknown) => {
      if (disposed) return;
      const reason = cause instanceof Error ? cause.message : String(cause);
      composition.observability.note("shell.services", "refused", reason);
      setState({ kind: "failed", reason });
    });

  const held: ShellHandle = {
    state,
    // Untracked: the shell is built once and never replaced, so this reads a constant.
    shell: () => {
      const now = untrack(state);
      if (now.kind !== "ready")
        throw new Error(`useShell() while the shell is ${now.kind}; gate on useShellState()`);
      return now.shell;
    },
  };

  return <ShellContext value={held}>{props.children}</ShellContext>;
}
