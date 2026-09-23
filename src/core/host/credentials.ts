/**
 * Credentials — the tokens a remote needs, kept where the host can keep them
 * safely.
 *
 * The port exists so Git and Remote can ask for a credential without knowing
 * whether the answer came from an OS keychain or from a map that dies with the
 * tab. Tokens never go into project files or settings; where each host keeps
 * them is its own business (`WebCredentialsLive` uses `localStorage`,
 * `TauriCredentialsLive` the OS keychain).
 *
 * `remote` is the key: a remote URL or name as Git spells it. Core does not
 * parse it; it is opaque to everything but the host that stores it.
 */
import { Context, Effect, Option } from "effect";

export interface Credential {
  readonly username: string;
  readonly token: string;
  /**
   * The two facts a Gitea session needs beyond the token itself: the name the
   * token was created under and its id. They are optional because most
   * credentials are just a username and a secret — only a token Sefer minted
   * itself (see `src/core/remote/gitea.ts`) can name and revoke it later, and
   * a host that persists credentials keeps them alongside the token rather
   * than in a second file that could drift out of step with it.
   */
  readonly tokenName?: string;
  readonly tokenId?: string;
}

export interface CredentialsService {
  /** `None` when this host holds nothing for the remote — not an error. */
  readonly get: (remote: string) => Effect.Effect<Option.Option<Credential>>;
  readonly set: (remote: string, credential: Credential) => Effect.Effect<void>;
  /** Idempotent: clearing an unknown remote succeeds. */
  readonly clear: (remote: string) => Effect.Effect<void>;
}

export class Credentials extends Context.Service<Credentials, CredentialsService>()(
  "Credentials",
) {}
