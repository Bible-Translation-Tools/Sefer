/**
 * The desktop host's Updater, over `@tauri-apps/plugin-updater`.
 *
 * Ported from the v1 app's `TauriUpdaterService`, including the part that is
 * not obvious: the plugin's `check()` has no endpoint override, so the manual
 * version picker cannot use it. That flow goes through the Rust command
 * `install_update_from_endpoint`, which builds a one-off updater pinned to the
 * worker's `/{target}/at/{version}` route and runs the same minisign-verified
 * install. Signature verification is never skipped on either path.
 *
 * The endpoint the AUTOMATIC check uses does not come from here at all: it is
 * baked into the Tauri config by `tools/tauri/updaterConfig.ts` from
 * `SEFER_UPDATER_HOST`. `updaterHost` below is the same host read from
 * `VITE_SEFER_UPDATER_HOST` for the two routes the plugin does not cover
 * (`/versions` and the pinned install). When it is null, the version picker is
 * empty and pinned installs refuse — never a hard-coded URL. See
 * documentation/architecture/configuration.md.
 */
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
} from "../../core/host/updater";

export interface TauriUpdaterOptions {
  /** `VITE_SEFER_UPDATER_HOST`; `null` disables the manual version picker. */
  readonly updaterHost: string | null;
}

/**
 * The target string the updater worker keys assets by.
 *
 * The Tauri updater plugin substitutes `{{target}}` with a bare OS name
 * (`darwin`, `linux`, `windows`), so the manual route has to spell it the same
 * way or the worker will not find the asset. `plugin-os`'s `platform()`
 * returns `"macos"`, hence the one mapping. Architecture is deliberately
 * absent: macOS ships a universal binary and the other two are x86_64 only, so
 * a bare OS name is unambiguous today.
 */
const updaterTarget = (): string => {
  const name = platform();
  return name === "macos" ? "darwin" : name;
};

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/** One release row as the worker's `/versions` route publishes it. */
interface WireRelease {
  readonly version: string;
  readonly tag: string;
  readonly published_at?: string | null;
  readonly prerelease?: boolean;
}

/**
 * A row the picker can display, or nothing. The worker is a service Sefer
 * happens to talk to, not a contract the compiler checked, so a malformed row
 * is dropped rather than rendered as `undefined`.
 */
const isWireRelease = (value: unknown): value is WireRelease => {
  if (typeof value !== "object" || value === null) return false;
  const row: Record<string, unknown> = { ...value };
  return typeof row.version === "string" && typeof row.tag === "string";
};

export const TauriUpdaterLive = (options: TauriUpdaterOptions): Layer.Layer<Updater> =>
  Layer.effect(
    Updater,
    Effect.gen(function* () {
      // Read once at Layer build so the shell's getters stay synchronous, the
      // same bargain HostInfo makes.
      const [version, identifier] = yield* Effect.promise(() =>
        Promise.all([getVersion(), getIdentifier()]),
      );
      // The Nightly bundle installs under `….nightly` (see
      // src-tauri/tauri.conf.nightly.json), so the identifier IS the channel —
      // no separate build flag to keep in step with it.
      const channel: UpdateChannel = identifier.endsWith(".nightly") ? "nightly" : "stable";

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

        /**
         * Never fails: a check that could not reach the worker is an
         * `Unavailable` the panel shows. An unconfigured endpoint arrives here
         * as a plugin error, which is why the reason is passed through rather
         * than interpreted.
         */
        check: () =>
          Effect.map(Effect.result(Effect.tryPromise(() => check())), (result): CheckResult => {
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
            // Checked again rather than reusing the panel's result: the
            // download URL and its signature belong to one manifest, and a
            // manifest read minutes ago may no longer be the current one.
            const update = yield* Effect.mapError(
              Effect.tryPromise(() => check()),
              (cause) => new UpdaterError({ reason: "Network", description: messageOf(cause) }),
            );
            if (update === null) return;
            yield* Effect.mapError(
              Effect.tryPromise(() => update.downloadAndInstall()),
              (cause) => new UpdaterError({ reason: "Failed", description: messageOf(cause) }),
            );
            yield* Effect.orDie(Effect.promise(() => relaunch()));
          }),

        /** Empty rather than failing: an empty picker is a readable state. */
        listVersions: () =>
          Effect.orElseSucceed(
            Effect.gen(function* () {
              const base = yield* requireHost();
              const response = yield* Effect.promise(() => fetch(`${base}/versions`));
              if (!response.ok) return [];
              const raw = yield* Effect.promise((): Promise<unknown> => response.json());
              if (!Array.isArray(raw)) return [];
              return raw.filter(isWireRelease).map(
                (row): ReleaseListing => ({
                  version: row.version,
                  tag: row.tag,
                  publishedAt: row.published_at ?? null,
                  prerelease: row.prerelease === true,
                }),
              );
            }),
            (): readonly ReleaseListing[] => [],
          ),

        installVersion: (requested) =>
          Effect.gen(function* () {
            const base = yield* requireHost();
            const endpoint = `${base}/${updaterTarget()}/at/${requested}`;
            yield* Effect.mapError(
              Effect.tryPromise(() => invoke<void>("install_update_from_endpoint", { endpoint })),
              (cause) => new UpdaterError({ reason: "Failed", description: messageOf(cause) }),
            );
            yield* Effect.orDie(Effect.promise(() => relaunch()));
          }),
      } satisfies UpdaterService;
    }),
  );
