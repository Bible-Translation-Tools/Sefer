import { Effect, type FileSystem, type PlatformError } from "effect";

import { eventLine, type ObservabilityEvent, type ObservabilitySink } from "../observability";
import { compareCodeUnits } from "../ordering";
import type { SessionHeader } from "./header";

export interface LogLimits {
  readonly partBytes: number;
  readonly totalBytes: number;
  readonly maxAgeMs: number;
  readonly pending: number;
}

const LOG_LIMITS: LogLimits = {
  partBytes: 256 * 1024,
  totalBytes: 5 * 1024 * 1024,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  pending: 5000,
};

export interface LogQueue {
  readonly sink: ObservabilitySink;
  readonly take: () => { readonly events: readonly ObservabilityEvent[]; readonly dropped: number };
  readonly onPending: (wake: () => void) => void;
  readonly size: () => number;
}

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

const fileStamp = (epoch: number): string => {
  const at = new Date(epoch);
  return `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`;
};

const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/u;

const stampOf = (name: string): number | undefined => {
  const found = STAMP.exec(name);
  if (found === null) return undefined;
  const [, year, month, day, hour, minute, second] = found.map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day, hour, minute, second);
};

const sessionPrefix = (header: SessionHeader): string =>
  `${fileStamp(header.started)}-${header.session}`;

const partName = (header: SessionHeader, part: number): string =>
  `${sessionPrefix(header)}-${pad(part, 3)}.jsonl`;

const sessionOf = (name: string): string => name.slice(0, name.lastIndexOf("-"));

export interface LogPart {
  readonly name: string;
  readonly path: string;
  readonly bytes: number;
  readonly started: number;
}

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
    return parts.sort((a, b) => compareCodeUnits(a.name, b.name));
  });

export const pruneLogs = (
  fileSystem: FileSystem.FileSystem,
  directory: string,
  now: number,
  writing: SessionHeader,
  limits: LogLimits = LOG_LIMITS,
  current?: string,
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
    for (const part of parts) {
      if (bytes <= limits.totalBytes) break;
      if (doomed.has(part.path) || !part.name.startsWith(keep) || part.name === current) continue;
      doomed.add(part.path);
      bytes -= part.bytes;
    }
    for (const path of doomed) yield* fileSystem.remove(path, { force: true });
    return { removed: doomed.size, bytes };
  });

export interface LogWriter {
  readonly append: (
    events: readonly ObservabilityEvent[],
    dropped: number,
  ) => Effect.Effect<void, PlatformError.PlatformError>;
}

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
    if (part > 1)
      yield* pruneLogs(fileSystem, directory, Date.now(), header, limits, partName(header, part));
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
