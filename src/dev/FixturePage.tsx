import { Effect, FileSystem, Layer, Result } from "effect";
import { For, Show, createSignal } from "solid-js";

import type { Composition } from "../app/composition";
import { useComposition } from "../app/CompositionContext";
import { Button } from "../app/ui/primitives";
import { FixtureFileSystemLive, SMALL_NT, SMALL_NT_ROOT } from "../core/fixture/smallNt";
import { installDevState } from "../platform/observability";

interface DevFixtureFile {
  readonly path: string;
  readonly bytes: number;
}

interface DevFixtureState {
  readonly project: string;
  readonly files: readonly DevFixtureFile[];
  readonly seededAt: number;
}

const listFixture: Effect.Effect<readonly DevFixtureFile[], never, FileSystem.FileSystem> =
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const names = yield* fileSystem.readDirectory(SMALL_NT_ROOT);
    const files: DevFixtureFile[] = [];
    for (const name of [...names].sort()) {
      const bytes = yield* fileSystem.readFile(`${SMALL_NT_ROOT}/${name}`);
      files.push({ path: name, bytes: bytes.length });
    }
    return files;
  }).pipe(Effect.orDie);

// No second composition: the root's already-built services come back through
// `composition.layer`, and only the seeded FileSystem is new. Each call builds
// a fresh instance of the memory Layer, which is what `reset` reseeds.
const seed = async (composition: Composition): Promise<DevFixtureState> => {
  const files = await Effect.runPromise(
    Effect.provide(listFixture, Layer.merge(composition.layer, FixtureFileSystemLive)),
  );
  const fixture: DevFixtureState = { project: SMALL_NT, files, seededAt: Date.now() };

  composition.observability.note("fixture", "ready", `${SMALL_NT}: ${files.length} files`);
  installDevState(() => ({
    boot: composition.boot,
    fixture,
    observability: composition.observability.recent().length,
  }));

  return fixture;
};

const bootLabel = (result: Composition["boot"]): string =>
  Result.isSuccess(result) ? `${result.success.host} ${result.success.build}` : result.failure._tag;

let held: DevFixtureState | undefined;

const fixtureSession = async (
  composition: Composition,
  keep: boolean,
): Promise<DevFixtureState> => {
  if (keep && held !== undefined) return held;
  held = await seed(composition);
  return held;
};

const keepRequested = (): boolean =>
  typeof location === "object" && new URLSearchParams(location.search).get("keep") === "1";

export function FixturePage() {
  const composition = useComposition();
  const [fixture, setFixture] = createSignal<DevFixtureState | undefined>(undefined);

  const load = (keep: boolean): void => {
    void fixtureSession(composition, keep).then((ready) => {
      setFixture(ready);
    });
  };

  load(keepRequested());

  return (
    <main class="min-w-0 space-y-3 p-6" data-fixture={SMALL_NT}>
      <h1 class="text-h3 font-semibold">Fixture project: {SMALL_NT}</h1>
      <Show when={fixture()} fallback={<p class="text-small text-on-surface-tertiary">Seeding…</p>}>
        {(ready) => (
          <>
            <p
              class="text-small text-on-surface-secondary"
              data-boot-phase={Result.isSuccess(composition.boot) ? "ready" : "failed"}
            >
              boot: {bootLabel(composition.boot)}
            </p>
            <Button onClick={() => load(false)}>reset</Button>
            <ul class="text-small" data-fixture-files={ready().files.length}>
              <For each={ready().files}>
                {(file) => (
                  <li data-path={file.path}>
                    {file.path} — {file.bytes} bytes
                  </li>
                )}
              </For>
            </ul>
            <p class="text-small text-on-surface-tertiary">
              In-memory and page-scoped: the seeded FileSystem lives in this Layer instance for the
              life of the page. Reload reseeds; <code>?keep=1</code> keeps the current instance.
            </p>
          </>
        )}
      </Show>
    </main>
  );
}
