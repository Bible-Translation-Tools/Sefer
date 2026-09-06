import { Effect, Result } from "effect";

import { boot, type BootError, type BootInfo } from "../core/boot";
import { Observability, ObservabilityLive, type ObservabilityService } from "../core/observability";
import { detectHost } from "../platform/host";
import { hostSink, installObservabilityDevSurface } from "../platform/observability";

const buildIdentity = (): string | undefined =>
  typeof __SEFER_BUILD__ === "string" ? __SEFER_BUILD__ : undefined;

interface Composed {
  readonly boot: Result.Result<BootInfo, BootError>;
  readonly observability: ObservabilityService;
}

const program: Effect.Effect<Composed, never, Observability> = Effect.gen(function* () {
  const observability = yield* Observability;
  installObservabilityDevSurface(observability);

  const end = observability.span("boot");
  const result = yield* Effect.result(boot(detectHost(), buildIdentity()));
  end();

  if (Result.isSuccess(result))
    observability.note(
      "boot",
      "ready",
      `${result.success.host} ${result.success.build}`,
      result.success.build,
    );
  else observability.note("boot", "failed", result.failure._tag);

  return { boot: result, observability };
});

const composed = Effect.runSync(Effect.provide(program, ObservabilityLive({ sink: hostSink() })));

export const applicationBoot: Result.Result<BootInfo, BootError> = composed.boot;

export const applicationObservability: ObservabilityService = composed.observability;
