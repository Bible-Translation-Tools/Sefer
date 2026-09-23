import { Effect, Exit, FileSystem, Layer, ManagedRuntime, Option, Result, Tracer } from "effect";

import { boot, type BootError, type BootInfo } from "#core/boot";
import {
  makeAssembler,
  Observability,
  ObservabilityLive,
  type AssembledSpan,
  type AssemblerSinks,
  type ObservabilityEvent,
  type ObservabilityService,
  type ObservabilitySink,
} from "#core/observability";
import { detectHost } from "#platform/host";
import {
  consoleStream,
  devRings,
  hostSink,
  installObservabilityDevSurface,
} from "#platform/observability";

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
interface Telemetry extends AssemblerSinks {
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

  const attributesOf = (
    of: {
      readonly attrs?: Record<string, unknown>;
      readonly verdict?: string;
      readonly detail?: string;
    },
    kind: string,
  ): Record<string, unknown> => ({
    "sefer.kind": kind,
    ...of.attrs,
    ...(of.detail === undefined ? {} : { "sefer.detail": of.detail }),
    ...(of.verdict === undefined ? {} : { "sefer.verdict": of.verdict }),
  });

  /**
   * One assembled operation as one OTLP span.
   *
   * Its notes go on as span EVENTS rather than as separate log records: they
   * are points inside the work, they carry its trace and span by construction,
   * and a collector renders them in the span rather than beside it.
   */
  const exportSpan = (assembled: AssembledSpan, root: boolean): Effect.Effect<Tracer.Span> =>
    Effect.gen(function* () {
      const span = yield* Effect.makeSpan(assembled.name, {
        ...(root ? { root: true } : {}),
        attributes: {
          ...attributesOf(assembled, root ? "operation" : "span"),
          ...(assembled.self === undefined ? {} : { "sefer.self_ms": assembled.self }),
        },
      });
      for (const one of assembled.events)
        span.event(one.name, nanos(one.t), attributesOf(one, "note"));
      span.end(span.status.startTime + nanos(assembled.ms ?? 0), Exit.succeed(undefined));
      return span;
    });

  const exportOperation = (assembled: AssembledSpan): Effect.Effect<void> =>
    Effect.gen(function* () {
      const parent = yield* exportSpan(assembled, true);
      yield* Effect.withParentSpan(
        Effect.forEach(assembled.children, (child) => exportSpan(child, false), { discard: true }),
        parent,
      );
    });

  /** Work no gesture caused: its own root, or a log with nothing to nest in. */
  const exportLoose = (event: ObservabilityEvent): Effect.Effect<void> => {
    if (event.kind === "span" || event.kind === "operation")
      return Effect.asVoid(
        exportSpan(
          {
            name: event.name,
            trace: "",
            id: "",
            t: event.t,
            ...(event.ms === undefined ? {} : { ms: event.ms }),
            ...(event.verdict === undefined ? {} : { verdict: event.verdict }),
            ...(event.attrs === undefined ? {} : { attrs: event.attrs }),
            events: [],
            children: [],
          },
          true,
        ),
      );
    const line = `${event.name}${event.verdict === undefined ? "" : ` ${event.verdict}`}`;
    const said = event.verdict === "failed" ? Effect.logError(line) : Effect.log(line);
    return Effect.annotateLogs(said, attributesOf(event, event.kind));
  };

  return {
    operation: (assembled) => {
      runtime.runFork(exportOperation(assembled));
    },
    loose: (event) => {
      runtime.runFork(exportLoose(event));
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
  const root = yield* Observability;
  // The first end-to-end piece of work there is, and the one that makes
  // `traces.recent()` answer on a page that has done nothing else yet.
  const session = root.session();
  const boots = root.operation("boot", {
    "session.id": session.id,
    ...(session.build === undefined ? {} : { "build.id": session.build }),
    ...(session.host === undefined ? {} : { "app.host": session.host }),
  });

  // Provided to `boot` itself, so anything it narrates lands inside this
  // operation rather than beside it — core asks the context for Observability
  // and cannot tell which one it received.
  const result = yield* Effect.provideService(
    Effect.result(boot(detectHost(), buildIdentity())),
    Observability,
    boots,
  );

  if (Result.isSuccess(result))
    boots.end("ready", {
      "app.host": result.success.host,
      "build.id": result.success.build,
      "boot.phase": result.success.phase,
    });
  else boots.end("failed", { "boot.error": result.failure._tag });

  const fileSystem = yield* Effect.serviceOption(FileSystem.FileSystem);

  return { boot: result, observability: root, fileSystem: Option.getOrUndefined(fileSystem) };
});

export const composeApplication = async (
  options: CompositionOptions = {},
): Promise<Composition> => {
  const telemetry = await telemetryBridge();
  // ONE assembly of the ring's flat stream into operations, fanned out to
  // everything that renders them: the collector, the console, and the dev
  // surface `traces.recent()` reads. They cannot drift, because there is one
  // tree and three renderers rather than three reconstructions.
  const rings = devRings();
  const stream = consoleStream();
  const assembled = [rings.sinks, stream, telemetry].filter(
    (one): one is AssemblerSinks => one !== undefined,
  );
  const assemble = makeAssembler({
    operation: (span) => {
      for (const one of assembled) one.operation(span);
    },
    loose: (event) => {
      for (const one of assembled) one.loose(event);
    },
  });
  // The raw JSONL sink stays on the events themselves: a line per event is the
  // evidence format, and it must not wait for an operation to finish.
  // SAFETY: an assembler takes one `ObservabilityEvent` and returns nothing,
  // which is a sink's shape minus the JSONL line it does not read.
  const sinks = [hostSink(), assemble as ObservabilitySink].filter(
    (sink): sink is ObservabilitySink => sink !== undefined,
  );
  // The session stamp: what every event of this run has in common, which
  // belongs once on the OTLP Resource and once on a JSONL header rather than
  // repeated on every line.
  const recorded = ObservabilityLive({
    sink: fanOut(sinks),
    host: detectHost(),
    ...(buildIdentity() === undefined ? {} : { build: buildIdentity() }),
  });
  const withExtra = options.layers === undefined ? recorded : Layer.merge(recorded, options.layers);
  const layer =
    options.fileSystem === undefined ? withExtra : Layer.merge(withExtra, options.fileSystem);

  const runtime: ManagedRuntime.ManagedRuntime<Observability, never> = ManagedRuntime.make(layer);
  // Installed HERE rather than inside the program, because the dev surface
  // publishes the assembled trees as well as the ring, and the assembly is
  // composition's, not the boot program's.
  const composed = await runtime.runPromise(
    Effect.tap(program, (made) =>
      Effect.sync(() => {
        installObservabilityDevSurface(made.observability, rings, stream.set);
      }),
    ),
  );
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
