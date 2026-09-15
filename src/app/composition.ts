import { Effect, FileSystem, Layer, ManagedRuntime, Option, Result } from "effect";

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
  readonly layer: Layer.Layer<Observability>;
  readonly runtime: ManagedRuntime.ManagedRuntime<Observability, never>;
  readonly dispose: () => Promise<void>;
}

export interface CompositionOptions {
  readonly fileSystem?: Layer.Layer<FileSystem.FileSystem> | undefined;
  readonly layers?: Layer.Layer<never> | undefined;
}

/**
 * The `fetch` the OTLP exporters use, which stops trying after the first
 * failure.
 *
 * A collector that is not there is the ordinary case in development, and an
 * exporter that retries on every interval turns that into a console full of
 * `net::ERR_FAILED` — hundreds of lines, none of them about the thing being
 * debugged. The browser prints the failed request itself and we cannot stop
 * it; what we can stop is asking again. So: one warning, then every later
 * export is refused locally without a request.
 *
 * Deliberately one-way. Telemetry is a development convenience and re-probing
 * a dead collector on a timer is the behaviour being fixed; restarting the
 * collector is a page reload away.
 */
const guardedFetch = (): typeof globalThis.fetch => {
  let stopped = false;
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (stopped) throw new Error("telemetry export is stopped: the collector did not answer");
    try {
      return await globalThis.fetch(input, init);
    } catch (cause) {
      stopped = true;
      console.warn(
        "[sefer] telemetry export failed; not trying again this session.",
        "Set VITE_SEFER_OTLP_URL to a reachable collector, or unset it.",
        cause,
      );
      throw cause;
    }
  };
};

/**
 * Traces and logs, and metrics only when asked for.
 *
 * `Otlp.layerJson` installs all three exporters from one call, which is
 * convenient right up to the moment the collector accepts two of them: motel
 * takes `/v1/traces` and `/v1/logs` and answers `/v1/metrics` with nothing at
 * all, so every metrics interval produced a `POST /v1/metrics net::ERR_FAILED`
 * in the console of an application that had asked for tracing. The exporters
 * are installed one by one instead, and metrics are opt-in
 * (`VITE_SEFER_OTLP_METRICS=1`) because they are the one a collector is most
 * likely not to want.
 */
const telemetryLayer = async (): Promise<Layer.Layer<never> | undefined> => {
  const url = (import.meta.env.VITE_SEFER_OTLP_URL ?? "").trim().replace(/\/+$/u, "");
  if (!import.meta.env.DEV || url === "") return undefined;
  const [tracer, logger, metrics, serialization, http] = await Promise.all([
    import("effect/unstable/observability/OtlpTracer"),
    import("effect/unstable/observability/OtlpLogger"),
    import("effect/unstable/observability/OtlpMetrics"),
    import("effect/unstable/observability/OtlpSerialization"),
    import("effect/unstable/http/FetchHttpClient"),
  ]);

  const resource = { serviceName: "sefer" };
  const exporters = Layer.merge(
    Layer.merge(
      tracer.layer({ url: `${url}/v1/traces`, resource }),
      logger.layer({ url: `${url}/v1/logs`, resource }),
    ),
    import.meta.env.VITE_SEFER_OTLP_METRICS === "1"
      ? metrics.layer({ url: `${url}/v1/metrics`, resource })
      : Layer.empty,
  );

  const transport = Layer.merge(
    Layer.provide(http.layer, Layer.succeed(http.Fetch, guardedFetch())),
    serialization.layerJson,
  );

  return Layer.provide(exporters, transport);
};

interface Composed {
  readonly boot: Result.Result<BootInfo, BootError>;
  readonly observability: ObservabilityService;
  readonly fileSystem: FileSystem.FileSystem | undefined;
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

  const fileSystem = yield* Effect.serviceOption(FileSystem.FileSystem);

  return { boot: result, observability, fileSystem: Option.getOrUndefined(fileSystem) };
});

export const composeApplication = async (
  options: CompositionOptions = {},
): Promise<Composition> => {
  const telemetry = await telemetryLayer();
  const observability = ObservabilityLive({ sink: hostSink() });
  const recorded = telemetry === undefined ? observability : Layer.merge(observability, telemetry);
  const withExtra = options.layers === undefined ? recorded : Layer.merge(recorded, options.layers);
  const layer =
    options.fileSystem === undefined ? withExtra : Layer.merge(withExtra, options.fileSystem);

  const runtime: ManagedRuntime.ManagedRuntime<Observability, never> = ManagedRuntime.make(layer);
  const composed = await runtime.runPromise(program);
  const context = await runtime.context();

  return {
    ...composed,
    layer: Layer.succeedContext(context),
    runtime,
    dispose: () => runtime.dispose(),
  };
};
