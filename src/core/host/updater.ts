import { Context, Data, Effect, Layer } from "effect";

export type UpdateChannel = "stable" | "preview";

export interface AvailableUpdate {
  readonly version: string;
  readonly notes: string;
  readonly date: string | null;
}

export type CheckResult =
  | { readonly _tag: "UpToDate" }
  | { readonly _tag: "Available"; readonly update: AvailableUpdate }
  | { readonly _tag: "Unavailable"; readonly reason: string };

export interface ReleaseListing {
  readonly version: string;
  readonly tag: string;
  readonly publishedAt: string | null;
  readonly prerelease: boolean;
}

export type UpdaterFailureReason = "Unavailable" | "Network" | "Failed";

export class UpdaterError extends Data.TaggedError("UpdaterError")<{
  readonly reason: UpdaterFailureReason;
  readonly description?: string | undefined;
}> {}

export interface UpdaterService {
  readonly currentVersion: () => string;
  readonly channel: () => UpdateChannel;
  readonly check: () => Effect.Effect<CheckResult>;
  readonly installAndRelaunch: () => Effect.Effect<void, UpdaterError>;
  readonly listVersions: () => Effect.Effect<readonly ReleaseListing[]>;
  readonly installVersion: (version: string) => Effect.Effect<void, UpdaterError>;
}

export class Updater extends Context.Service<Updater, UpdaterService>()("Updater") {}

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
