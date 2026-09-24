/**
 * Every recorded event, on disk, bounded by age and size.
 *
 * The ring is the MEMORY bound — enough for the dev surface, small enough not
 * to pressure a Web heap — and these files are what is kept. So nothing is
 * lost when the ring wraps or the app restarts, an export can include the
 * sessions before this one, and an agent on desktop can `jq` the log without
 * driving the app.
 *
 * Cheap on the keystroke path by construction:
 *
 *   - The ring's sink is `LogQueue.sink`: one array push. Nothing is
 *     serialised when an event is recorded.
 *   - The host drains the queue when the browser is idle, and on close: one
 *     serialise-and-append per batch, never per event.
 *   - The queue is bounded. When the disk falls behind, the OLDEST pending
 *     events are dropped and counted, and the count is written as a line of
 *     its own. Recording never waits on disk.
 *
 * Small by construction: one session is a run of parts, each at most
 * `partBytes` (appending to OPFS rewrites the file, so parts stay small), and
 * every part opens with the session header, so any one file read alone says
 * which build and host wrote it. At start, parts older than `maxAgeMs` go,
 * then the oldest sessions until the directory is under `totalBytes`.
 *
 * These files hold what the ring holds, full paths included — they are local,
 * like the projects beside them. What is handed to another person goes
 * through `diagnostics/export.ts`, never these bytes as they are.
 */
import { Effect, type FileSystem, type PlatformError } from "effect";

import { eventLine, type ObservabilityEvent, type ObservabilitySink } from "../observability";
import type { SessionHeader } from "./header";

export interface LogLimits {
  /** One part file, in bytes. */
  readonly partBytes: number;
  /** Every part of every session in the directory, in bytes. */
  readonly totalBytes: number;
  /** A part older than this is deleted at start. */
  readonly maxAgeMs: number;
  /** Events waiting for the disk. The oldest go first when it is full. */
  readonly pending: number;
}

const LOG_LIMITS: LogLimits = {
  partBytes: 256 * 1024,
  totalBytes: 5 * 1024 * 1024,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  pending: 5000,
};

export interface LogQueue {
  /** The ring's sink: an array push, and a wake-up when the queue was empty. */
  readonly sink: ObservabilitySink;
  /** Everything pending, oldest first, and how many were dropped since the last take. */
  readonly take: () => { readonly events: readonly ObservabilityEvent[]; readonly dropped: number };
  /** Called once each time the queue goes from empty to not; the host schedules a drain. */
  readonly onPending: (wake: () => void) => void;
  readonly size: () => number;
}

/**
 * The queue exists from boot, before any filesystem does: the domain
 * FileSystem arrives with the services, and the events of boot itself are
 * worth keeping. Until a writer attaches, the queue just holds (bounded).
 */
export const makeLogQueue = (limit = LOG_LIMITS.pending): LogQueue => {
  let pending: ObservabilityEvent[] = [];
  let dropped = 0;
  let wake: (() => void) | undefined;
  return {
    sink: (event) => {
      if (pending.length >= limit) {
        pending.shift();
        dropped += 1;
      }
      pending.push(event);
      if (pending.length === 1) wake?.();
    },
    take: () => {
      const taken = { events: pending, dropped };
      pending = [];
      dropped = 0;
      return taken;
    },
    onPending: (next) => {
      wake = next;
      if (pending.length > 0) next();
    },
    size: () => pending.length,
  };
};

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/** `20260924T111500Z`: sorts as time, and is safe in a file name on every host. */
const fileStamp = (epoch: number): string => {
  const at = new Date(epoch);
  return `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`;
};

const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/u;

/** The epoch a part's name says it was started at, or undefined for a stranger. */
const stampOf = (name: string): number | undefined => {
  const found = STAMP.exec(name);
  if (found === null) return undefined;
  const [, year, month, day, hour, minute, second] = found.map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day, hour, minute, second);
};

const sessionPrefix = (header: SessionHeader): string =>
  `${fileStamp(header.started)}-${header.session}`;

/** `<stamp>-<session>-<part>.jsonl`, the part numbered from 1. */
const partName = (header: SessionHeader, part: number): string =>
  `${sessionPrefix(header)}-${pad(part, 3)}.jsonl`;

/** The session a part belongs to: everything before the part number. */
const sessionOf = (name: string): string => name.slice(0, name.lastIndexOf("-"));

export interface LogPart {
  readonly name: string;
  readonly path: string;
  readonly bytes: number;
  readonly started: number;
}

/** The directory's parts, oldest first. Anything that is not a part is left alone. */
export const listParts = (
  fileSystem: FileSystem.FileSystem,
  directory: string,
): Effect.Effect<readonly LogPart[], PlatformError.PlatformError> =>
  Effect.gen(function* () {
    if (!(yield* fileSystem.exists(directory))) return [];
    const names = yield* fileSystem.readDirectory(directory);
    const parts: LogPart[] = [];
    for (const name of names) {
      const started = name.endsWith(".jsonl") ? stampOf(name) : undefined;
      if (started === undefined) continue;
      const path = `${directory}/${name}`;
      const info = yield* fileSystem.stat(path);
      parts.push({ name, path, bytes: Number(info.size), started });
    }
    return parts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  });

/**
 * Deletes what is too old, then whole sessions oldest-first until the rest
 * fits. The session being written is never deleted.
 */
export const pruneLogs = (
  fileSystem: FileSystem.FileSystem,
  directory: string,
  now: number,
  writing: SessionHeader,
  limits: LogLimits = LOG_LIMITS,
): Effect.Effect<
  { readonly removed: number; readonly bytes: number },
  PlatformError.PlatformError
> =>
  Effect.gen(function* () {
    const parts = yield* listParts(fileSystem, directory);
    const keep = sessionPrefix(writing);
    const doomed = new Set<string>();
    for (const part of parts)
      if (now - part.started > limits.maxAgeMs && !part.name.startsWith(keep))
        doomed.add(part.path);
    let bytes = parts.reduce((sum, part) => (doomed.has(part.path) ? sum : sum + part.bytes), 0);
    // Whole sessions, oldest first: half a session is worse evidence than
    // none, because its header survives and its failures may not.
    for (const part of parts) {
      if (bytes <= limits.totalBytes) break;
      if (doomed.has(part.path) || part.name.startsWith(keep)) continue;
      const session = sessionOf(part.name);
      for (const sibling of parts)
        if (sessionOf(sibling.name) === session && !doomed.has(sibling.path)) {
          doomed.add(sibling.path);
          bytes -= sibling.bytes;
        }
    }
    for (const path of doomed) yield* fileSystem.remove(path, { force: true });
    return { removed: doomed.size, bytes };
  });

export interface LogWriter {
  /** Appends one batch, rolling to a new part when this one is full. */
  readonly append: (
    events: readonly ObservabilityEvent[],
    dropped: number,
  ) => Effect.Effect<void, PlatformError.PlatformError>;
}

/** `{"kind":"dropped",...}`: the queue fell behind and lost this many, oldest first. */
const droppedLine = (count: number, t: number): string =>
  JSON.stringify({ kind: "dropped", t, count });

export const makeLogWriter = (
  fileSystem: FileSystem.FileSystem,
  directory: string,
  header: SessionHeader,
  limits: LogLimits = LOG_LIMITS,
): LogWriter => {
  const headerLine = `${JSON.stringify(header)}\n`;
  let part = 0;
  let written = 0;
  let ready = false;

  const roll = Effect.gen(function* () {
    if (!ready) {
      yield* fileSystem.makeDirectory(directory, { recursive: true });
      ready = true;
    }
    part += 1;
    yield* fileSystem.writeFileString(`${directory}/${partName(header, part)}`, headerLine);
    written = headerLine.length;
  });

  return {
    append: (events, dropped) =>
      Effect.gen(function* () {
        if (events.length === 0 && dropped === 0) return;
        if (part === 0) yield* roll;
        let text = dropped === 0 ? "" : `${droppedLine(dropped, events[0]?.t ?? Date.now())}\n`;
        for (const event of events) {
          const line = `${eventLine(event)}\n`;
          // Measured in UTF-16 units, not bytes: a bound, not an accounting.
          const used = written + text.length;
          if (used + line.length > limits.partBytes && used > headerLine.length) {
            if (text !== "")
              yield* fileSystem.writeFileString(`${directory}/${partName(header, part)}`, text, {
                flag: "a",
              });
            yield* roll;
            text = "";
          }
          text += line;
        }
        if (text === "") return;
        yield* fileSystem.writeFileString(`${directory}/${partName(header, part)}`, text, {
          flag: "a",
        });
        written += text.length;
      }),
  };
};
