/**
 * Deploy the Tauri updater worker, and push its GitHub token as a Worker
 * secret in the same breath.
 *
 *     pnpm deploy:updater preview
 *     pnpm deploy:updater production
 *     pnpm deploy:updater preview --dry     # bundle and print, ship nothing
 *
 * Separate from `deploy:web` because these are two different deployables on
 * two different hostnames with two different failure modes — and because the
 * one thing that must never happen is deploying one while meaning the other.
 *
 * `--config` is passed explicitly on every invocation. Wrangler run from the
 * repository root without it falls back to the root `wrangler.jsonc` and
 * redeploys the SPA instead of this worker; the old repo hit exactly that and
 * left a comment about it. The flag is not optional politeness.
 *
 * Two channels, not three: `dev` is web-only and has no desktop app to
 * update.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

const CONFIG = "workers/sefer-updater/wrangler.toml";

/** The desktop channels. `dev` is deliberately absent. */
const ENVIRONMENTS = ["preview", "production"] as const;
type Environment = (typeof ENVIRONMENTS)[number];

const isEnvironment = (value: string): value is Environment =>
  ENVIRONMENTS.some((known) => known === value);

const run = (args: readonly string[], input?: string): void => {
  process.stdout.write(`$ pnpm ${args.join(" ")}\n`);
  execFileSync("pnpm", [...args], {
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    ...(input === undefined ? {} : { input }),
  });
};

const main = (): void => {
  const [name, ...rest] = process.argv.slice(2);
  const dry = rest.includes("--dry");

  if (name === undefined || !isEnvironment(name)) {
    process.stderr.write(
      `deploy:updater: expected one of ${ENVIRONMENTS.join(", ")}\n` +
        "  pnpm deploy:updater preview --dry\n" +
        "(there is no dev channel: dev is web-only and has nothing to update)\n",
    );
    process.exitCode = 1;
    return;
  }

  if (dry) {
    run(["exec", "wrangler", "deploy", "--config", CONFIG, "--env", name, "--dry-run"]);
    return;
  }

  const cloudflare = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"].filter(
    (key) => (process.env[key] ?? "") === "",
  );
  if (cloudflare.length > 0) {
    process.stderr.write(
      `deploy:updater: ${cloudflare.join(", ")} not set. In CI these come from ` +
        "1Password; locally, export them or pass --dry.\n",
    );
    process.exitCode = 1;
    return;
  }

  run(["exec", "wrangler", "deploy", "--config", CONFIG, "--env", name]);

  /**
   * The token is refreshed on every deploy rather than set once by hand, so
   * the pipeline is the single rotation point: renewing it is a 1Password
   * edit and a redeploy, not a hunt for who ran `wrangler secret put` and
   * when. Piped on stdin so it never appears in a process list or a log.
   *
   * Absent is a warning, not a failure — the worker runs unauthenticated. It
   * just runs into GitHub's 60-requests-an-hour-per-IP limit, which on shared
   * Cloudflare egress is a matter of when rather than whether.
   */
  const token = process.env["UPDATER_GH_TOKEN"] ?? "";
  if (token === "") {
    process.stdout.write(
      "deploy:updater: UPDATER_GH_TOKEN not set — GH_TOKEN left as it was.\n" +
        "  Unauthenticated GitHub is 60 req/hr per IP and Workers share egress IPs.\n",
    );
    return;
  }
  run(["exec", "wrangler", "secret", "put", "GH_TOKEN", "--config", CONFIG, "--env", name], token);
};

if (import.meta.main) main();
