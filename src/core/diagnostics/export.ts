import { eventLine, type Attrs, type ObservabilityEvent } from "../observability";
import { DIAGNOSTICS_SCHEMA, UNKNOWN, type SessionHeader } from "./header";

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

const STRING_FAMILIES: readonly RegExp[] = [/^editor\.derive\.[a-z_-]+\.detail$/u];

const REDACTED = "redacted";

const MAX_FREE_TEXT = 200;

const listed = (key: string): boolean =>
  STRING_KEYS.has(key) || STRING_FAMILIES.some((family) => family.test(key));

const isPathKey = (key: string): boolean => key.endsWith(".root") || key.endsWith(".path");

const pathTail = (path: string): string => {
  const trimmed = path.replace(/[/\\]+$/u, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at < 0 ? trimmed : trimmed.slice(at + 1);
};

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

const safeEvent = (event: ObservabilityEvent): ObservabilityEvent => ({
  ...event,
  ...(event.kind === "log" && typeof event.name === "string" ? { name: scrub(event.name) } : {}),
  ...(typeof event.detail === "string" ? { detail: scrub(event.detail) } : {}),
  ...(typeof event.attrs === "object" && event.attrs !== null
    ? { attrs: safeAttrs(event.attrs) }
    : {}),
});

export interface ProjectSnapshot {
  readonly open: boolean;
  readonly project: string;
  readonly remote: boolean | typeof UNKNOWN;
  readonly branch: string;
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
  readonly dropped: number;
  readonly persist: { readonly state: "writing" | "stopped" | "off"; readonly reason?: string };
  readonly diskStatus: {
    readonly state: "complete" | "unavailable" | "none";
    readonly reason?: string;
  };
  readonly disk: readonly string[];
}

const safeUrl = (url: string): string =>
  url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/iu, "$1").replace(/[?#].*$/u, "");

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
  if (kind === "sefer.session") return JSON.stringify(safeHeader(parsed));
  // SAFETY: a line the log writer wrote from an `ObservabilityEvent`; the fields `safeEvent` reads are each checked for type before use there.
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
