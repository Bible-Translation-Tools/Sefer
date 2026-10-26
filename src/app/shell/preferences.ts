import { Effect, Fiber, Stream } from "effect";
import { createSignal, onCleanup } from "solid-js";

import type { SettingKey } from "#core/host/settings";
import type { Project } from "#core/project/project";
import { DEFAULT_JOURNAL_POLICY } from "#core/recovery/recovery";

import type { Services } from "../services";
import { PROJECTS_WIDTH, REFERENCE_WIDTH, SIDEBAR_WIDTH, type shellKeys } from "../settings";
import type { ShellEvent } from "../shellEvent";
import { sousValues } from "../sousSettings";
import { applyEditorFontSize } from "../ui/theme";
import * as Workflows from "../workflows/references";

export interface PreferencesDeps {
  readonly services: Services;
  readonly keys: ReturnType<typeof shellKeys>;
  readonly changed: (event: ShellEvent) => void;
  readonly live: () => Project | undefined;
}

export const createPreferences = ({ services, keys, changed, live }: PreferencesDeps) => {
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

  const [lineByLine, setLineByLine] = createSignal(services.settings.get(keys.lineByLine), {
    name: "lineByLine",
  });
  const watchingLines = services.runtime.runFork(
    Stream.runForEach(services.settings.changes(keys.lineByLine), (on) =>
      Effect.sync(() => setLineByLine(on)),
    ),
  );
  onCleanup(() => {
    Effect.runFork(Fiber.interrupt(watchingLines));
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
        const project = live();
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

  const setLineByLineSetting = (on: boolean): void => {
    void services.run(Effect.result(services.settings.set(keys.lineByLine, on)));
  };

  return { preferChapterView, lineByLine, setLineByLine: setLineByLineSetting };
};

export const createLayoutPreferences = ({
  services,
  keys,
}: Pick<PreferencesDeps, "services" | "keys">) => {
  const [sidebarOpen, setSidebarOpen] = createSignal(services.settings.get(keys.sidebarOpen), {
    name: "sidebarOpen",
  });
  const [referenceSplit, setReferenceSplit] = createSignal(
    services.settings.get(keys.referenceSplit),
    { name: "referenceSplit" },
  );

  const persist = <S>(key: SettingKey<S>, value: S): void => {
    void services.run(Effect.result(services.settings.set(key, value)));
  };

  /**
   * A panel's share of its row: the signal moves at pointer speed, clamped to
   * the range a drag may reach, and the file is written once the drag settles.
   */
  const settledWidth = (
    key: SettingKey<number>,
    range: { readonly min: number; readonly max: number },
    name: string,
  ) => {
    const [width, setWidth] = createSignal(services.settings.get(key), { name });
    let write: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => clearTimeout(write));
    const set = (fraction: number): void => {
      const clamped = Math.min(range.max, Math.max(range.min, fraction));
      setWidth(clamped);
      clearTimeout(write);
      write = setTimeout(() => {
        write = undefined;
        persist(key, clamped);
      }, 400);
    };
    return [width, set] as const;
  };
  const [sidebarWidth, setSidebarWidth] = settledWidth(
    keys.sidebarWidth,
    SIDEBAR_WIDTH,
    "sidebarWidth",
  );
  const [referenceWidth, setReferenceWidth] = settledWidth(
    keys.referenceWidth,
    REFERENCE_WIDTH,
    "referenceWidth",
  );
  const [projectsWidth, setProjectsWidth] = settledWidth(
    keys.projectsWidth,
    PROJECTS_WIDTH,
    "projectsWidth",
  );

  return {
    persist,
    sidebarOpen,
    setSidebarOpen: (open: boolean): void => {
      setSidebarOpen(open);
      persist(keys.sidebarOpen, open);
    },
    referenceSplit,
    setReferenceSplit: (split: boolean): void => {
      setReferenceSplit(split);
      persist(keys.referenceSplit, split);
    },
    sidebarWidth,
    setSidebarWidth,
    referenceWidth,
    setReferenceWidth,
    projectsWidth,
    setProjectsWidth,
  };
};
