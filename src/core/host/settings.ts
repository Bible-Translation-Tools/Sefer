/**
 * Settings — every module's preferences in one file, each one owned by the
 * module that declared it (seams 1.4).
 *
 * The shape is register-then-read: a module declares the key it owns with a
 * schema and a default, and gets back a typed token. Nobody reads a setting
 * they did not declare, which is what keeps the file's contents traceable to
 * code. Values are validated through the registered schema when the stored
 * file is read; a value that no longer matches its schema is refused (noted,
 * never thrown) and the default stands, so a hand-edited or downgraded file
 * cannot stop the application from starting.
 *
 * One JSON file under `HostInfo.paths().appData`, written whole with
 * `writeFileAtomic` so a failed write leaves the previous settings intact.
 * Keys we did not register are carried through untouched: another host, or a
 * newer build, may own them.
 *
 * `SettingsLive` is `makeSettings` over the file store; the logic and the
 * store are separate so a second store is a store, not a second code path.
 */
import {
  Context,
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  PubSub,
  Result,
  Schema,
  Stream,
} from "effect";

import { writeFileStringAtomic } from "../fileSystem/atomic";
import { joinPath, parentPath } from "../fileSystem/path";
import { Observability, type ObservabilityService } from "../observability";
import { HostInfo } from "./hostInfo";

const SETTINGS_FILE = "settings.json";

const RULE = "settings";

/** A settings operation that could not be completed. `set` is the only caller. */
class SettingsError extends Data.TaggedError("SettingsError")<{
  readonly operation: "read" | "write" | "validate";
  readonly key: string;
  readonly reason: string;
}> {}

/**
 * The token a module keeps after registering. It carries its own schema and
 * default so `get`/`set` need no lookup table and no untyped key strings.
 *
 * `Schema.Codec<S, unknown>` rather than `Schema.Schema<S>` because decoding
 * must require no services; a setting's stored form is its own JSON.
 */
export interface SettingKey<S> {
  readonly name: string;
  readonly schema: Schema.Codec<S, unknown>;
  readonly defaultValue: S;
}

export interface SettingsService {
  /**
   * Declares the preference this module owns. Returns the token used for every
   * later read and write. Registering the same name twice is a programming
   * error; the last registration wins and the collision is noted.
   */
  readonly register: <S>(
    name: string,
    schema: Schema.Codec<S, unknown>,
    defaultValue: S,
  ) => SettingKey<S>;
  /** Synchronous: the value is already decoded and held in memory. */
  readonly get: <S>(key: SettingKey<S>) => S;
  /** Validates, persists the whole file, then publishes to `changes`. */
  readonly set: <S>(key: SettingKey<S>, value: S) => Effect.Effect<void, SettingsError>;
  /** Every value this key takes after subscription; no replay of the current one. */
  readonly changes: <S>(key: SettingKey<S>) => Stream.Stream<S>;
}

export class Settings extends Context.Service<Settings, SettingsService>()("Settings") {}

/**
 * Where the JSON lives. `load` answers `{}` for a missing file — a fresh
 * profile is not an error — and fails only when the bytes exist and cannot be
 * understood, which the caller downgrades to "start from defaults".
 */
interface SettingsStore {
  readonly load: Effect.Effect<Readonly<Record<string, unknown>>, SettingsError>;
  readonly save: (values: Readonly<Record<string, unknown>>) => Effect.Effect<void, SettingsError>;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const reason = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

interface Change {
  readonly name: string;
  readonly value: unknown;
}

/**
 * The whole of Settings' behaviour, over any store. Takes the observability
 * service directly (optional) because it is called from a Layer that may be
 * built before, or without, the ring.
 */
const makeSettings = (
  store: SettingsStore,
  observability?: ObservabilityService | undefined,
): Effect.Effect<SettingsService> =>
  Effect.gen(function* () {
    const loaded = yield* Effect.result(store.load);
    if (Result.isFailure(loaded))
      observability?.note(RULE, "refused", `load ${loaded.failure.reason}`);

    // `stored` is the file as it will be written back: registered values plus
    // whatever keys we do not own. `decoded` is the read path.
    const stored = new Map<string, unknown>(
      Result.isSuccess(loaded) ? Object.entries(loaded.success) : [],
    );
    const decoded = new Map<string, unknown>();
    const decoders = new Map<
      string,
      (value: unknown) => Result.Result<unknown, Schema.SchemaError>
    >();
    const pubsub = yield* PubSub.unbounded<Change>();

    const register = <S>(
      name: string,
      schema: Schema.Codec<S, unknown>,
      defaultValue: S,
    ): SettingKey<S> => {
      if (decoders.has(name)) observability?.note(RULE, "refused", `duplicate ${name}`);
      const decode = Schema.decodeUnknownResult(schema);
      decoders.set(name, decode);
      const held = stored.get(name);
      if (held === undefined) decoded.set(name, defaultValue);
      else {
        const result = decode(held);
        if (Result.isSuccess(result)) decoded.set(name, result.success);
        else {
          observability?.note(RULE, "refused", name);
          decoded.set(name, defaultValue);
        }
      }
      return { name, schema, defaultValue };
    };

    const get = <S>(key: SettingKey<S>): S => {
      const held = decoded.get(key.name);
      if (held === undefined) return key.defaultValue;
      // SAFETY: every value in `decoded` was produced by this key's own
      // decoder (in `register` or `set`), so its type is this key's type.
      return held as S;
    };

    const set = <S>(key: SettingKey<S>, value: S): Effect.Effect<void, SettingsError> =>
      Effect.gen(function* () {
        const decode = decoders.get(key.name) ?? Schema.decodeUnknownResult(key.schema);
        const validated = decode(value);
        if (Result.isFailure(validated)) {
          observability?.note(RULE, "refused", key.name);
          return yield* Effect.fail(
            new SettingsError({
              operation: "validate",
              key: key.name,
              reason: validated.failure.message,
            }),
          );
        }
        const next = new Map(stored).set(key.name, value);
        yield* store.save(Object.fromEntries(next));
        stored.set(key.name, value);
        decoded.set(key.name, validated.success);
        yield* PubSub.publish(pubsub, { name: key.name, value: validated.success });
        observability?.note(RULE, "passed", key.name);
      });

    const changes = <S>(key: SettingKey<S>): Stream.Stream<S> =>
      Stream.map(
        Stream.filter(Stream.fromPubSub(pubsub), (change) => change.name === key.name),
        // SAFETY: only `set` publishes, and only after decoding through this
        // key's schema, so a change under this name carries this key's type.
        (change) => change.value as S,
      );

    return { register, get, set, changes };
  });

/** The persistent store: one JSON file, read once, written whole and atomically. */
const fileSettingsStore = (fileSystem: FileSystem.FileSystem, path: string): SettingsStore => ({
  load: Effect.gen(function* () {
    const present = yield* fileSystem.exists(path);
    if (!present) return {};
    const text = yield* fileSystem.readFileString(path);
    // SAFETY: JSON.parse is declared to return `any`; widening it to unknown
    // discards that, and `isRecord` below is what actually narrows it.
    const parsed = yield* Effect.try(() => JSON.parse(text) as unknown);
    if (!isRecord(parsed))
      return yield* Effect.fail(
        new SettingsError({ operation: "read", key: "", reason: "not a JSON object" }),
      );
    return parsed;
  }).pipe(
    Effect.catch((cause) =>
      Effect.fail(
        cause instanceof SettingsError
          ? cause
          : new SettingsError({ operation: "read", key: "", reason: reason(cause) }),
      ),
    ),
  ),
  save: (values) =>
    Effect.gen(function* () {
      yield* fileSystem.makeDirectory(parentPath(path), { recursive: true });
      yield* writeFileStringAtomic(fileSystem, path, `${JSON.stringify(values, undefined, 2)}\n`);
    }).pipe(
      Effect.catch((cause) =>
        Effect.fail(new SettingsError({ operation: "write", key: "", reason: reason(cause) })),
      ),
    ),
});

export const SettingsLive: Layer.Layer<Settings, never, FileSystem.FileSystem | HostInfo> =
  Layer.effect(
    Settings,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const host = yield* HostInfo;
      const observability = yield* Effect.serviceOption(Observability);
      return yield* makeSettings(
        fileSettingsStore(fileSystem, joinPath(host.paths().appData, SETTINGS_FILE)),
        Option.getOrUndefined(observability),
      );
    }),
  );
