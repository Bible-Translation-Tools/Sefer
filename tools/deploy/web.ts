/**
 * Build the web frontend for one Cloudflare environment and ship it.
 *
 *     pnpm deploy:web production     # a tagged release, no design surface
 *     pnpm deploy:web nightly        # master, no design surface
 *     pnpm deploy:web design         # master, WITH /design and the annotator
 *     pnpm deploy:web design --dry   # build and print the command, ship nothing
 *
 * One script rather than three workflow steps, because the build mode and the
 * wrangler environment have to agree and that agreement is the whole point:
 * `design` is the only environment built with `--mode design`, and the only
 * one that ends up carrying a tool which swallows every click. Putting the
 * pairing in a table here means CI cannot get it half-right, and somebody
 * deploying by hand runs the same code CI does.
 *
 * STUB, in the sense that the hostnames it deploys to are placeholders in
 * `wrangler.jsonc` and the credentials come from a 1Password vault that has no
 * Sefer entry yet. The script itself is real: `--dry` works today and prints
 * exactly what would run.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

/**
 * Which Vite mode builds each Cloudflare environment, and which of them has to
 * be clean of design scaffolding first.
 *
 * `release` is the gate: `pnpm lint:release` fails if application code still
 * calls `globalThis.__sefer.design`. Only PRODUCTION runs it. Scaffolding a
 * real screen with tweaks is how a question gets settled, it is inert in any
 * build without the design surface, and blocking nightly — which comes off
 * master all day — would be the same friction as blocking `pnpm check`. By the
 * time something is tagged for release the question should be settled, and
 * that is the moment worth checking.
 */
const ENVIRONMENTS = {
  production: { mode: "production", design: false, release: true },
  nightly: { mode: "production", design: false, release: false },
  design: { mode: "design", design: true, release: false },
} as const;

type Environment = keyof typeof ENVIRONMENTS;

const isEnvironment = (value: string): value is Environment => Object.hasOwn(ENVIRONMENTS, value);

/**
 * The two variables wrangler needs. Sourced from 1Password in CI
 * (`op://DevOps/Sefer/...`), and expected to be already exported here — this
 * script never shells out to `op` itself, so it behaves identically on a
 * laptop and on a runner.
 */
const REQUIRED = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;

const run = (command: string, args: readonly string[]): void => {
  process.stdout.write(`$ ${command} ${args.join(" ")}\n`);
  execFileSync(command, [...args], { stdio: "inherit" });
};

const main = (): void => {
  const [name, ...rest] = process.argv.slice(2);
  const dry = rest.includes("--dry");

  if (name === undefined || !isEnvironment(name)) {
    process.stderr.write(
      `deploy:web: expected one of ${Object.keys(ENVIRONMENTS).join(", ")}\n` +
        "  pnpm deploy:web design --dry\n",
    );
    process.exitCode = 1;
    return;
  }

  const target = ENVIRONMENTS[name];
  process.stdout.write(
    `deploy:web: ${name} — vite mode "${target.mode}", design surface ${
      target.design ? "INCLUDED" : "excluded"
    }, release lint ${target.release ? "on" : "off"}\n`,
  );

  if (target.release) {
    process.stdout.write("deploy:web: release lint — scaffolding must be settled by now\n");
    run("pnpm", ["run", "lint:release"]);
  }

  run("pnpm", ["exec", "vite", "build", "--mode", target.mode]);

  // Checked AFTER the build, so a missing credential costs nothing but a
  // rebuild, and so `--dry` never needs them at all.
  const missing = REQUIRED.filter((key) => (process.env[key] ?? "") === "");
  if (dry) {
    process.stdout.write(
      `deploy:web: dry run — would run: pnpm exec wrangler deploy --env ${name}\n`,
    );
    if (missing.length > 0) {
      process.stdout.write(`deploy:web: (${missing.join(", ")} not set; a real run needs them)\n`);
    }
    return;
  }
  if (missing.length > 0) {
    process.stderr.write(
      `deploy:web: ${missing.join(", ")} not set. In CI these come from 1Password; ` +
        "locally, export them or pass --dry.\n",
    );
    process.exitCode = 1;
    return;
  }

  run("pnpm", ["exec", "wrangler", "deploy", "--env", name]);
};

if (import.meta.main) main();
