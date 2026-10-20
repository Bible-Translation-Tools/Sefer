import { execFileSync } from "node:child_process";
import process from "node:process";

import { channelEnv } from "./channels.ts";

const ENVIRONMENTS = {
  production: { mode: "production", design: false, release: true },
  preview: { mode: "production", design: false, release: true },
  dev: { mode: "dev", design: true, release: false },
} as const;

type Environment = keyof typeof ENVIRONMENTS;

const isEnvironment = (value: string): value is Environment => Object.hasOwn(ENVIRONMENTS, value);

const REQUIRED = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;

const run = (
  command: string,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv } = {},
): void => {
  process.stdout.write(`$ ${command} ${args.join(" ")}\n`);
  execFileSync(command, [...args], { stdio: "inherit", ...options });
};

const main = (): void => {
  const [name, ...rest] = process.argv.slice(2);
  const dry = rest.includes("--dry");

  if (name === undefined || !isEnvironment(name)) {
    process.stderr.write(
      `deploy:web: expected one of ${Object.keys(ENVIRONMENTS).join(", ")}\n` +
        "  pnpm deploy:web dev --dry\n",
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

  const endpoints = channelEnv(name);
  const inherited = Object.fromEntries(
    Object.entries(endpoints).filter(([key]) => (process.env[key] ?? "") !== ""),
  );
  for (const [key, value] of Object.entries(endpoints)) {
    process.stdout.write(
      `deploy:web: ${key}=${process.env[key] ?? value}${key in inherited ? " (from the environment)" : ""}\n`,
    );
  }

  run("pnpm", ["exec", "vite", "build", "--mode", target.mode], {
    env: { ...endpoints, ...process.env },
  });

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
