/**
 * The local WACS's accounts. The passwords are not secrets: the server they
 * open listens on 127.0.0.1 only and holds nothing but seeded fixtures.
 */
export interface Account {
  readonly username: string;
  readonly password: string;
}

export const ACCOUNTS = {
  /** Forgejo's site admin; the seed creates organisations and teams with it. */
  admin: { username: "wacsadmin", password: "wacsadmin-local" },
  /** Owns the project, the empty repo and one Writer project. */
  alice: { username: "alice", password: "alice-local" },
  /** Forked Alice's project and has a suggestion open on it; owns the other Writer project. */
  bob: { username: "bob", password: "bob-local" },
} as const satisfies Readonly<Record<string, Account>>;
