import { expect, test } from "vitest";

import { composeApplication } from "./composition";

test("exposes a read-only observability dev surface showing the boot note", async () => {
  const composition = await composeApplication();
  try {
    const surface = globalThis.__sefer?.observability;

    expect(surface).toBeDefined();
    expect(surface?.level()).toBe("all");
    // `boot` is an OPERATION, not a bare log: it is the first end-to-end piece
    // of work there is, and the one that makes `traces.recent()` answer on a
    // page that has done nothing else yet (`composition.ts`). This assertion
    // read `logs.recent()` until 2026-09-22, which is where boot used to live.
    const span = surface?.traces.recent().find((one) => one.name === "boot");
    expect(span?.verdict).toBe("ready");
    expect(surface?.export()).toContain('"name":"boot"');
  } finally {
    await composition.dispose();
  }
});
