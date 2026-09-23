import { Data, Effect } from "effect";

export type HostKind = "web" | "tauri";

export interface BootInfo {
  readonly host: HostKind;
  readonly build: string;
  readonly phase: "ready";
}

class UnknownHost extends Data.TaggedError("UnknownHost")<{
  readonly received: string;
}> {}

class MissingBuildIdentity extends Data.TaggedError("MissingBuildIdentity")<{}> {}

export type BootError = UnknownHost | MissingBuildIdentity;

const HOST_KINDS: readonly HostKind[] = ["web", "tauri"];

const isHostKind = (value: string): value is HostKind =>
  HOST_KINDS.some((candidate) => candidate === value);

/**
 * Boot turns raw host and build signals into the one value the shell needs,
 * or into a typed failure the shell can render. It owns no resources, so it
 * needs no scope; a scoped runtime arrives with the first real resource.
 */
export const boot = (
  host: string,
  build: string | undefined,
): Effect.Effect<BootInfo, BootError> => {
  if (!isHostKind(host)) return Effect.fail(new UnknownHost({ received: host }));
  if (build === undefined || build.trim() === "") return Effect.fail(new MissingBuildIdentity());
  return Effect.succeed({ host, build, phase: "ready" });
};
