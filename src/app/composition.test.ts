import { Effect, Layer } from "effect";
import { afterEach, describe, expect, test } from "vitest";

import type { Composition } from "./composition";
import { composeApplication } from "./composition";

const open: Composition[] = [];

const compose = async (...options: Parameters<typeof composeApplication>): Promise<Composition> => {
  const composition = await composeApplication(...options);
  open.push(composition);
  return composition;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((composition) => composition.dispose()));
});

describe("application composition", () => {
  test("boot runs inside the observability layer and is recorded", async () => {
    const composition = await compose();
    const events = composition.observability.recent();

    // Booting is one end-to-end piece of work, so it is ONE wide record and
    // not a span beside a note.
    const booted = events.find((event) => event.kind === "operation" && event.name === "boot");
    expect(booted?.ms).toBeGreaterThanOrEqual(0);
    expect(booted?.verdict).toBe("ready");
    expect(booted?.attrs?.["app.host"]).toBe("web");
    expect(booted?.trace).toBeDefined();
    expect(booted?.attrs?.["session.id"]).toBeDefined();

    expect(composition.boot._tag).toBe("Success");
  });

  test("export carries the boot events as JSONL", async () => {
    const composition = await compose();
    const lines = composition.observability
      .export()
      .split("\n")
      .filter((line) => line !== "");

    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  test("each call composes independently, so nothing is held at module scope", async () => {
    const first = await compose();
    const second = await compose();

    expect(second.observability).not.toBe(first.observability);
    expect(second.boot).not.toBe(first.boot);

    first.observability.note("probe", "passed");

    expect(first.observability.recent().some((event) => event.name === "probe")).toBe(true);
    expect(second.observability.recent().some((event) => event.name === "probe")).toBe(false);
  });

  test("a resource layer is released by dispose(), not by the boot program returning", async () => {
    let released = false;
    const resource = Layer.effectDiscard(
      Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          released = true;
        }),
      ),
    );

    const composition = await composeApplication({ layers: resource });
    expect(released).toBe(false);

    await composition.dispose();
    expect(released).toBe(true);
  });
});
