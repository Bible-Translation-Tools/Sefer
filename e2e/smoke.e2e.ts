/**
 * The built application comes up, routes resolve, and the design surface is
 * not in it.
 *
 * Four assertions, chosen because each one fails for a reason nothing else in
 * the repository would catch:
 *
 *   1. It mounts. A production bundle can fail where a dev server does not —
 *      a dropped dependency, a bad chunk boundary, a top-level await nobody
 *      noticed. Neither `pnpm check` nor the Vitest browser project would see
 *      it, because neither runs the real bundle.
 *   2. A deep link resolves. The static-assets Worker answers unknown paths
 *      with the shell; if that fallback is wrong, every URL anybody shares is
 *      broken and only a real server shows it.
 *   3. Nothing throws on the way. Cheap to check, and the usual first symptom.
 *   4. The design surface is absent. `pnpm verify:design` greps the artifacts;
 *      this checks the RUNNING page, which is the claim that actually matters.
 *
 * Deliberately says nothing about what any screen looks like or does. Those
 * are still moving, and a smoke suite that breaks on every redesign is one
 * people learn to skip.
 */

import { expect, test } from "@playwright/test";

/** Thrown errors and console errors, so a passing page cannot be quietly broken. */
const watchFailures = (page: import("@playwright/test").Page): string[] => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  return failures;
};

test("the built application mounts", async ({ page }) => {
  const failures = watchFailures(page);

  await page.goto("/");
  // The shell's status line is the last thing the application renders, so it
  // standing in for "booted" is not arbitrary — it means composition finished.
  await expect(page.locator("[data-testid='status-line']")).toBeVisible({ timeout: 30_000 });

  expect(failures, failures.join("\n")).toEqual([]);
});

test("a deep link resolves through the SPA fallback", async ({ page }) => {
  const failures = watchFailures(page);

  // Not the root: this is the assertion about `not_found_handling`, and only a
  // path the server has no file for can make it.
  await page.goto("/projects");
  await expect(page.locator("[data-testid='status-line']")).toBeVisible({ timeout: 30_000 });

  expect(failures, failures.join("\n")).toEqual([]);
});

test("a production build carries no design surface", async ({ page }) => {
  // `/design` is gated by a build-time constant, so a production build answers
  // it through the not-found boundary rather than rendering the panel.
  await page.goto("/design");
  await expect(page.locator("[data-design-surface]")).toHaveCount(0);

  // The floating annotator mounts from the root route on every page in a dev
  // or dev-channel build. Its absence here is the same claim `verify:design`
  // makes about the artifacts, asserted against what actually runs.
  await page.goto("/");
  await expect(page.locator("[data-sefer-annotate]")).toHaveCount(0);
});
