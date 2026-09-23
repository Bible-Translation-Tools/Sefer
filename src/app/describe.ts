/**
 * A failure, as one line a person can act on.
 *
 * `services.run` rejects with the fiber's failure ITSELF — the tagged error
 * object, not a rendering of it — and `Data.TaggedError`'s own `toString` is
 * just the tag. So `String(cause)` says `RemoteError` and nothing else, which
 * is how a clone that failed on a 404, a dead CORS proxy and a rejected
 * password all arrived on screen as the same non-sentence, or as no sentence
 * at all.
 *
 * Every tagged error in this codebase carries `reason` and usually
 * `description`; a `GiteaError`'s description is Gitea's own body, already
 * prefixed with the HTTP status by `refuse`. So the rule is: read those two
 * fields structurally, fall through a `cause` chain when they are absent, and
 * only then resort to the string.
 *
 * This lives in `src/app` rather than in a UI folder because the shell's
 * command handlers raise toasts too, and there must be exactly one of these:
 * three copies drifted apart once already.
 */

/** Bounded so a server that answers with an HTML error page cannot fill a toast. */
const MAX = 400;

const clip = (text: string): string =>
  text.length <= MAX ? text : `${text.slice(0, MAX).trimEnd()}…`;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const stringAt = (held: Readonly<Record<string, unknown>>, key: string): string => {
  const value = held[key];
  return typeof value === "string" ? value.trim() : "";
};

/**
 * `reason: description`, or whichever of the two exists; then `message`; then
 * whatever the `cause` chain says; then the string. Never the empty string and
 * never `[object Object]` — a toast that says nothing is worse than one that
 * says the tag.
 */
export const describe = (cause: unknown, depth = 0): string => {
  if (typeof cause === "string") return clip(cause.trim()) || "no detail";
  if (isRecord(cause)) {
    const reason = stringAt(cause, "reason");
    const description = stringAt(cause, "description");
    if (reason !== "" || description !== "")
      return clip([reason, description].filter((part) => part !== "").join(": "));
    // Some failures carry the status and the body apart from `description`.
    const status = typeof cause.status === "number" ? String(cause.status) : "";
    const body = stringAt(cause, "body") || stringAt(cause, "statusText");
    if (status !== "" || body !== "")
      return clip([status, body].filter((part) => part !== "").join(" "));
    const message = stringAt(cause, "message");
    if (message !== "") return clip(message);
    const nested = cause.cause;
    if (depth < 4 && nested !== undefined && nested !== cause) return describe(nested, depth + 1);
    const tag = stringAt(cause, "_tag") || stringAt(cause, "name");
    if (tag !== "") return tag;
  }
  const text = String(cause).trim();
  return text === "" || text === "[object Object]" ? "no detail" : clip(text);
};

/**
 * The failure's `reason` field — the tag's own vocabulary (`Unauthorized`,
 * `Stale`, `Io`…) — or `undefined` when there is none.
 *
 * The machine-readable half of what `describe` renders for a person: an
 * observability attribute or a branch on the kind of failure reads this,
 * never a regex over the sentence, which would also match the word in a
 * server's description.
 */
export const reasonOf = (cause: unknown): string | undefined => {
  if (!isRecord(cause)) return undefined;
  const reason = stringAt(cause, "reason");
  return reason === "" ? undefined : reason;
};
