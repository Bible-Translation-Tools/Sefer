/**
 * Updater — how a running Sefer replaces itself.
 *
 * This is a host capability like the five beside it: only the desktop host can
 * install a new binary, and the shell must be able to ask "is there an update"
 * without knowing that. The port exists so the About panel is written once and
 * says "not available in this build" on the Web rather than being absent.
 *
 * Two flows, deliberately different:
 *
 *   `check` / `installAndRelaunch` — the ordinary one. The host's updater
 *   resolves its own endpoint from build configuration, verifies the download's
 *   minisign signature, installs atomically, and relaunches.
 *
 *   `listVersions` / `installVersion` — the escape hatch. When a release breaks
 *   someone's work, they need to go back to the version that worked without
 *   waiting for a fix. It is separate because it deliberately allows a
 *   downgrade, which the ordinary path refuses.
 *
 * `check` cannot fail: "we could not find out" is an answer the panel shows,
 * not an error the shell has to handle. Installing CAN fail, because it either
 * happened or it did not.
 */
import { Context, Data, Effect, Layer } from "effect";

/** Which release stream this build follows. Derived from the app identifier. */
export type UpdateChannel = "stable" | "nightly";

export interface AvailableUpdate {
  readonly version: string;
  /** Release notes as published; empty when the release carried none. */
  readonly notes: string;
  /** Publication date as the host reported it; `null` when absent. */
  readonly date: string | null;
}

/**
 * `UpToDate` — checked, nothing newer.
 * `Available` — something newer exists.
 * `Unavailable` — no answer: no updater in this build, no endpoint configured,
 * or the check itself failed. `reason` is for display, never for branching.
 */
export type CheckResult =
  | { readonly _tag: "UpToDate" }
  | { readonly _tag: "Available"; readonly update: AvailableUpdate }
  | { readonly _tag: "Unavailable"; readonly reason: string };

/** One published release, for the manual version picker. */
export interface ReleaseListing {
  readonly version: string;
  readonly tag: string;
  readonly publishedAt: string | null;
  readonly prerelease: boolean;
}

/**
 * `Unavailable` — this build cannot install updates at all.
 * `Network` — the download or the manifest could not be reached.
 * `Failed` — the host refused the install: a bad signature, no disk, no
 * permission. Never retried automatically; a bad signature must be seen.
 */
export type UpdaterFailureReason = "Unavailable" | "Network" | "Failed";

export class UpdaterError extends Data.TaggedError("UpdaterError")<{
  readonly reason: UpdaterFailureReason;
  readonly description?: string | undefined;
}> {}

export interface UpdaterService {
  /** This build's own version. Synchronous: the shell renders it directly. */
  readonly currentVersion: () => string;
  readonly channel: () => UpdateChannel;
  readonly check: () => Effect.Effect<CheckResult>;
  /** Installs the newest update and restarts. Does not return on success. */
  readonly installAndRelaunch: () => Effect.Effect<void, UpdaterError>;
  /** Newest first. Empty when this build cannot list releases. */
  readonly listVersions: () => Effect.Effect<readonly ReleaseListing[]>;
  /** Installs exactly `version`, downgrade included, then restarts. */
  readonly installVersion: (version: string) => Effect.Effect<void, UpdaterError>;
}

export class Updater extends Context.Service<Updater, UpdaterService>()("Updater") {}

/**
 * The honest answer on a host with no self-update: the Web build, and tests.
 *
 * Not a stub that dies on build — an About panel is a perfectly good thing to
 * render in a browser, and "updates are handled by reloading the page" is the
 * true statement to make there. Every install path refuses loudly, so nothing
 * can believe it installed something.
 */
export const NoUpdaterLive = (build: string): Layer.Layer<Updater> =>
  Layer.succeed(Updater, {
    currentVersion: () => build,
    channel: () => "stable",
    check: () => Effect.succeed({ _tag: "Unavailable", reason: "this build cannot update itself" }),
    installAndRelaunch: () =>
      Effect.fail(
        new UpdaterError({
          reason: "Unavailable",
          description: "this build cannot update itself",
        }),
      ),
    listVersions: () => Effect.succeed([]),
    installVersion: () =>
      Effect.fail(
        new UpdaterError({
          reason: "Unavailable",
          description: "this build cannot update itself",
        }),
      ),
  } satisfies UpdaterService);
