import type { Progress, RemoteFailureReason } from "#core/remote/remote";

import { t } from "./i18n";

const MAX = 400;

const clip = (text: string): string =>
  text.length <= MAX ? text : `${text.slice(0, MAX).trimEnd()}…`;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const stringAt = (held: Readonly<Record<string, unknown>>, key: string): string => {
  const value = held[key];
  return typeof value === "string" ? value.trim() : "";
};

export const describe = (cause: unknown, depth = 0): string => {
  if (typeof cause === "string") return clip(cause.trim()) || "no detail";
  if (isRecord(cause)) {
    const reason = stringAt(cause, "reason");
    const description = stringAt(cause, "description");
    if (reason !== "" || description !== "")
      return clip([reason, description].filter((part) => part !== "").join(": "));
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

export const reasonOf = (cause: unknown): string | undefined => {
  if (!isRecord(cause)) return undefined;
  const reason = stringAt(cause, "reason");
  return reason === "" ? undefined : reason;
};

const REMOTE_REASONS: ReadonlySet<string> = new Set<RemoteFailureReason>([
  "Unauthorized",
  "Network",
  "Unavailable",
  "Rejected",
]);

export const remoteReasonOf = (cause: unknown): RemoteFailureReason | undefined => {
  const reason = reasonOf(cause);
  // SAFETY: membership in REMOTE_REASONS, a set built from RemoteFailureReason values, is exactly the check this narrowing claims.
  return reason !== undefined && REMOTE_REASONS.has(reason)
    ? (reason as RemoteFailureReason)
    : undefined;
};

export const describeTransfer = (progress: Progress): string => {
  if (progress.unit === "bytes")
    return t("{phase}: {size} MB", {
      phase: progress.phase,
      size: (progress.loaded / 1_000_000).toFixed(1),
    });
  if (progress.total === undefined || progress.total === 0)
    return t("{phase} {loaded}", { phase: progress.phase, loaded: progress.loaded });
  return t("{phase} {percent}%", {
    phase: progress.phase,
    percent: Math.min(100, Math.round((progress.loaded / progress.total) * 100)),
  });
};
