/**
 * `pnpm wacs:up [--reset]`: start the local WACS (tools/wacs/compose.yml) and
 * seed it. Safe to re-run: whatever is already there is left alone.
 *
 * The proxy's source is a private repo, so it is cloned here with the
 * person's own GitHub sign-in (`gh`, else `git` over SSH) into
 * tools/wacs/.proxy, gitignored. `WACS_PROXY_SRC=<checkout>` uses a checkout
 * of your own instead, for working on the proxy itself.
 *
 * Prints one JSON line: the addresses, the accounts, and how to point Sefer
 * at it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LOCAL_WACS } from "../../src/core/remote/channels.ts";
import { ACCOUNTS, type Account } from "./accounts.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const COMPOSE = ["compose", "-f", join(HERE, "compose.yml")];
const HOST = LOCAL_WACS.contentHost;
const PROXY_REPO = "WycliffeAssociates/wacs-browser-git-proxy";

const run = (command: string, args: readonly string[], options: { cwd?: string } = {}): string =>
  execFileSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();

const step = (text: string): void => {
  process.stderr.write(`wacs: ${text}\n`);
};

const proxySource = (): string => {
  const own = process.env.WACS_PROXY_SRC;
  if (own !== undefined && own !== "") return resolve(own);
  const held = join(HERE, ".proxy");
  if (existsSync(join(held, "wrangler.toml"))) return held;
  step(`cloning ${PROXY_REPO} into tools/wacs/.proxy`);
  const viaGh = spawnSync("gh", ["repo", "clone", PROXY_REPO, held, "--", "--depth", "1"], {
    stdio: "inherit",
  });
  if (viaGh.status !== 0)
    run("git", ["clone", "--depth", "1", `git@github.com:${PROXY_REPO}.git`, held]);
  return held;
};

const compose = (args: readonly string[], proxy: string): void => {
  const done = spawnSync("docker", [...COMPOSE, ...args], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, WACS_PROXY_SRC: proxy },
  });
  if (done.status !== 0) throw new Error(`docker ${[...COMPOSE, ...args].join(" ")} failed`);
};

const createUser = (account: Account, admin: boolean): void => {
  const made = spawnSync(
    "docker",
    [
      ...COMPOSE,
      "exec",
      "-T",
      "gitea",
      "forgejo",
      "admin",
      "user",
      "create",
      "--username",
      account.username,
      "--password",
      account.password,
      "--email",
      `${account.username}@example.invalid`,
      "--must-change-password=false",
      ...(admin ? ["--admin"] : []),
    ],
    { encoding: "utf8" },
  );
  if (made.status !== 0 && !/already exists/u.test(`${made.stdout}${made.stderr}`))
    throw new Error(`creating ${account.username}: ${made.stderr}`);
};

const api = async (
  as: Account,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ readonly status: number; readonly json: unknown }> => {
  const response = await fetch(`${HOST}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${as.username}:${as.password}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (response.status >= 400 && response.status !== 404 && response.status !== 409)
    throw new Error(`${method} ${path} as ${as.username}: ${String(response.status)} ${text}`);
  return { status: response.status, json };
};

const exists = async (owner: string, name: string): Promise<boolean> =>
  (await api(ACCOUNTS.admin, "GET", `/repos/${owner}/${name}`)).status === 200;

const authed = (as: Account, path: string): string => {
  const url = new URL(`${HOST}/${path}.git`);
  url.username = as.username;
  url.password = as.password;
  return url.toString();
};

const scratch = (): string => mkdtempSync(join(tmpdir(), "sefer-wacs-"));

const git = (dir: string, ...args: string[]): string =>
  run("git", ["-c", "user.name=Sefer seed", "-c", "user.email=seed@example.invalid", ...args], {
    cwd: dir,
  });

/** A new repo holding small-nt's books, in two commits so there is a history to read. */
const pushSmallNt = (as: Account, path: string): void => {
  const dir = scratch();
  try {
    git(dir, "init", "-q", "-b", "master");
    for (const name of readdirSync(join(ROOT, "fixtures/small-nt")))
      if (name !== "19-PSA.usfm") cpSync(join(ROOT, "fixtures/small-nt", name), join(dir, name));
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "New Testament books");
    cpSync(join(ROOT, "fixtures/small-nt/19-PSA.usfm"), join(dir, "19-PSA.usfm"));
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "Psalms");
    git(dir, "push", "-q", authed(as, path), "master");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const pushBundle = (as: Account, path: string, bundle: string): void => {
  const dir = scratch();
  try {
    run("git", ["clone", "-q", join(ROOT, "fixtures/writer", bundle), dir]);
    git(dir, "push", "-q", authed(as, path), "HEAD:refs/heads/master");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const ownRepo = async (as: Account, name: string, fill?: () => void): Promise<boolean> => {
  if (await exists(as.username, name)) return false;
  await api(as, "POST", "/user/repos", { name, default_branch: "master", auto_init: false });
  fill?.();
  step(`seeded ${as.username}/${name}`);
  return true;
};

/** Bob's fork of Alice's project, with one suggestion open against it. */
const forkWithSuggestion = async (): Promise<void> => {
  const { alice, bob } = ACCOUNTS;
  if (await exists(bob.username, "en_small-nt")) return;
  await api(bob, "POST", `/repos/${alice.username}/en_small-nt/forks`, {});
  for (let tries = 0; tries < 30 && !(await exists(bob.username, "en_small-nt")); tries += 1)
    await new Promise((done) => setTimeout(done, 500));
  const dir = scratch();
  try {
    run("git", ["clone", "-q", authed(bob, `${bob.username}/en_small-nt`), dir]);
    git(dir, "switch", "-q", "-c", "suggestion");
    const book = join(dir, "65-3JN.usfm");
    const text = readFileSync(book, "utf8");
    writeFileSync(book, text.replace(/\\v 1 /u, "\\v 1 (Bob's suggestion) "));
    git(dir, "commit", "-qam", "A suggestion for 3 John 1:1");
    git(dir, "push", "-q", "origin", "suggestion");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  await api(bob, "POST", `/repos/${alice.username}/en_small-nt/pulls`, {
    head: `${bob.username}:suggestion`,
    base: "master",
    title: "A suggestion for 3 John 1:1",
    body: "Seeded by pnpm wacs:up.",
  });
  step(`seeded ${bob.username}/en_small-nt and its suggestion`);
};

/** An organisation both people write to: the shared way of working. */
const sharedOrg = async (): Promise<void> => {
  const { admin, alice, bob } = ACCOUNTS;
  const org = "wa-local";
  if ((await api(admin, "GET", `/orgs/${org}`)).status === 404)
    await api(admin, "POST", "/orgs", { username: org, visibility: "public" });
  const teams = (await api(admin, "GET", `/orgs/${org}/teams`)).json;
  const owners: unknown = Array.isArray(teams)
    ? teams.find((team: unknown) => Reflect.get(Object(team), "name") === "Owners")
    : undefined;
  const id: unknown = owners === undefined ? undefined : Reflect.get(Object(owners), "id");
  if (typeof id !== "number") throw new Error(`${org} has no Owners team`);
  for (const person of [alice, bob])
    await api(admin, "PUT", `/teams/${String(id)}/members/${person.username}`);
  if (await exists(org, "en_shared")) return;
  await api(admin, "POST", `/orgs/${org}/repos`, {
    name: "en_shared",
    default_branch: "master",
    auto_init: false,
  });
  pushSmallNt(alice, `${org}/en_shared`);
  step(`seeded ${org}/en_shared`);
};

const main = async (): Promise<void> => {
  const proxy = proxySource();
  if (process.argv.includes("--reset")) {
    step("throwing the local WACS away");
    compose(["down", "-v", "--remove-orphans"], proxy);
  }
  step("starting Forgejo and the proxy (the first build takes a minute or two)");
  compose(["up", "-d", "--build", "--wait"], proxy);

  createUser(ACCOUNTS.admin, true);
  createUser(ACCOUNTS.alice, false);
  createUser(ACCOUNTS.bob, false);

  const { alice, bob } = ACCOUNTS;
  await ownRepo(alice, "en_small-nt", () => pushSmallNt(alice, `${alice.username}/en_small-nt`));
  await forkWithSuggestion();
  await ownRepo(alice, "empty");
  await ownRepo(alice, "kpass_tmf_3jn_text_reg", () =>
    pushBundle(alice, `${alice.username}/kpass_tmf_3jn_text_reg`, "kpass_tmf_3jn_text_reg.bundle"),
  );
  await ownRepo(bob, "bahasatech.indotimur_kps-x-kaigar_3jn_text_reg", () =>
    pushBundle(
      bob,
      `${bob.username}/bahasatech.indotimur_kps-x-kaigar_3jn_text_reg`,
      "bahasatech.indotimur_kps-x-kaigar_3jn_text_reg.bundle",
    ),
  );
  await sharedOrg();

  console.log(
    JSON.stringify({
      forgejo: HOST,
      proxy: LOCAL_WACS.proxy,
      accounts: Object.fromEntries(
        Object.entries(ACCOUNTS).map(([role, account]) => [role, account]),
      ),
      sefer: "pnpm dev:wacs, or Settings → Network → Local WACS on the dev server",
      check: "pnpm wacs:check",
    }),
  );
};

await main();
