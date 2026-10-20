import { invoke } from "@tauri-apps/api/core";
import { Effect, Layer, Option } from "effect";

import { Credentials, type Credential } from "#core/host/credentials";

const KEYCHAIN_SERVICE = "org.wycliffe.sefer";

const decode = (secret: string): Option.Option<Credential> => {
  try {
    const parsed: unknown = JSON.parse(secret);
    if (parsed === null || typeof parsed !== "object") return Option.none();
    const record: Record<string, unknown> = { ...parsed };
    const { username, token, tokenName, tokenId } = record;
    if (typeof username !== "string" || typeof token !== "string") return Option.none();
    return Option.some({
      username,
      token,
      ...(typeof tokenName === "string" ? { tokenName } : {}),
      ...(typeof tokenId === "string" ? { tokenId } : {}),
    });
  } catch {
    return Option.none();
  }
};

const keychainSaid = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

export const TauriCredentialsLive: Layer.Layer<Credentials> = Layer.succeed(Credentials, {
  get: (remote) =>
    Effect.map(
      Effect.orElseSucceed(
        Effect.tryPromise(() =>
          invoke<string | null>("credentials_get", {
            service: KEYCHAIN_SERVICE,
            account: remote,
          }),
        ),
        () => null,
      ),
      (secret) => (secret === null ? Option.none() : decode(secret)),
    ),

  set: (remote, credential) =>
    Effect.orDie(
      Effect.tryPromise({
        try: () =>
          invoke<void>("credentials_set", {
            service: KEYCHAIN_SERVICE,
            account: remote,
            secret: JSON.stringify(credential),
          }),
        catch: keychainSaid,
      }),
    ),

  clear: (remote) =>
    Effect.orDie(
      Effect.tryPromise({
        try: () =>
          invoke<void>("credentials_clear", { service: KEYCHAIN_SERVICE, account: remote }),
        catch: keychainSaid,
      }),
    ),
});
