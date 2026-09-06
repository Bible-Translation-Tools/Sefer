import { expect, test } from "vitest";

import { applicationObservability } from "./composition";

test("exposes a read-only observability dev surface showing the boot note", () => {
  const surface = globalThis.__sefer?.observability;

  expect(surface).toBeDefined();
  expect(surface?.level()).toBe("all");
  expect(surface?.recent()).toEqual(applicationObservability.recent());

  const note = surface?.recent().find((event) => event.kind === "note" && event.name === "boot");
  expect(note?.verdict).toBe("ready");
});
