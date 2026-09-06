import { Effect, FileSystem, Result } from "effect";
import { For, Show, createSignal } from "solid-js";

import { composeApplication, type Composition } from "../../app/composition";
import { FixtureFileSystemLive, SMALL_NT, SMALL_NT_ROOT } from "../../core/fixture/smallNt";
import {
  installDevState,
  type DevFixtureFile,
  type DevFixtureState,
} from "../../platform/observability";

interface FixtureSession {
  readonly composition: Composition;
  readonly fixture: DevFixtureState;
}

const listFixture = (
  fileSystem: FileSystem.FileSystem,
): Effect.Effect<readonly DevFixtureFile[], never> =>
  Effect.gen(function* () {
    const names = yield* fileSystem.readDirectory(SMALL_NT_ROOT);
    const files: DevFixtureFile[] = [];
    for (const name of [...names].sort()) {
      const bytes = yield* fileSystem.readFile(`${SMALL_NT_ROOT}/${name}`);
      files.push({ path: name, bytes: bytes.length });
    }
    return files;
  }).pipe(Effect.orDie);

const seed = async (): Promise<FixtureSession> => {
  const composition = await composeApplication({ fileSystem: FixtureFileSystemLive });
  const fileSystem = composition.fileSystem;
  const files = fileSystem === undefined ? [] : await Effect.runPromise(listFixture(fileSystem));
  const fixture: DevFixtureState = { project: SMALL_NT, files, seededAt: Date.now() };

  composition.observability.note("fixture", "ready", `${SMALL_NT}: ${files.length} files`);
  installDevState(() => ({
    boot: composition.boot,
    fixture,
    observability: composition.observability.recent().length,
  }));

  return { composition, fixture };
};

const bootLabel = (result: Composition["boot"]): string =>
  Result.isSuccess(result) ? `${result.success.host} ${result.success.build}` : result.failure._tag;

let held: FixtureSession | undefined;

export const fixtureSession = async (keep: boolean): Promise<FixtureSession> => {
  if (keep && held !== undefined) return held;
  held = await seed();
  return held;
};

const keepRequested = (): boolean =>
  typeof location === "object" && new URLSearchParams(location.search).get("keep") === "1";

export function FixturePage() {
  const [session, setSession] = createSignal<FixtureSession | undefined>(undefined);

  const load = (keep: boolean): void => {
    void fixtureSession(keep).then((ready) => {
      setSession(ready);
    });
  };

  load(keepRequested());

  return (
    <main data-fixture={SMALL_NT}>
      <h1>Fixture project: {SMALL_NT}</h1>
      <Show when={session()} fallback={<p>Seeding…</p>}>
        {(ready) => (
          <>
            <p data-boot-phase={Result.isSuccess(ready().composition.boot) ? "ready" : "failed"}>
              boot: {bootLabel(ready().composition.boot)}
            </p>
            <button type="button" onClick={() => load(false)}>
              reset
            </button>
            <ul data-fixture-files={ready().fixture.files.length}>
              <For each={ready().fixture.files}>
                {(file) => (
                  <li data-path={file.path}>
                    {file.path} — {file.bytes} bytes
                  </li>
                )}
              </For>
            </ul>
            <p>
              In-memory and page-scoped: the seeded FileSystem lives in this Layer instance for the
              life of the page. Reload reseeds; <code>?keep=1</code> keeps the current instance.
            </p>
          </>
        )}
      </Show>
    </main>
  );
}
