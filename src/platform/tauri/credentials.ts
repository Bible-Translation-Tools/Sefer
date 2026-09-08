/**
 * The desktop host's Credentials, over the OS keychain.
 *
 * Keychain on macOS, the Credential Manager on Windows, the Secret Service on
 * Linux — the Rust `keyring` crate covers all three, and `src-tauri/src/
 * credentials.rs` exposes it as three commands. This is the whole reason the
 * desktop host reports `secureStore: true` while the Web host does not: a
 * token survives a restart without ever being written into a project file or
 * into `settings.json`.
 *
 * The keychain stores one opaque secret per account, and a `Credential` is now
 * more than a token (it may carry the name and id of a token Sefer minted
 * itself). So the whole record is stored as JSON under one entry rather than
 * spread across several — one write, one read, nothing that can drift apart.
 * A secret that will not parse is treated as absent: it was written by an
 * older or different shape, and the honest answer is "sign in again".
 */
import { invoke } from "@tauri-apps/api/core";
import { Effect, Layer, Option } from "effect";

import { Credentials, type Credential } from "../../core/host/credentials";

/**
 * The keychain service name; the account within it is the remote's key.
 *
 * Deliberately the stable identifier rather than the running build's, so a
 * Nightly install and a Stable install share one stored credential: it is the
 * same person talking to the same Gitea, and making them sign in twice would
 * teach nobody anything.
 */
export const KEYCHAIN_SERVICE = "org.wycliffe.sefer";

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

export const TauriCredentialsLive: Layer.Layer<Credentials> = Layer.succeed(Credentials, {
  get: (remote) =>
    Effect.map(
      // A keychain that refuses to answer is reported as "nothing stored":
      // `get` cannot fail by contract, and a sign-in prompt is a better
      // outcome than a dead flow.
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

  // `set` and `clear` die rather than swallow a keychain failure. The port has
  // no error channel, and the two silent outcomes are both worse than a crash:
  // a sign-in that did not persist, and a sign-out that left the token behind.
  set: (remote, credential) =>
    Effect.orDie(
      Effect.tryPromise(() =>
        invoke<void>("credentials_set", {
          service: KEYCHAIN_SERVICE,
          account: remote,
          secret: JSON.stringify(credential),
        }),
      ),
    ),

  clear: (remote) =>
    Effect.orDie(
      Effect.tryPromise(() =>
        invoke<void>("credentials_clear", { service: KEYCHAIN_SERVICE, account: remote }),
      ),
    ),
});
