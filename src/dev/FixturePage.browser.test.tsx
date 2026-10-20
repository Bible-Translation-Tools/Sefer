import { render } from "@solidjs/web";
import { expect, test, vi } from "vitest";

import { composeApplication } from "#app/composition";
import { CompositionProvider } from "#app/CompositionContext";
import { smallNtFileNames } from "#core/fixture/smallNt";

import { FixturePage } from "./FixturePage";

test("the fixture route renders every seeded file and publishes dev state", async () => {
  const expected = smallNtFileNames().length;
  const composition = await composeApplication();
  const target = document.createElement("div");
  document.body.append(target);

  const dispose = render(
    () => (
      <CompositionProvider value={composition}>
        <FixturePage />
      </CompositionProvider>
    ),
    target,
  );

  await vi.waitFor(() => {
    expect(target.querySelectorAll("li").length).toBe(expected);
  });

  expect(globalThis.__sefer?.state?.().fixture).toHaveProperty("files.length", expected);

  const surface = globalThis.__sefer?.observability;
  expect(surface?.traces.recent().filter((one) => one.name === "boot").length).toBe(1);
  const notes = (surface?.logs.recent() ?? []).filter((event) => event.kind === "note");
  expect(notes.filter((event) => event.name === "fixture").length).toBe(1);

  dispose();
  target.remove();
});
