/**
 * Who a commit Sefer makes is by: one identity, in one place.
 *
 * Today it is "Sefer" with no email for every commit — a save's version, an
 * import's arrival, a combine's decision commit. The signed-in account's name,
 * and a name asked for once on a device with no account, replace it here and
 * nowhere else. The email is empty rather than invented: git allows an empty
 * author email, and a made-up address is worse than none.
 */
import type { Author } from "#core/git/git";

export const APP_AUTHOR: Author = { name: "Sefer", email: "" };
