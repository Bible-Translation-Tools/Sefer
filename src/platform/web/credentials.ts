/**
 * The Web host's credential store: `localStorage`, with an honest note about
 * what that does and does not buy.
 *
 * Why persist at all, when the Web has nowhere trustworthy to put a token: a
 * session-only store signs you out of Gitea on every RELOAD, and a session
 * that does not survive a reload is not a session. (Token names are minted
 * per device and minute, so signing in again after a reload does not collide
 * with `400 access token name has been used already`.)
 *
 * ## What this is, precisely
 *
 * `localStorage` is origin-scoped and survives a reload and a restart. It is
 * NOT a secure store: any script that runs on this origin can read it, so a
 * cross-site scripting hole in Sefer becomes a stolen Gitea token. The honest
 * summary is that this is as safe as the page itself, which is the same bargain
 * every browser application that stays signed in makes — and the token is
 * scoped (`SESSION_TOKEN_SCOPES`, notably no `write:admin`), named after the
 * device and the minute it was minted, and revocable from Gitea's own settings
 * page, which are the three things that make the bargain survivable.
 *
 * Desktop does better and should: `TauriCredentialsLive` uses the OS keychain.
 * If a browser ever offers a real credential store, this file is the one place
 * that changes.
 *
 * Failure is never fatal. A private window, a browser with site data blocked
 * and a full quota all make the calls below throw, and every one of them is
 * caught: the store falls back to memory, for that session only.
 */

import { Effect, Layer, Option } from "effect";

import type { Credential, CredentialsService } from "#core/host/credentials";
import { Credentials } from "#core/host/credentials";

/** One key per remote, under a prefix nothing else in the page may use. */
const PREFIX = "sefer.credentials.";

const keyOf = (remote: string): string => `${PREFIX}${remote}`;

/**
 * `localStorage`, or `undefined` where it cannot be reached.
 *
 * Read through a function rather than captured once: a browser can refuse the
 * property itself (a `SecurityError` on access, not on use), and the check has
 * to survive being asked in that state.
 */
const store = (): Storage | undefined => {
  try {
    const held: Storage | undefined = globalThis.localStorage;
    return typeof held === "object" && held !== null ? held : undefined;
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const text = (held: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const value = held[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

/**
 * A stored credential, decoded rather than asserted. A record that has lost
 * its username or its token is not a credential and reads as absent — the
 * caller signs in again, which is the correct outcome for a store somebody
 * hand-edited or a build wrote under an older shape.
 */
const decode = (raw: string): Credential | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const username = text(parsed, "username");
  const token = text(parsed, "token");
  if (username === undefined || token === undefined) return undefined;
  const tokenName = text(parsed, "tokenName");
  const tokenId = text(parsed, "tokenId");
  return {
    username,
    token,
    ...(tokenName === undefined ? {} : { tokenName }),
    ...(tokenId === undefined ? {} : { tokenId }),
  };
};

export const WebCredentialsLive: Layer.Layer<Credentials> = Layer.sync(Credentials, () => {
  /** The fallback, and the live copy: reads never have to touch storage twice. */
  const held = new Map<string, Credential>();

  const persisted = store();
  if (persisted !== undefined) {
    try {
      for (let index = 0; index < persisted.length; index += 1) {
        const key = persisted.key(index);
        if (key === null || !key.startsWith(PREFIX)) continue;
        const raw = persisted.getItem(key);
        const credential = raw === null ? undefined : decode(raw);
        if (credential !== undefined) held.set(key.slice(PREFIX.length), credential);
      }
    } catch {
      // A store that will not enumerate is a store with nothing in it, as far
      // as this session is concerned.
    }
  }

  const write = (remote: string, credential: Credential | undefined): void => {
    const target = store();
    if (target === undefined) return;
    try {
      if (credential === undefined) target.removeItem(keyOf(remote));
      else target.setItem(keyOf(remote), JSON.stringify(credential));
    } catch {
      // Quota, or a browser that refuses to write. The in-memory copy above is
      // still correct for this session; only the survival of a reload is lost.
    }
  };

  return {
    get: (remote) => Effect.sync(() => Option.fromUndefinedOr(held.get(remote))),
    set: (remote, credential) =>
      Effect.sync(() => {
        held.set(remote, credential);
        write(remote, credential);
      }),
    clear: (remote) =>
      Effect.sync(() => {
        held.delete(remote);
        write(remote, undefined);
      }),
  } satisfies CredentialsService;
});
