import { render } from "@solidjs/web";
import { expect, test, vi } from "vitest";

import { smallNtFileNames } from "../../core/fixture/smallNt";
import { FixturePage } from "./fixture";

test("the fixture route renders every seeded file and publishes dev state", async () => {
  const expected = smallNtFileNames().length;
  const target = document.createElement("div");
  document.body.append(target);

  const dispose = render(() => <FixturePage />, target);

  await vi.waitFor(() => {
    expect(target.querySelectorAll("li").length).toBe(expected);
  });

  expect(globalThis.__sefer?.state?.().fixture).toHaveProperty("files.length", expected);

  dispose();
  target.remove();
});
