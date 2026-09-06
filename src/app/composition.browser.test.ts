import { expect, test } from "vitest";

import { composeApplication } from "./composition";

test("exposes a read-only observability dev surface showing the boot note", async () => {
  const composition = await composeApplication();
  const surface = globalThis.__sefer?.observability;

  expect(surface).toBeDefined();
  expect(surface?.level()).toBe("all");
  expect(surface?.recent()).toEqual(composition.observability.recent());

  const note = surface?.recent().find((event) => event.kind === "note" && event.name === "boot");
  expect(note?.verdict).toBe("ready");
});
