import { Context, Effect, Option } from "effect";

export interface Credential {
  readonly username: string;
  readonly token: string;
  readonly tokenName?: string;
  readonly tokenId?: string;
}

export interface CredentialsService {
  readonly get: (remote: string) => Effect.Effect<Option.Option<Credential>>;
  readonly set: (remote: string, credential: Credential) => Effect.Effect<void>;
  readonly clear: (remote: string) => Effect.Effect<void>;
}

export class Credentials extends Context.Service<Credentials, CredentialsService>()(
  "Credentials",
) {}
