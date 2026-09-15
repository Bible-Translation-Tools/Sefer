import { Effect, Exit, FileSystem, Layer, ManagedRuntime, Option, Result } from "effect";

import { boot, type BootError, type BootInfo } from "../core/boot";
import {
  Observability,
  ObservabilityLive,
  type ObservabilityEvent,
  type ObservabilityService,
  type ObservabilitySink,
} from "../core/observability";
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
 * The OTLP export, as a SINK on the ring.
 *
 * This is the whole of the fix for "motel export not working", and the reason
 * it was not working is worth writing down: the exporters were installed
 * correctly and had nothing whatever to export. Sefer's observability is the
 * ring in `src/core/observability.ts` — `note()` and `span()` are plain
 * function calls that push a record into a buffer — and OTLP's tracer and
 * logger only ever see EFFECT-native spans and logs. `Effect.log` and
 * `Effect.withSpan` appear nowhere in `src/`, so a run with
 * `VITE_SEFER_OTLP_URL` set posted exactly nothing: no request at all, which
 * is why it presented as silence rather than as an error.
 *
 * Worse, the two layers were fighting over the same two services. The ring's
 * own layer installs a `Tracer.Tracer` and replaces `CurrentLoggers`, and
 * merging the OTLP layer into it meant one of the two won and the other was
 * discarded — a coin toss neither half could see.
 *
 * So the exporters get a runtime of their OWN, and the bridge between the two
 * is the ring's existing sink seam, the same one `hostSink` uses. Every ring
 * event is forwarded: a `note` and a `log` become an OTLP log record, a `span`
 * becomes a real span with the duration the ring measured. The ring keeps its
 * own tracer and logger untouched, and there is no loop, because this
 * runtime's logger set is the OTLP one alone and never reaches the ring.
 *
 * Metrics stay opt-in (`VITE_SEFER_OTLP_METRICS=1`): motel takes `/v1/traces`
 * and `/v1/logs` and answers `/v1/metrics` with nothing at all, so a metrics
 * interval on a tracing collector is a console full of `net::ERR_FAILED`. Each
 * signal also gets its OWN `guardedFetch`, so one endpoint the collector does
 * not serve can no longer stop the two it does.
 */
interface Telemetry {
  readonly sink: ObservabilitySink;
  readonly dispose: () => Promise<void>;
}

/** Milliseconds since the epoch, as the nanosecond bigint a span wants. */
const nanos = (ms: number): bigint => BigInt(Math.round(ms * 1e6));

/**
 * Where the exporters post: a SAME-ORIGIN path the dev server proxies to the
 * collector `VITE_SEFER_OTLP_URL` names.
 *
 * Posting to the collector directly is a cross-origin `application/json` POST,
 * which the browser preflights — and motel answers `OPTIONS /v1/logs` with a
 * bare 404 and no `Access-Control-Allow-Origin`, so the preflight fails and
 * the POST is never made. That is silent: no request on the wire, no error the
 * collector can report, which is exactly how "motel export not working"
 * presented. The proxy is declared in `vite.config.ts`, beside the same
 * literal and the same explanation.
 */
const OTLP_PROXY_PATH = "/__otlp";

const telemetryBridge = async (): Promise<Telemetry | undefined> => {
  const url = (import.meta.env.VITE_SEFER_OTLP_URL ?? "").trim();
  // A browser, because the export goes through the dev server's proxy and a
  // relative URL needs an origin to resolve against. The prerender pass and
  // the dev server's own SSR render run here too, and neither has one.
  if (!import.meta.env.DEV || url === "" || typeof location !== "object") return undefined;
  const [tracer, logger, metrics, serialization, http] = await Promise.all([
    import("effect/unstable/observability/OtlpTracer"),
    import("effect/unstable/observability/OtlpLogger"),
    import("effect/unstable/observability/OtlpMetrics"),
    import("effect/unstable/observability/OtlpSerialization"),
    import("effect/unstable/http/FetchHttpClient"),
  ]);

  const resource = { serviceName: "sefer" };
  // One transport per signal, so one dead endpoint refuses only itself.
  const transport = () =>
    Layer.merge(
      Layer.provide(http.layer, Layer.succeed(http.Fetch, guardedFetch())),
      serialization.layerJson,
    );

  const exporters = Layer.mergeAll(
    Layer.provide(tracer.layer({ url: `${OTLP_PROXY_PATH}/v1/traces`, resource }), transport()),
    // `mergeWithExisting: false`: this runtime exists to export, and the
    // default console logger inside it would print every ring note twice.
    Layer.provide(
      logger.layer({ url: `${OTLP_PROXY_PATH}/v1/logs`, resource, mergeWithExisting: false }),
      transport(),
    ),
    import.meta.env.VITE_SEFER_OTLP_METRICS === "1"
      ? Layer.provide(
          metrics.layer({ url: `${OTLP_PROXY_PATH}/v1/metrics`, resource }),
          transport(),
        )
      : Layer.empty,
  );

  const runtime = ManagedRuntime.make(exporters);

  const record = (event: ObservabilityEvent): Effect.Effect<void> => {
    if (event.kind === "span") {
      return Effect.gen(function* () {
        const span = yield* Effect.makeSpan(event.name, {
          root: true,
          attributes: {
            ...(event.detail === undefined ? {} : { detail: event.detail }),
            ...(event.self === undefined ? {} : { "sefer.self_ms": event.self }),
            ...(event.correlation === undefined ? {} : { "sefer.correlation": event.correlation }),
          },
        });
        // The ring measured the duration; the span is ended that far after it
        // began, so the trace shows the number the note shows.
        const started = span.status.startTime;
        span.end(started + nanos(event.ms ?? 0), Exit.succeed(undefined));
      });
    }
    const line = `${event.name}${event.verdict === undefined ? "" : ` ${event.verdict}`}`;
    const said = event.verdict === "failed" ? Effect.logError(line) : Effect.log(line);
    return Effect.annotateLogs(said, {
      "sefer.kind": event.kind,
      ...(event.verdict === undefined ? {} : { "sefer.verdict": event.verdict }),
      ...(event.detail === undefined ? {} : { "sefer.detail": event.detail }),
      ...(event.correlation === undefined ? {} : { "sefer.correlation": event.correlation }),
    });
  };

  return {
    sink: (event) => {
      runtime.runFork(record(event));
    },
    dispose: () => runtime.dispose(),
  };
};

/**
 * One sink out of several, each insulated from the others.
 *
 * The ring already counts a throwing sink as a drop, but it has ONE sink, so
 * without this a console that refuses would take the OTLP export with it.
 */
const fanOut = (sinks: readonly ObservabilitySink[]): ObservabilitySink | undefined => {
  if (sinks.length === 0) return undefined;
  if (sinks.length === 1) return sinks[0];
  return (event, line) => {
    for (const sink of sinks) {
      try {
        sink(event, line);
      } catch {
        // The ring's `dropped` counter is for the sink it was given; a sink
        // that throws here has already had its turn and the next one gets its.
      }
    }
  };
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
  const telemetry = await telemetryBridge();
  const sinks = [hostSink(), telemetry?.sink].filter(
    (sink): sink is ObservabilitySink => sink !== undefined,
  );
  const recorded = ObservabilityLive({ sink: fanOut(sinks) });
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
    dispose: async () => {
      await runtime.dispose();
      // Last, and awaited: the exporters flush what they are holding when
      // their scope closes, and a browser that has already torn the runtime
      // down would otherwise lose the final batch.
      if (telemetry !== undefined) await telemetry.dispose();
    },
  };
};
