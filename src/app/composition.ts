import { Effect, FileSystem, Layer, Option, Result } from "effect";

import { boot, type BootError, type BootInfo } from "../core/boot";
import { Observability, ObservabilityLive, type ObservabilityService } from "../core/observability";
import { detectHost } from "../platform/host";
import { hostSink, installObservabilityDevSurface } from "../platform/observability";

const buildIdentity = (): string | undefined =>
  typeof __SEFER_BUILD__ === "string" ? __SEFER_BUILD__ : undefined;

export interface Composition {
  readonly boot: Result.Result<BootInfo, BootError>;
  readonly observability: ObservabilityService;
  readonly fileSystem: FileSystem.FileSystem | undefined;
  // The root's *built* services, not the recipe that built them: providing it
  // again hands back the same Observability ring instead of making a second
  // one, so a page may merge a child Layer over the root without recomposing.
  readonly layer: Layer.Layer<Observability>;
}

export interface CompositionOptions {
  readonly fileSystem?: Layer.Layer<FileSystem.FileSystem> | undefined;
}

const telemetryLayer = async (): Promise<Layer.Layer<never> | undefined> => {
  const url = import.meta.env.VITE_SEFER_OTLP_URL ?? "";
  if (!import.meta.env.DEV || url === "") return undefined;
  const [otlp, http] = await Promise.all([
    import("effect/unstable/observability/Otlp"),
    import("effect/unstable/http/FetchHttpClient"),
  ]);
  return Layer.provide(
    otlp.layerJson({ baseUrl: url, resource: { serviceName: "sefer" } }),
    http.layer,
  );
};

const program: Effect.Effect<Composition, never, Observability> = Effect.gen(function* () {
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

  const fileSystem = yield* Effect.serviceOption(FileSystem.FileSystem);
  const services = yield* Effect.context<Observability>();

  return {
    boot: result,
    observability,
    fileSystem: Option.getOrUndefined(fileSystem),
    layer: Layer.succeedContext(services),
  };
});

export const composeApplication = async (
  options: CompositionOptions = {},
): Promise<Composition> => {
  const telemetry = await telemetryLayer();
  const observability = ObservabilityLive({ sink: hostSink() });
  const recorded = telemetry === undefined ? observability : Layer.merge(observability, telemetry);
  const layer =
    options.fileSystem === undefined ? recorded : Layer.merge(recorded, options.fileSystem);
  return await Effect.runPromise(Effect.provide(program, layer));
};
