/**
 * `pnpm wacs:check`: proof that the local WACS (`pnpm wacs:up`) is whole —
 * Forgejo, the browser git proxy in front of it, and Sefer's own Web code
 * talking to both the way the browser build does. Run it before driving the
 * app against the local WACS; it is not part of `pnpm check`.
 *
 * Everything goes through the proxy with Sefer's app header, as Bob: sign in
 * (a token is minted), read Alice's open suggestions, clone his fork, push a
 * branch, suggest it to Alice and take it back, publish a new project. Then
 * the throwaway repos are deleted straight on Forgejo.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterAll, describe, expect, it } from "vitest";

import { LOCAL_WACS, WEB_TRANSPORT_SPEC } from "#core/remote/channels";
import { Gitea, GiteaLive, type HttpFetch } from "#core/remote/gitea";
import { Remote } from "#core/remote/remote";
import { Suggestions, SuggestionsLive } from "#core/remote/suggestions";
import { parseTransport, through } from "#core/remote/transport";
import { WebCredentialsLive } from "#platform/web/credentials";
import { WebRemoteLive } from "#platform/web/remote";

import { ACCOUNTS } from "./accounts";

const HOST = LOCAL_WACS.contentHost;
const APP = "sefer-local";
const transport = parseTransport(WEB_TRANSPORT_SPEC);
const { admin, alice, bob } = ACCOUNTS;
const stamp = Date.now().toString(36);

/** As `services.ts`'s `webFetch`: through the proxy, with the app header. */
const viaProxy: HttpFetch = (input, init) =>
  globalThis.fetch(through(transport, input), {
    ...init,
    headers: { ...init?.headers, "X-Requested-With": APP },
  });

const account = Layer.provideMerge(
  Layer.provideMerge(
    SuggestionsLive({ fetch: viaProxy }),
    GiteaLive({ fetch: viaProxy, platform: "web" }),
  ),
  WebCredentialsLive,
);
const layer = Layer.provideMerge(
  WebRemoteLive({ contentHost: HOST, transport, appId: APP }),
  Layer.merge(account, NodeFileSystem.layer),
);

/** One runtime for the whole check, so Bob's sign-in carries from step to step. */
const runtime = ManagedRuntime.make(layer);
const run = <A, E>(effect: Effect.Effect<A, E, Gitea | Suggestions | Remote>): Promise<A> =>
  runtime.runPromise(effect);

const scratch = mkdtempSync(join(tmpdir(), "sefer-wacs-check-"));
const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=Bob", "-c", "user.email=bob@example.invalid", ...args], {
    cwd: dir,
    encoding: "utf8",
  }).trim();

const asAdmin = (method: string, path: string): Promise<Response> =>
  globalThis.fetch(`${HOST}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${admin.username}:${admin.password}`).toString("base64")}`,
    },
  });

afterAll(async () => {
  await runtime.dispose();
  rmSync(scratch, { recursive: true, force: true });
  await asAdmin("DELETE", `/repos/${bob.username}/check-${stamp}`);
  // The suggestion's branch on Bob's fork goes with the fork's own API.
  await asAdmin("DELETE", `/repos/${bob.username}/en_small-nt/branches/check-${stamp}`);
});

describe("the local WACS", () => {
  it("is up, and the proxy fronts it for a browser", async () => {
    const direct = await globalThis.fetch(`${HOST}/api/v1/version`).catch(() => undefined);
    expect(direct?.ok, `Forgejo is not answering at ${HOST}: run pnpm wacs:up`).toBe(true);

    const preflight = await globalThis.fetch(`${LOCAL_WACS.proxy}/api/v1/user`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,x-requested-with",
      },
    });
    // The proxy answers a preflight for any origin; the real request echoes it.
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

    const anonymous = await globalThis.fetch(
      `${LOCAL_WACS.proxy}/${alice.username}/en_small-nt.git/info/refs?service=git-upload-pack`,
    );
    expect(anonymous.status, "the proxy lets in only known apps").toBe(403);
  });

  it("signs Bob in and reads Alice's open suggestions", async () => {
    const session = await run(
      Effect.gen(function* () {
        return yield* (yield* Gitea).login({
          host: HOST,
          username: bob.username,
          password: bob.password,
        });
      }),
    );
    expect(session.username).toBe(bob.username);

    const open = await run(
      Effect.gen(function* () {
        return yield* (yield* Suggestions).open(HOST, alice.username, "en_small-nt");
      }),
    );
    expect(open.some((suggestion) => suggestion.author === bob.username)).toBe(true);
  });

  it("clones Bob's fork, pushes a branch, suggests it and takes it back", async () => {
    const into = join(scratch, "fork");
    const branch = `check-${stamp}`;
    const { repo } = await run(
      Effect.gen(function* () {
        return yield* (yield* Remote).clone(`${HOST}/${bob.username}/en_small-nt.git`, into);
      }),
    );
    git(repo.root, "switch", "-q", "-c", branch);
    writeFileSync(join(repo.root, "66-JUD.usfm"), `\\id JUD checked ${stamp}\n`, { flag: "a" });
    git(repo.root, "commit", "-qam", `Checked ${stamp}`);
    await run(
      Effect.gen(function* () {
        yield* (yield* Remote).push(repo);
      }),
    );

    const suggested = await run(
      Effect.gen(function* () {
        return yield* (yield* Suggestions).suggest(HOST, alice.username, "en_small-nt", {
          from: bob.username,
          branch,
          base: "master",
          title: `Checked ${stamp}`,
          body: "From pnpm wacs:check; taken back at once.",
        });
      }),
    );
    expect(suggested.state).toBe("open");

    const closed = await run(
      Effect.gen(function* () {
        const suggestions = yield* Suggestions;
        yield* suggestions.decline(HOST, alice.username, "en_small-nt", suggested.number, "");
        return yield* suggestions.one(HOST, alice.username, "en_small-nt", suggested.number);
      }),
    );
    expect(closed?.state).toBe("closed");
  });

  it("publishes a new project as Bob's", async () => {
    const dir = join(scratch, "new");
    execFileSync("git", ["init", "-q", "-b", "master", dir]);
    writeFileSync(join(dir, "65-3JN.usfm"), "\\id 3JN\n\\c 1\n\\v 1 Checked.\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "New project");
    await run(
      Effect.gen(function* () {
        yield* (yield* Remote).publish({ root: dir }, `check-${stamp}`);
      }),
    );
    // Read off the server's refs: Forgejo's API calls a repo empty until its
    // queue has seen the push, a moment after the push itself has landed.
    const there = execFileSync(
      "git",
      ["ls-remote", `${HOST}/${bob.username}/check-${stamp}.git`, "refs/heads/master"],
      { encoding: "utf8" },
    ).split("\t")[0];
    expect(there).toBe(git(dir, "rev-parse", "HEAD"));
  });
});
