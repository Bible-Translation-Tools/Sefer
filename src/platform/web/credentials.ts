import { Effect, Layer, Option } from "effect";

import type { Credential, CredentialsService } from "#core/host/credentials";
import { Credentials } from "#core/host/credentials";

const PREFIX = "sefer.credentials.";

const keyOf = (remote: string): string => `${PREFIX}${remote}`;

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
    } catch {}
  }

  const write = (remote: string, credential: Credential | undefined): void => {
    const target = store();
    if (target === undefined) return;
    try {
      if (credential === undefined) target.removeItem(keyOf(remote));
      else target.setItem(keyOf(remote), JSON.stringify(credential));
    } catch {}
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
