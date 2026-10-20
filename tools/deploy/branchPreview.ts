import { execFileSync } from "node:child_process";
import process from "node:process";

import { channelEnv } from "./channels.ts";

const CHANNEL = "dev" as const;
const MODE = "dev" as const;

const REQUIRED = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;

const MAX_ALIAS = 28;

export const aliasFor = (branch: string): string => {
  const slug = branch
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return slug.slice(0, MAX_ALIAS).replaceAll(/-+$/gu, "");
};

const currentBranch = (): string =>
  execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();

const run = (
  command: string,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv } = {},
): void => {
  process.stdout.write(`$ ${command} ${args.join(" ")}\n`);
  execFileSync(command, [...args], { stdio: "inherit", ...options });
};

const main = (): void => {
  const rest = process.argv.slice(2);
  const dry = rest.includes("--dry");
  const named = rest.find((one) => !one.startsWith("--"));
  const branch = named ?? currentBranch();
  const alias = aliasFor(branch);

  if (alias === "") {
    process.stderr.write(`branch:preview: "${branch}" has no usable alias in it\n`);
    process.exitCode = 1;
    return;
  }

  if (branch === "master" || branch === "HEAD") {
    process.stderr.write(
      "branch:preview: master already deploys the dev channel on every push; " +
        "a version preview of it would only be a second URL for the same commit.\n",
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `branch:preview: ${branch} -> alias "${alias}", ` +
      `vite mode "${MODE}", uploading a VERSION of the ${CHANNEL} worker (not deploying it)\n`,
  );

  const endpoints = channelEnv(CHANNEL);
  run("pnpm", ["exec", "vite", "build", "--mode", MODE], {
    env: { ...endpoints, ...process.env },
  });

  const args = [
    "exec",
    "wrangler",
    "versions",
    "upload",
    "--env",
    CHANNEL,
    "--preview-alias",
    alias,
    "--message",
    `branch ${branch}`,
  ];

  const missing = REQUIRED.filter((key) => (process.env[key] ?? "") === "");
  if (dry) {
    process.stdout.write(`branch:preview: dry run — would run: pnpm ${args.join(" ")}\n`);
    if (missing.length > 0) {
      process.stdout.write(
        `branch:preview: (${missing.join(", ")} not set; a real run needs them)\n`,
      );
    }
    return;
  }
  if (missing.length > 0) {
    process.stderr.write(
      `branch:preview: ${missing.join(", ")} not set. In CI these come from 1Password; ` +
        "locally, export them or pass --dry.\n",
    );
    process.exitCode = 1;
    return;
  }

  run("pnpm", args);
};

if (import.meta.main) main();
