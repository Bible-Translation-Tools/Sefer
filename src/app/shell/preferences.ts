import { Effect, Fiber, Stream } from "effect";
import { createSignal, onCleanup } from "solid-js";

import type { SettingKey } from "#core/host/settings";
import type { Project } from "#core/project/project";
import { DEFAULT_JOURNAL_POLICY } from "#core/recovery/recovery";

import type { Services } from "../services";
import { REFERENCE_WIDTH, SIDEBAR_WIDTH, type shellKeys } from "../settings";
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

  return { preferChapterView };
};

export const createLayoutPreferences = ({
  services,
  keys,
}: Pick<PreferencesDeps, "services" | "keys">) => {
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

  const persist = <S>(key: SettingKey<S>, value: S): void => {
    void services.run(Effect.result(services.settings.set(key, value)));
  };

  let widthWrite: ReturnType<typeof setTimeout> | undefined;
  let referenceWrite: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (widthWrite !== undefined) clearTimeout(widthWrite);
    if (referenceWrite !== undefined) clearTimeout(referenceWrite);
  });

  return {
    persist,
    sidebarOpen,
    setSidebarOpen: (open: boolean): void => {
      setSidebarOpen(open);
      persist(keys.sidebarOpen, open);
    },
    referenceOpen,
    setReferenceOpen: (open: boolean): void => {
      setReferenceOpen(open);
      persist(keys.referenceOpen, open);
    },
    sidebarWidth,
    setSidebarWidth: (fraction: number): void => {
      const clamped = Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, fraction));
      setSidebarWidth(clamped);
      if (widthWrite !== undefined) clearTimeout(widthWrite);
      widthWrite = setTimeout(() => {
        widthWrite = undefined;
        persist(keys.sidebarWidth, clamped);
      }, 400);
    },
    referenceWidth,
    setReferenceWidth: (fraction: number): void => {
      const clamped = Math.min(REFERENCE_WIDTH.max, Math.max(REFERENCE_WIDTH.min, fraction));
      setReferenceWidth(clamped);
      if (referenceWrite !== undefined) clearTimeout(referenceWrite);
      referenceWrite = setTimeout(() => {
        referenceWrite = undefined;
        persist(keys.referenceWidth, clamped);
      }, 400);
    },
  };
};
