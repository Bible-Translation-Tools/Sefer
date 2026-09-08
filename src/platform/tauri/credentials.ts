/**
 * TODO(seam): the desktop host's Credentials, backed by the OS keychain.
 * Unwired stub.
 *
 * The real implementation stores each remote's credential through a keychain
 * plugin (`@tauri-apps/plugin-stronghold`, or a small Rust command over the
 * `keyring` crate) so a token survives a restart without ever being written
 * into a project file. Neither exists yet, so this Layer refuses to build:
 * silently falling back to the session map would look like it persisted.
 */
import { Effect, Layer } from "effect";

import { Credentials } from "../../core/host/credentials";

const UNIMPLEMENTED =
  "TauriCredentialsLive is a stub: wire the OS keychain before composing the desktop host, or compose SessionCredentialsLive deliberately.";

export const TauriCredentialsLive: Layer.Layer<Credentials> = Layer.effect(
  Credentials,
  Effect.die(new Error(UNIMPLEMENTED)),
);
