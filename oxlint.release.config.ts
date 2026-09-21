import { defineConfig } from "oxlint";

import base from "./oxlint.config.ts";

/**
 * The ordinary lint, plus the rules that only have to hold at RELEASE.
 *
 *     pnpm lint:release
 *
 * Today that is one rule: `anti-slop/no-design-scaffolding`, which fails if
 * `globalThis.__sefer.design` is still being called from application code.
 * Scaffolding a real screen with design tweaks is a legitimate way to settle a
 * question — see `documentation/architecture/design.md` — and a squiggle under
 * code somebody is actively iterating with is how a rule teaches people to
 * turn it off. So it is off in `oxlint.config.ts` and on here.
 *
 * `tools/deploy/web.ts` runs this before a PRODUCTION build and before
 * nothing else. The dev server and the design build the designer and the
 * product owner look at are exactly the builds where the scaffolding is doing
 * its job.
 *
 * A separate config rather than a CLI flag because `-D <rule>` does not reach
 * JS plugin rules — the rule has to be named in `rules` to be active at all,
 * which is checked rather than assumed: `pnpm lint:release` on a file that
 * calls the global fails, and `pnpm lint` on the same file does not.
 */
export default defineConfig({
  ...base,
  rules: {
    ...base.rules,
    "anti-slop/no-design-scaffolding": "error",
  },
});
