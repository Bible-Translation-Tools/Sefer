import { getIdentifier, getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { Effect, Layer, Result } from "effect";

import {
  Updater,
  UpdaterError,
  type CheckResult,
  type ReleaseListing,
  type UpdateChannel,
  type UpdaterService,
} from "#core/host/updater";

export interface TauriUpdaterOptions {
  readonly updaterHost: string | null;
}

const updaterTarget = (): string => {
  const name = platform();
  return name === "macos" ? "darwin" : name;
};

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const attempt = <A>(run: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: run, catch: (cause) => cause });

interface WireRelease {
  readonly version: string;
  readonly tag: string;
  readonly published_at?: string | null;
  readonly prerelease?: boolean;
}

const isWireRelease = (value: unknown): value is WireRelease => {
  if (typeof value !== "object" || value === null) return false;
  const row: Record<string, unknown> = { ...value };
  return typeof row.version === "string" && typeof row.tag === "string";
};

export const TauriUpdaterLive = (options: TauriUpdaterOptions): Layer.Layer<Updater> =>
  Layer.effect(
    Updater,
    Effect.gen(function* () {
      const [version, identifier] = yield* Effect.promise(() =>
        Promise.all([getVersion(), getIdentifier()]),
      );
      const channel: UpdateChannel = identifier.endsWith(".preview") ? "preview" : "stable";

      const host = options.updaterHost;

      const requireHost = (): Effect.Effect<string, UpdaterError> =>
        host === null
          ? Effect.fail(
              new UpdaterError({
                reason: "Unavailable",
                description: "no updater host configured for this build",
              }),
            )
          : Effect.succeed(host);

      return {
        currentVersion: () => version,
        channel: () => channel,

        check: () =>
          Effect.map(Effect.result(attempt(() => check())), (result): CheckResult => {
            if (Result.isFailure(result)) {
              return { _tag: "Unavailable", reason: messageOf(result.failure) };
            }
            const update = result.success;
            if (update === null) return { _tag: "UpToDate" };
            return {
              _tag: "Available",
              update: {
                version: update.version,
                notes: update.body ?? "",
                date: update.date ?? null,
              },
            };
          }),

        installAndRelaunch: () =>
          Effect.gen(function* () {
            const update = yield* Effect.mapError(
              attempt(() => check()),
              (cause) => new UpdaterError({ reason: "Network", description: messageOf(cause) }),
            );
            if (update === null) return;
            yield* Effect.mapError(
              attempt(() => update.downloadAndInstall()),
              (cause) => new UpdaterError({ reason: "Failed", description: messageOf(cause) }),
            );
            yield* Effect.orDie(Effect.promise(() => relaunch()));
          }),

        listVersions: () =>
          Effect.orElseSucceed(
            Effect.gen(function* () {
              const base = yield* requireHost();
              const response = yield* Effect.promise(() => fetch(`${base}/versions`));
              if (!response.ok) return [];
              const raw = yield* Effect.promise((): Promise<unknown> => response.json());
              if (!Array.isArray(raw)) return [];
              return raw.filter(isWireRelease).map((row): ReleaseListing => ({
                version: row.version,
                tag: row.tag,
                publishedAt: row.published_at ?? null,
                prerelease: row.prerelease === true,
              }));
            }),
            (): readonly ReleaseListing[] => [],
          ),

        installVersion: (requested) =>
          Effect.gen(function* () {
            const base = yield* requireHost();
            const endpoint = `${base}/${updaterTarget()}/at/${requested}`;
            yield* Effect.mapError(
              attempt(() => invoke<void>("install_update_from_endpoint", { endpoint })),
              (cause) => new UpdaterError({ reason: "Failed", description: messageOf(cause) }),
            );
            yield* Effect.orDie(Effect.promise(() => relaunch()));
          }),
      } satisfies UpdaterService;
    }),
  );
