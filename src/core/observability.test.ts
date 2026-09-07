import { Effect } from "effect";
import { describe, expect, test } from "vitest";

import {
  MAX_TEXT,
  Observability,
  ObservabilityLive,
  type ObservabilityEvent,
  type ObservabilityOptions,
  type ObservabilityService,
} from "./observability";

const withRing = <A>(
  options: ObservabilityOptions,
  body: (observability: ObservabilityService) => Effect.Effect<A>,
): A =>
  Effect.runSync(
    Effect.provide(
      Effect.gen(function* () {
        const observability = yield* Observability;
        return yield* body(observability);
      }),
      ObservabilityLive(options),
    ),
  );

const burn = (ms: number): void => {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    /* spin */
  }
};

const named = (events: readonly ObservabilityEvent[], name: string): ObservabilityEvent => {
  const found = events.find((event) => event.name === name);
  if (found === undefined) throw new Error(`no event named ${name} in ${JSON.stringify(events)}`);
  return found;
};

describe("observability ring", () => {
  test("is bounded and drops the oldest event", () => {
    const events = withRing({ capacity: 4 }, (observability) => {
      for (let index = 0; index < 10; index += 1) observability.note(`rule-${index}`, "passed");
      return Effect.succeed(observability.recent());
    });

    expect(events).toHaveLength(4);
    expect(events.map((event) => event.name)).toEqual(["rule-6", "rule-7", "rule-8", "rule-9"]);
    expect(events.map((event) => event.seq)).toEqual([6, 7, 8, 9]);
  });

  test("recent(limit) returns the newest events in order", () => {
    const events = withRing({ capacity: 8 }, (observability) => {
      for (let index = 0; index < 5; index += 1) observability.note(`rule-${index}`, "passed");
      return Effect.succeed(observability.recent(2));
    });

    expect(events.map((event) => event.name)).toEqual(["rule-3", "rule-4"]);
  });

  test("nested spans bill exclusive time against the enclosing span", () => {
    const events = withRing({}, (observability) => {
      const outer = observability.span("outer");
      burn(4);
      const inner = observability.span("inner");
      burn(6);
      inner();
      burn(4);
      outer();
      return Effect.succeed(observability.recent());
    });

    const inner = named(events, "inner");
    const outer = named(events, "outer");

    expect(inner.ms).toBeDefined();
    expect(outer.ms).toBeDefined();
    expect(inner.ms ?? 0).toBeLessThanOrEqual(outer.ms ?? 0);
    expect(inner.self).toBe(inner.ms);
    expect((outer.self ?? 0) + (inner.ms ?? 0)).toBeCloseTo(outer.ms ?? 0, 2);
    expect(outer.self ?? 0).toBeLessThan(outer.ms ?? 0);
  });

  test("level off records nothing and a span still returns its duration", () => {
    const { events, ms } = withRing({ level: "off" }, (observability) => {
      const end = observability.span("silent");
      burn(2);
      const measured = end();
      observability.note("silent-rule", "refused", "detail");
      return Effect.succeed({ events: observability.recent(), ms: measured });
    });

    expect(events).toEqual([]);
    expect(ms).toBeGreaterThan(0);
  });

  test("setLevel selects volume between verdicts and spans", () => {
    const events = withRing({ level: "verdicts" }, (observability) => {
      observability.span("ignored")();
      observability.note("kept", "passed");
      observability.setLevel("spans");
      observability.span("recorded")();
      return Effect.succeed(observability.recent());
    });

    expect(events.map((event) => event.name)).toEqual(["kept", "recorded"]);
  });
});

describe("observability export", () => {
  test("emits one JSON object per line in the documented field order", () => {
    const { text, events } = withRing({ capacity: 16 }, (observability) => {
      observability.note("boot", "ready", "web dev+test", "op-1");
      observability.span("work", "note")();
      return Effect.succeed({ text: observability.export(), events: observability.recent() });
    });

    const lines = text.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(2);

    // SAFETY: every line came from export(), which writes one JSON object per line.
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed).toEqual(events.map((event) => ({ ...event })));

    expect(Object.keys(parsed[0] ?? {})).toEqual([
      "seq",
      "t",
      "kind",
      "name",
      "verdict",
      "detail",
      "correlation",
    ]);
    expect(Object.keys(parsed[1] ?? {})).toEqual([
      "seq",
      "t",
      "kind",
      "name",
      "detail",
      "ms",
      "self",
    ]);
  });

  test("round-trips a correlation id", () => {
    const events = withRing({}, (observability) => {
      observability.note("save", "passed", "revision 7", "operation-42");
      return Effect.succeed(observability.recent());
    });

    expect(named(events, "save").correlation).toBe("operation-42");
    expect(named(events, "save").detail).toBe("revision 7");
  });
});

describe("effect integration", () => {
  test("Effect.log lands in the ring with the same shape", () => {
    const events = withRing({}, (observability) =>
      Effect.gen(function* () {
        yield* Effect.log("engine loaded");
        yield* Effect.logError("engine failed");
        return observability.recent();
      }),
    );

    const info = named(events, "engine loaded");
    expect(info.kind).toBe("log");
    expect(info.detail).toBe("Info");
    expect(info.verdict).toBeUndefined();

    const failure = named(events, "engine failed");
    expect(failure.kind).toBe("log");
    expect(failure.detail).toBe("Error");
    expect(failure.verdict).toBe("failed");
  });

  test("Effect.withSpan lands in the ring with a trace correlation", () => {
    const events = withRing({}, (observability) =>
      Effect.gen(function* () {
        yield* Effect.succeed(1).pipe(Effect.withSpan("engine.load"));
        return observability.recent();
      }),
    );

    const span = named(events, "engine.load");
    expect(span.kind).toBe("span");
    expect(span.ms).toBeGreaterThanOrEqual(0);
    expect(typeof span.correlation).toBe("string");
  });
});

describe("sink isolation", () => {
  test("a throwing sink drops the export, keeps the ring, and never reaches the caller", () => {
    const long = "x".repeat(MAX_TEXT + 40);
    const { events, dropped } = withRing(
      {
        sink: () => {
          throw new Error("sink is on fire");
        },
      },
      (observability) => {
        expect(() => observability.note("boot", "ready", long, "op-1")).not.toThrow();
        return Effect.succeed({ events: observability.recent(), dropped: observability.dropped() });
      },
    );

    expect(events.map((event) => event.name)).toEqual(["boot"]);
    expect(dropped).toBe(1);
    expect(named(events, "boot").detail).toBe("x".repeat(MAX_TEXT));
    expect(named(events, "boot").detail?.length).toBe(MAX_TEXT);
  });

  test("a name longer than MAX_TEXT is truncated before it is recorded", () => {
    const events = withRing({}, (observability) => {
      observability.note("r".repeat(MAX_TEXT + 1), "passed");
      return Effect.succeed(observability.recent());
    });

    expect(events[0]?.name).toBe("r".repeat(MAX_TEXT));
  });
});
