import { Effect, Exit, FileSystem, Layer, ManagedRuntime, Option, Result, Tracer } from "effect";

import { boot, type BootError, type BootInfo } from "#core/boot";
import { makeLogQueue, type LogQueue } from "#core/diagnostics/logFiles";
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

import { reportClientErrors } from "./clientErrors";
import { env } from "./env";

const buildIdentity = (): string | undefined =>
  typeof __SEFER_BUILD__ === "string" ? __SEFER_BUILD__ : undefined;

export interface Composition {
  readonly boot: Result.Result<BootInfo, BootError>;
  readonly observability: ObservabilityService;
  readonly fileSystem: FileSystem.FileSystem | undefined;
  readonly logs: LogQueue;
  readonly layer: Layer.Layer<Observability>;
  readonly runtime: ManagedRuntime.ManagedRuntime<Observability, never>;
  readonly dispose: () => Promise<void>;
}

export interface CompositionOptions {
  readonly fileSystem?: Layer.Layer<FileSystem.FileSystem> | undefined;
  readonly layers?: Layer.Layer<never> | undefined;
}

const guardedFetch = (): typeof globalThis.fetch => {
  let stopped = false;
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (stopped) throw new Error("telemetry export is stopped: the collector did not answer");
    try {
      return await globalThis.fetch(input, init);
    } catch (cause) {
      stopped = true;
      // oxlint-disable-next-line no-console
      console.warn(
        "[sefer] telemetry export failed; not trying again this session.",
        "Set VITE_SEFER_OTLP_URL to a reachable collector, or unset it.",
        cause,
      );
      throw cause;
    }
  };
};

interface Telemetry extends AssemblerSinks {
  readonly dispose: () => Promise<void>;
}

const nanos = (ms: number): bigint => BigInt(Math.round(ms * 1e6));

const OTLP_PROXY_PATH = "/__otlp";

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

type OtlpModules = readonly [
  typeof import("effect/unstable/observability/OtlpTracer"),
  typeof import("effect/unstable/observability/OtlpLogger"),
  typeof import("effect/unstable/observability/OtlpMetrics"),
  typeof import("effect/unstable/observability/OtlpSerialization"),
  typeof import("effect/unstable/http/FetchHttpClient"),
];

const otlpExporters = ([tracer, logger, metrics, serialization, http]: OtlpModules) => {
  const resource = { serviceName: "sefer" };
  const transport = () =>
    Layer.merge(
      Layer.provide(http.layer, Layer.succeed(http.Fetch, guardedFetch())),
      serialization.layerJson,
    );

  const exporters = Layer.mergeAll(
    Layer.provide(tracer.layer({ url: `${OTLP_PROXY_PATH}/v1/traces`, resource }), transport()),
    Layer.provide(
      logger.layer({ url: `${OTLP_PROXY_PATH}/v1/logs`, resource, mergeWithExisting: false }),
      transport(),
    ),
    env.otlpMetrics
      ? Layer.provide(
          metrics.layer({ url: `${OTLP_PROXY_PATH}/v1/metrics`, resource }),
          transport(),
        )
      : Layer.empty,
  );
  return exporters;
};

const telemetryBridge = async (): Promise<Telemetry | undefined> => {
  if (!import.meta.env.DEV || env.otlpUrl === null || typeof location !== "object")
    return undefined;
  const [tracer, logger, metrics, serialization, http] = await Promise.all([
    import("effect/unstable/observability/OtlpTracer"),
    import("effect/unstable/observability/OtlpLogger"),
    import("effect/unstable/observability/OtlpMetrics"),
    import("effect/unstable/observability/OtlpSerialization"),
    import("effect/unstable/http/FetchHttpClient"),
  ]);

  const runtime = ManagedRuntime.make(
    otlpExporters([tracer, logger, metrics, serialization, http]),
  );

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

const fanOut = (sinks: readonly ObservabilitySink[]): ObservabilitySink | undefined => {
  if (sinks.length === 0) return undefined;
  if (sinks.length === 1) return sinks[0];
  return (event) => {
    for (const sink of sinks) {
      try {
        sink(event);
      } catch {}
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
  const session = root.session();
  const boots = root.operation("boot", {
    "session.id": session.id,
    ...(session.build === undefined ? {} : { "build.id": session.build }),
    ...(session.host === undefined ? {} : { "app.host": session.host }),
  });

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
  const rings = devRings();
  const stream = consoleStream(env.stream);
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
  const logs = makeLogQueue();
  const sinks = [hostSink(env.log), assemble, logs.sink].filter(
    (sink): sink is ObservabilitySink => sink !== undefined,
  );
  const recorded = ObservabilityLive({
    sink: fanOut(sinks),
    host: detectHost(),
    ...(buildIdentity() === undefined ? {} : { build: buildIdentity() }),
  });
  const withExtra = options.layers === undefined ? recorded : Layer.merge(recorded, options.layers);
  const layer =
    options.fileSystem === undefined ? withExtra : Layer.merge(withExtra, options.fileSystem);

  const runtime: ManagedRuntime.ManagedRuntime<Observability, never> = ManagedRuntime.make(layer);
  const composed = await runtime.runPromise(
    Effect.tap(program, (made) =>
      Effect.sync(() => {
        installObservabilityDevSurface(made.observability, rings, stream.set);
      }),
    ),
  );
  const context = await runtime.context();
  const stopErrors = reportClientErrors(composed.observability);

  return {
    ...composed,
    logs,
    layer: Layer.succeedContext(context),
    runtime,
    dispose: async () => {
      stopErrors();
      await runtime.dispose();
      if (telemetry !== undefined) await telemetry.dispose();
    },
  };
};
