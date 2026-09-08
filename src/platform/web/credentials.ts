/**
 * The Web host has no secure store, so it re-exports the session-only
 * implementation rather than inventing a weaker persistent one.
 *
 * This file exists to keep the composition symmetric — every host names its
 * own Layer for every capability — and to be the single place a future
 * decision about browser credential storage would land.
 */
export { SessionCredentialsLive as WebCredentialsLive } from "../../core/host/credentials";
