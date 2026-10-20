import { expect, test } from "vitest";

import { composeApplication } from "./composition";

test("exposes a read-only observability dev surface showing the boot note", async () => {
  const composition = await composeApplication();
  try {
    const surface = globalThis.__sefer?.observability;

    expect(surface).toBeDefined();
    expect(surface?.level()).toBe("all");
    const span = surface?.traces.recent().find((one) => one.name === "boot");
    expect(span?.verdict).toBe("ready");
    expect(surface?.export()).toContain('"name":"boot"');
  } finally {
    await composition.dispose();
  }
});
