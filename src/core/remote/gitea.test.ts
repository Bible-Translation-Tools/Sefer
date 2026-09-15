import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import { Credentials, SessionCredentialsLive } from "../host/credentials";
import { Gitea, GiteaLive, type HttpRequest, type HttpResponse } from "./gitea";

interface Call {
  readonly url: string;
  readonly method: string;
  /** The `name` the request asked for, or "" when it asked for none. */
  readonly name: string;
}

/** The `name` field of a JSON body, read structurally rather than asserted. */
const nameIn = (body: string | undefined): string => {
  if (body === undefined) return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return "";
  }
  if (typeof parsed !== "object" || parsed === null) return "";
  const value = Reflect.get(parsed, "name");
  return typeof value === "string" ? value : "";
};

/** A failure's `description`: these are tagged errors, whose `toString` is the tag. */
const descriptionOf = (failure: unknown): string => {
  if (typeof failure !== "object" || failure === null) return String(failure);
  const value = Reflect.get(failure, "description");
  return typeof value === "string" ? value : "";
};

const answer = (status: number, body: unknown): HttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  json: () => Promise.resolve(body),
});

/**
 * A Gitea that behaves the way the real one did: it already holds a token
 * under the name the first attempt asks for, and refuses the duplicate with
 * the exact message Gitea sends.
 */
const mockGitea = (options: { readonly allowDelete: boolean }) => {
  const calls: Call[] = [];
  const taken = new Set<string>();
  let first = true;

  const fetch = (url: string, init?: HttpRequest): Promise<HttpResponse> => {
    const method = init?.method ?? "GET";
    const name = nameIn(init?.body);
    calls.push({ url, method, name });

    if (method === "POST" && url.endsWith("/tokens")) {
      // The first name asked for is always already taken — that is the bug.
      if (first) {
        first = false;
        taken.add(name);
        return Promise.resolve(answer(400, "access token name has been used already"));
      }
      if (taken.has(name))
        return Promise.resolve(answer(400, "access token name has been used already"));
      taken.add(name);
      return Promise.resolve(answer(201, { id: 7, name, sha1: "deadbeef" }));
    }
    if (method === "DELETE" && url.includes("/tokens/")) {
      if (!options.allowDelete) return Promise.resolve(answer(403, "forbidden"));
      taken.delete(decodeURIComponent(url.slice(url.lastIndexOf("/") + 1)));
      return Promise.resolve(answer(204, ""));
    }
    return Promise.resolve(answer(404, "not found"));
  };

  return { calls, fetch };
};

const run = <A>(
  fetch: (url: string, init?: HttpRequest) => Promise<HttpResponse>,
  program: Effect.Effect<A, unknown, Gitea | Credentials>,
): Promise<A> =>
  Effect.runPromise(
    Effect.provide(
      program,
      Layer.provideMerge(GiteaLive({ fetch, platform: "web" }), SessionCredentialsLive),
    ),
  );

const login = Effect.flatMap(Gitea, (gitea) =>
  gitea.login({ host: "https://git.example.org/", username: "ada", password: "hunter2" }),
);

describe("Gitea.login", () => {
  it("names the token to the second, not to the day", async () => {
    const mock = mockGitea({ allowDelete: true });
    await run(mock.fetch, login);
    // sefer-web-20260915T124233. A date alone could not tell two sign-ins on
    // one day apart, which is what made a page reload unrecoverable.
    expect(mock.calls[0]?.name).toMatch(/^sefer-web-\d{8}T\d{6}$/u);
  });

  it("deletes its own stale token and retries when the name is taken", async () => {
    const mock = mockGitea({ allowDelete: true });
    const session = await run(mock.fetch, login);
    expect(session.token).toBe("deadbeef");
    expect(mock.calls.map((call) => call.method)).toEqual(["POST", "DELETE", "POST"]);
    // The retry uses the SAME name: the stale one is gone, so a person's token
    // list does not accumulate near-duplicates.
    expect(mock.calls[2]?.name).toBe(mock.calls[0]?.name);
  });

  it("falls back to a unique name when the instance will not delete", async () => {
    const mock = mockGitea({ allowDelete: false });
    const session = await run(mock.fetch, login);
    expect(session.token).toBe("deadbeef");
    const firstName = mock.calls[0]?.name ?? "";
    const retried = mock.calls[2]?.name ?? "";
    expect(retried).not.toBe(firstName);
    expect(retried.startsWith(firstName)).toBe(true);
  });

  it("reports a 400 that is not a name collision, in Gitea's own words", async () => {
    const fetch = (): Promise<HttpResponse> => Promise.resolve(answer(400, "scopes are invalid"));
    const failure = await run(fetch, Effect.flip(login));
    expect(descriptionOf(failure)).toContain("scopes are invalid");
  });

  it("keeps the session where a later call can find it", async () => {
    const mock = mockGitea({ allowDelete: true });
    const held = await run(
      mock.fetch,
      Effect.gen(function* () {
        yield* login;
        const gitea = yield* Gitea;
        return yield* gitea.session("https://git.example.org");
      }),
    );
    expect(Option.isSome(held)).toBe(true);
    expect(Option.getOrThrow(held).username).toBe("ada");
  });
});
