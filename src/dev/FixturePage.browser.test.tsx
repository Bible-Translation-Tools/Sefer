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

  // One composition, one ring: boot and the fixture note come out of the same
  // dev surface, and neither is duplicated. They are read from DIFFERENT
  // accessors because they are different shapes — boot is an operation and the
  // fixture note is a bare note — and reading both is how this notices if one
  // composition has quietly become two.
  const surface = globalThis.__sefer?.observability;
  expect(surface?.traces.recent().filter((one) => one.name === "boot").length).toBe(1);
  const notes = (surface?.logs.recent() ?? []).filter((event) => event.kind === "note");
  expect(notes.filter((event) => event.name === "fixture").length).toBe(1);

  dispose();
  target.remove();
});
