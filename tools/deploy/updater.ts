import { execFileSync } from "node:child_process";
import process from "node:process";

const CONFIG = "workers/sefer-updater/wrangler.toml";

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
