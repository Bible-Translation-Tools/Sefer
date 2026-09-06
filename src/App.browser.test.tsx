import { render } from "@solidjs/web";
import { expect, test } from "vitest";
import { page } from "vitest/browser";

import App from "./App";

test("mounts and disposes the shared application", async () => {
  const target = document.createElement("div");
  document.body.append(target);

  const dispose = render(() => <App />, target);

  await expect.element(page.getByRole("heading", { name: "Sefer" })).toBeVisible();

  dispose();
  target.remove();
});
