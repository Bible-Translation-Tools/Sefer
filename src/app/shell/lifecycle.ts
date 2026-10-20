import type { EditorBook } from "@sefer/editor";
import type { BookId } from "@sefer/text/book";
import { Effect, Option, Result } from "effect";
import { createSignal, onCleanup, untrack, type Accessor, type Setter } from "solid-js";

import { ProjectAnalysis } from "#core/analysis/projectAnalysis";
import { Repositories } from "#core/git/repository";
import { Observability } from "#core/observability";
import { openProject as openProjectEffect, type Project } from "#core/project/project";
import type { Restorable } from "#core/recovery/recovery";
import { pendingOnOpen } from "#core/recovery/reopen";
import { highestVersions } from "#core/resources/relationships";
import { SaveCoordinator } from "#core/save/saveCoordinator";

import { editsReported } from "../editReports";
import { t } from "../i18n";
import type { ResourceHandles } from "../kinds/handles";
import { registerLegacyMarkers } from "../legacyMarkers";
import { noteRenamed } from "../projectNames";
import type { Services } from "../services";
import type { LastLocation, shellKeys } from "../settings";
import type { ShellStores } from "../shellStores";
import type { SuppressionStore } from "../suppressions";
import { checkForChanges } from "../syncActions";
import { syncPreferences } from "../syncSettings";
import { syncWatch } from "../syncWatch";
import * as Workflows from "../workflows/references";
import type { LiveProject } from "./types";

export interface LifecycleDeps {
  readonly services: Services;
  readonly keys: ReturnType<typeof shellKeys>;
  readonly stores: ShellStores;
  readonly suppressions: SuppressionStore;
  readonly resources: ResourceHandles;
  readonly project: Accessor<Project | undefined>;
  readonly setProject: Setter<Project | undefined>;
  readonly setFocused: Setter<EditorBook | undefined>;
  readonly setCursor: Setter<number>;
  readonly live: LiveProject;
  readonly report: (message: string) => void;
  readonly lastLocation: (root: string) => LastLocation | undefined;
}

export const createLifecycle = ({
  services,
  keys,
  stores,
  suppressions,
  resources,
  project,
  setProject,
  setFocused,
  setCursor,
  live,
  report,
  lastLocation,
}: LifecycleDeps) => {
  const { changed } = stores;

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

  const [recoveryOffer, setRecoveryOffer] = createSignal<readonly Restorable[] | undefined>(
    undefined,
    { name: "recoveryOffer" },
  );

  const closeProject = async (): Promise<void> => {
    const staticOpen = untrack(() => project());
    setRecoveryOffer(undefined);
    unwatchSeats?.();
    unwatchSeats = undefined;
    live.set(undefined);
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
            if (opening?.root === root || live.get() === ready) setRecoveryOffer(found);
          },
          () => setRecoveryOffer([]),
        );
    } else setRecoveryOffer([]);
    const started = performance.now();
    const legacy = registerLegacyMarkers(services.galley, function* () {
      for (const book of ready.books) yield book.source().text;
    });
    gesture.note("project.legacy_markers", "ready", undefined, {
      "project.legacy_markers": legacy.markers.map((marker) => marker.name).join(",") || "none",
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
    live.set(ready);
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
      if (live.get() === ready && bound.ids.length > 0 && first !== undefined)
        services.projectAnalysis.invalidate(first);
    });
    report(t("opened {name} ({count} books)", { name: ready.root, count: ready.books.length }));
  };

  return { recoveryOffer, setRecoveryOffer, closeProject, openProject };
};
