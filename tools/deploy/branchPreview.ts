/**
 * A URL for one branch, without deploying anything.
 *
 *     pnpm branch:preview                      # alias from the current branch
 *     pnpm branch:preview design/cards         # or name it
 *     pnpm branch:preview --dry                # build, print the command, ship nothing
 *
 * ## What this is, and what it is NOT
 *
 * This is a **CloudflarePreview**: `wrangler versions upload` publishes a new
 * VERSION of a Worker and does not change what any hostname serves. It is not
 * the **ChannelPreview** — that is the `preview` channel on
 * `sefer-preview.bttdev.org`, a promotion with the full test suite and the
 * full desktop matrix behind it. The two words are kept apart deliberately;
 * see `documentation/glossary.md`, "Deployment names".
 *
 * ## Why it exists
 *
 * Without it, the only way to let somebody test drive a change was to push to
 * master, because master is the only thing that deploys a web build. For the
 * one person here who does not use git, that turned "show me" into "push to
 * the trunk", which is both the busiest branch and the one with no pre-merge
 * gate. A branch preview removes the reason to do that: branch, push, send the
 * link.
 *
 * ## Why it builds `--mode dev`
 *
 * Because the point is showing a screen to somebody, and `dev` is the only
 * mode carrying `/design`, the comment panel and `?fixture=1`. A branch
 * preview built any other way would be a URL you cannot comment on, which is
 * most of what it is for.
 *
 * It uploads into the `dev` ENVIRONMENT (`sefer-web-dev`) for the same reason
 * — same worker, same bindings, same settings as the channel it is a version
 * of. `sefer-dev.bttdev.org` keeps serving whatever master last DEPLOYED,
 * because uploading a version is not deploying one.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

import { channelEnv } from "./channels.ts";

/** The channel whose Worker holds these versions, and the mode they are built in. */
const CHANNEL = "dev" as const;
const MODE = "dev" as const;

const REQUIRED = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;

/**
 * An alias is a HOSTNAME LABEL, so it has to survive being one.
 *
 * `design/onboarding-cards` is a perfectly good branch name and not a
 * hostname: the slash cannot appear, and the whole label — alias plus
 * `-sefer-web-dev` — has a length ceiling. So: lowercase, anything that is not
 * a letter or digit becomes a dash, no leading or trailing dash, and a cap
 * well under the limit.
 *
 * Truncation can collide (two long branches sharing a prefix would share a
 * URL). That is accepted rather than solved with a hash suffix, because an
 * alias somebody can read and retype is most of the value, and the cost of a
 * collision is two branches overwriting one preview rather than anything
 * being lost.
 */
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

  // Checked after the build, so `--dry` never needs credentials and a missing
  // one costs a rebuild rather than a mystery.
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
