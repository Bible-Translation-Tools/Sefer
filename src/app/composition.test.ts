import { describe, expect, test } from "vitest";

import { applicationBoot, applicationObservability } from "./composition";

describe("application composition", () => {
  test("boot runs inside the observability layer and is recorded", () => {
    const events = applicationObservability.recent();

    const span = events.find((event) => event.kind === "span" && event.name === "boot");
    expect(span?.ms).toBeGreaterThanOrEqual(0);

    const note = events.find((event) => event.kind === "note" && event.name === "boot");
    expect(note?.verdict).toBe("ready");
    expect(note?.detail).toMatch(/^web /u);

    expect(applicationBoot._tag).toBe("Success");
  });

  test("export carries the boot events as JSONL", () => {
    const lines = applicationObservability
      .export()
      .split("\n")
      .filter((line) => line !== "");

    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});
