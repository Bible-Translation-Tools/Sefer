/**
 * "Export diagnostics": the file a person hands to someone helping them.
 *
 * JSONL, so `jq` reads it the way it reads a log part:
 *
 *   line 1      the header — `SessionHeader`, plus when it was exported, the
 *               project snapshot, and how much each ring holds
 *   then        `{"kind":"section","name":"failures"}` and the failure ring
 *   then        `{"kind":"section","name":"recent"}` and the main ring
 *   then        `{"kind":"section","name":"disk"}` and every part on disk —
 *               earlier sessions and this one — each opening with its header
 *
 * Every event goes through `safeEvent` first. Recording keeps everything,
 * because in dev the full path is the useful one; handing over is where
 * disclosure is decided, so it is decided HERE, once, by an allowlist:
 *
 *   - A STRING field passes only if its key is in `STRING_KEYS`, and even
 *     then its value is scrubbed. A string under any other key is written as
 *     `"redacted"` — present, so the gap is visible and someone lists the key,
 *     but empty. With a lot of generated code adding fields, an allowlist
 *     fails safe and a denylist does not.
 *   - Numbers and booleans pass: a count or a flag cannot carry a name.
 *   - Paths (`*.root`, `*.path`) become their last segment.
 *   - Free text — `detail`, and a log's message — is scrubbed: home
 *     directories, URL credentials and query strings, e-mail addresses.
 *
 * Nothing here reads a token or an account name, and nothing it writes can
 * name one unless a producer put one in a listed string field — which is the
 * review question when a key is added to the list.
 */
import { eventLine, type Attrs, type ObservabilityEvent } from "../observability";
import { DIAGNOSTICS_SCHEMA, UNKNOWN, type SessionHeader } from "./header";

/**
 * String fields whose values are ours: enums, ids, phase names, reasons.
 * Adding one is saying "this string cannot carry a person's data". Keys
 * outside the list keep their numbers and booleans and lose their strings.
 */
const STRING_KEYS: ReadonlySet<string> = new Set([
  "analysis.slowest",
  "app.host",
  "block.front",
  "block.heading",
  "block.meta",
  "block.para",
  "boot.error",
  "boot.phase",
  "book.id",
  "book.origin",
  "book.rule",
  "build.id",
  "catalogue.failure",
  "catalogue.source",
  "catalogue.type",
  "editor.decided",
  "editor.origin",
  "editor.to_paint_source",
  "error.boundary",
  "error.handling",
  "error.owner",
  "error.type",
  "find.reason",
  "find.scope",
  "finding.code",
  "finding.producer",
  "finding.severity",
  "findings.via",
  "galley.why",
  "import.host",
  "import.kind",
  "import.phase",
  "import.reason",
  "import.source",
  "op.cause",
  "op.link",
  "op.trigger",
  "project.error",
  "reference.outcome",
  "reference.reason",
  "reference.role",
  "reference.sid",
  "reference.where",
  "remote.progress.phase",
  "resource.classification",
  "resource.id",
  "review.left",
  "review.reason",
  "review.right",
  "review.target",
  "save.change",
  "save.choice",
  "save.stage",
  "session.id",
  "sync.action",
  "sync.reason",
  "sync.state",
  "terms.locale",
  "terms.reason",
  "update.channel",
  "update.reason",
  "update.result",
]);

/** Families of generated keys: `editor.phase.<name>.ms`, `editor.derive.<name>.detail`. */
const STRING_FAMILIES: readonly RegExp[] = [/^editor\.derive\.[a-z_-]+\.detail$/u];

const REDACTED = "redacted";

/** Longest free text an export keeps: a sentence, not a response body. */
const MAX_FREE_TEXT = 200;

const listed = (key: string): boolean =>
  STRING_KEYS.has(key) || STRING_FAMILIES.some((family) => family.test(key));

const isPathKey = (key: string): boolean => key.endsWith(".root") || key.endsWith(".path");

/** The last segment of a path, which names the project or the file and not the person. */
const pathTail = (path: string): string => {
  const trimmed = path.replace(/[/\\]+$/u, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at < 0 ? trimmed : trimmed.slice(at + 1);
};

/**
 * Free text with the person taken out of it: home directories become `~`,
 * a URL keeps its scheme, host and path but loses credentials and query,
 * and an e-mail address becomes `<email>`. Then capped.
 */
const scrub = (text: string): string => {
  const out = text
    .replace(/(?:\/Users|\/home|[A-Za-z]:[\\/]Users)[\\/][^\\/\s"']+/gu, "~")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@"']+@/giu, "$1")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"']*)[?#][^\s"']*/giu, "$1")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/gu, "<email>");
  return out.length <= MAX_FREE_TEXT ? out : `${out.slice(0, MAX_FREE_TEXT)}…`;
};

const safeAttrs = (attrs: Attrs): Attrs => {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value !== "string") out[key] = value;
    else if (isPathKey(key)) out[key] = pathTail(value);
    else out[key] = listed(key) ? scrub(value) : REDACTED;
  }
  return out;
};

/** One recorded event, as an export writes it. The shape is unchanged; only values are cut. */
const safeEvent = (event: ObservabilityEvent): ObservabilityEvent => ({
  ...event,
  // A log's name is its message, which is free text; every other name is code.
  ...(event.kind === "log" && typeof event.name === "string" ? { name: scrub(event.name) } : {}),
  ...(typeof event.detail === "string" ? { detail: scrub(event.detail) } : {}),
  ...(typeof event.attrs === "object" && event.attrs !== null
    ? { attrs: safeAttrs(event.attrs) }
    : {}),
});

/**
 * Where the open project stands, taken when the export is made — never on
 * every event, and never by asking the network: an export must not wait on a
 * slow connection. `sync` is the last state the app OBSERVED, with when.
 */
export interface ProjectSnapshot {
  readonly open: boolean;
  /** The project folder's name, not its path. */
  readonly project: string;
  readonly remote: boolean | typeof UNKNOWN;
  readonly branch: string;
  /** HEAD's commit. Translation repositories are public. */
  readonly head: string;
  readonly unsavedBooks: number | typeof UNKNOWN;
  readonly journalPending: boolean | typeof UNKNOWN;
  readonly sync:
    | {
        readonly state: string;
        readonly ahead: number | typeof UNKNOWN;
        readonly behind: number | typeof UNKNOWN;
        /** Epoch ms of the survey this came from. */
        readonly observedAt: number;
      }
    | typeof UNKNOWN;
}

interface RingStats {
  readonly events: number;
  /** Epoch ms of the oldest event still held, when there is one. */
  readonly oldest?: number;
}

const statsOf = (events: readonly ObservabilityEvent[]): RingStats => ({
  events: events.length,
  ...(events[0] === undefined ? {} : { oldest: events[0].t }),
});

export interface ExportInput {
  readonly header: SessionHeader;
  readonly exported: number;
  readonly snapshot: ProjectSnapshot;
  readonly failures: readonly ObservabilityEvent[];
  readonly recent: readonly ObservabilityEvent[];
  /** Events a sink refused by throwing. The disk queue's own drops are lines in its parts. */
  readonly dropped: number;
  /**
   * Whether the log writer is running, and if it stopped, why. An export
   * from a session whose disk stopped says so rather than looking whole.
   */
  readonly persist: { readonly state: "writing" | "stopped" | "off"; readonly reason?: string };
  /**
   * Whether `disk` is every part there is: `complete`, `unavailable` when the
   * directory could not be listed or a part could not be read (with why), or
   * `none` on a host that writes no log.
   */
  readonly diskStatus: {
    readonly state: "complete" | "unavailable" | "none";
    readonly reason?: string;
  };
  /**
   * Every part file on disk, oldest first, as raw text: earlier sessions, and
   * this one's, which hold what the ring has already let go of.
   */
  readonly disk: readonly string[];
}

/** A URL as the header keeps it: scheme, host and path, never credentials or a query. */
const safeUrl = (url: string): string =>
  url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/iu, "$1").replace(/[?#].*$/u, "");

/**
 * The header's own strings, made safe. The build's endpoints ship in the
 * public bundle, but an edited one is whatever someone typed, and a URL can
 * carry a password or a token in its query — so every endpoint is cut to
 * scheme, host and path, the current header and every header read back from
 * disk alike.
 */
const safeHeader = <H extends { readonly endpoints?: unknown }>(header: H): H => {
  const endpoints = header.endpoints;
  if (typeof endpoints !== "object" || endpoints === null) return header;
  const out: Record<string, { readonly url: string; readonly edited: boolean }> = {};
  for (const [name, value] of Object.entries(endpoints)) {
    if (typeof value !== "object" || value === null) continue;
    const url = "url" in value && typeof value.url === "string" ? safeUrl(value.url) : "";
    const edited = "edited" in value && value.edited === true;
    out[name] = { url, edited };
  }
  return { ...header, endpoints: out };
};

const scrubbedReason = <S extends { readonly reason?: string }>(status: S): S =>
  status.reason === undefined ? status : { ...status, reason: scrub(status.reason) };

const section = (name: string): string => JSON.stringify({ kind: "section", name });

/**
 * A line from a part on disk, made safe the same way. A header or
 * a dropped-count line passes as it is — both are ours, with no free text;
 * a line that will not parse is left out rather than copied blind.
 */
const safeLine = (line: string): string | undefined => {
  if (line.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const kind = "kind" in parsed ? parsed.kind : undefined;
  if (kind === "dropped") return line;
  // A header from disk: `safeHeader` reads only `endpoints`, shape-checked.
  if (kind === "sefer.session") return JSON.stringify(safeHeader(parsed));
  // SAFETY: a line the log writer wrote from an `ObservabilityEvent`; the
  // fields `safeEvent` reads are each checked for type before use there.
  return eventLine(safeEvent(parsed as ObservabilityEvent));
};

export const renderExport = (input: ExportInput): string => {
  const head = {
    ...input.header,
    schema: DIAGNOSTICS_SCHEMA,
    kind: "sefer.export",
    exported: input.exported,
    snapshot: input.snapshot,
    rings: { failures: statsOf(input.failures), recent: statsOf(input.recent) },
    dropped: input.dropped,
    persist: scrubbedReason(input.persist),
    disk: { ...scrubbedReason(input.diskStatus), parts: input.disk.length },
  };
  const lines: string[] = [JSON.stringify(safeHeader(head)), section("failures")];
  for (const event of input.failures) lines.push(eventLine(safeEvent(event)));
  lines.push(section("recent"));
  for (const event of input.recent) lines.push(eventLine(safeEvent(event)));
  lines.push(section("disk"));
  for (const part of input.disk)
    for (const line of part.split("\n")) {
      const safe = safeLine(line);
      if (safe !== undefined) lines.push(safe);
    }
  return `${lines.join("\n")}\n`;
};
