import { expect, test } from "vitest";

import { composeApplication } from "./composition";

test("exposes a read-only observability dev surface showing the boot note", async () => {
  const composition = await composeApplication();
  try {
    const surface = globalThis.__sefer?.observability;

    expect(surface).toBeDefined();
    expect(surface?.level()).toBe("all");
    // `boot` belongs to no gesture, so it is a log rather than a trace.
    const note = surface?.logs.recent().find((event) => event.name === "boot");
    expect(note?.verdict).toBe("ready");
    expect(surface?.export()).toContain('"name":"boot"');
  } finally {
    await composition.dispose();
  }
});
