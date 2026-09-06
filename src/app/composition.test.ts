import { describe, expect, test } from "vitest";

import { composeApplication } from "./composition";

describe("application composition", () => {
  test("boot runs inside the observability layer and is recorded", async () => {
    const composition = await composeApplication();
    const events = composition.observability.recent();

    const span = events.find((event) => event.kind === "span" && event.name === "boot");
    expect(span?.ms).toBeGreaterThanOrEqual(0);

    const note = events.find((event) => event.kind === "note" && event.name === "boot");
    expect(note?.verdict).toBe("ready");
    expect(note?.detail).toMatch(/^web /u);

    expect(composition.boot._tag).toBe("Success");
  });

  test("export carries the boot events as JSONL", async () => {
    const composition = await composeApplication();
    const lines = composition.observability
      .export()
      .split("\n")
      .filter((line) => line !== "");

    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  test("each call composes independently, so nothing is held at module scope", async () => {
    const first = await composeApplication();
    const second = await composeApplication();

    expect(second.observability).not.toBe(first.observability);
    expect(second.boot).not.toBe(first.boot);

    first.observability.note("probe", "passed");

    expect(first.observability.recent().some((event) => event.name === "probe")).toBe(true);
    expect(second.observability.recent().some((event) => event.name === "probe")).toBe(false);
  });
});
