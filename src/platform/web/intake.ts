/**
 * Intake: how a browser gets a project's bytes INTO the FileSystem port, so
 * that the ordinary import pipeline can run over them unchanged.
 *
 * The pipeline in `src/core/resources/import.ts` reads through the port — it
 * copies paths, classifies a root and commits the books it finds. On Tauri a
 * folder picker hands back a real path and there is nothing to do. In a browser
 * there is no path at all: the picker hands back `File` objects (or a
 * `FileSystemDirectoryHandle`), which live nowhere the port can see. Intake is
 * the one step that bridges that — it writes the picked bytes into a fresh
 * staging directory under the host's temp root and returns a `Staged` value
 * describing it. `classify` and `commit` then run exactly as they do on the
 * desktop.
 *
 * Why it builds `Staged` itself rather than calling `stage()`: `stage` copies
 * with `FileSystem.copy`, which the OPFS layer does not implement, and the
 * bytes are already in hand here. Writing them straight into the staging
 * directory is both fewer copies and less to go wrong; the value it returns is
 * the same shape `stage` returns, so nothing downstream can tell the
 * difference.
 *
 * This file is the only place in the application that touches `<input
 * type="file">`, `showDirectoryPicker` or a zip decoder, and nothing outside a
 * web host may import it — `ImportHub` reaches it through a dynamic import
 * inside its web branch, so the desktop bundle never carries the decoder.
 */

import { Effect, FileSystem } from "effect";
import { unzipSync } from "fflate";

import { lastSegment } from "#core/fileSystem/path";
import type { ObservabilityService } from "#core/observability";
import type { Staged } from "#core/resources/import";

/** One picked file, with the path it should have INSIDE the project root. */
export interface IntakeFile {
  /** Relative, "/"-separated, no leading slash: "metadata.json", "usfm/58-PHM.usfm". */
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** What a picker hands back: a name for the project, and its files. */
export interface Picked {
  /** The folder's (or archive's) own name — the project's folder name on disk. */
  readonly name: string;
  readonly files: readonly IntakeFile[];
}

/** Apple's resource forks and the OS's own droppings are never project files. */
const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|\._)/;

const usable = (path: string): boolean => path !== "" && !path.endsWith("/") && !IGNORED.test(path);

/**
 * Drops the one folder every entry sits in, if there is one.
 *
 * A zipped project is almost always `small-nt/…`, and a folder pick reports
 * `small-nt/…` in `webkitRelativePath` too. The project root has to BE that
 * folder, or `metadata.json` ends up one level down and classification fails.
 * A set of entries that do not share a top folder is left alone.
 */
const stripCommonRoot = (
  paths: readonly string[],
): { readonly root: string; readonly cut: number } => {
  const first = paths[0];
  if (first === undefined) return { root: "", cut: 0 };
  const slash = first.indexOf("/");
  if (slash <= 0) return { root: "", cut: 0 };
  const candidate = first.slice(0, slash);
  const shared = paths.every((path) => path.startsWith(`${candidate}/`));
  return shared ? { root: candidate, cut: candidate.length + 1 } : { root: "", cut: 0 };
};

/** `<input>` in a promise: resolves with the chosen files, or nothing. */
const pickFiles = (attributes: Readonly<Record<string, string>>): Promise<readonly File[]> =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    for (const [name, value] of Object.entries(attributes)) input.setAttribute(name, value);
    input.style.display = "none";
    // `cancel` is not universal, so the picker also resolves on the next focus
    // after `change` never fired: a dialog nobody completed must not hang the
    // caller forever.
    let done = false;
    const finish = (files: readonly File[]): void => {
      if (done) return;
      done = true;
      globalThis.removeEventListener("focus", focused);
      input.remove();
      resolve(files);
    };
    // The window gets focus back when the dialog closes, either way. `change`
    // can land a moment after that focus, so give it a beat before deciding
    // nothing was chosen. Without this a browser that sends no `cancel` left
    // the import's "Selecting the source…" dialog up for good, over the rail.
    const focused = (): void => {
      setTimeout(() => finish([...(input.files ?? [])]), 500);
    };
    input.addEventListener("change", () => finish([...(input.files ?? [])]), { once: true });
    input.addEventListener("cancel", () => finish([]), { once: true });
    globalThis.addEventListener("focus", focused);
    document.body.append(input);
    input.click();
  });

/**
 * Walks a directory handle. Preferred over the input when the browser has it:
 * it reports the folder's own name, and it does not depend on the non-standard
 * `webkitdirectory` attribute.
 */
const walk = async (
  directory: FileSystemDirectoryHandle,
  prefix: string,
  into: IntakeFile[],
): Promise<void> => {
  for await (const [name, handle] of directory.entries()) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (handle.kind === "directory") {
      // SAFETY: `kind` is the discriminant the spec defines for these two
      // handles, and the DOM types do not narrow on it.
      await walk(handle as FileSystemDirectoryHandle, path, into);
      continue;
    }
    if (!usable(path)) continue;
    // SAFETY: the branch above took every directory, so this is a file handle.
    const file = await (handle as FileSystemFileHandle).getFile();
    into.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
};

/**
 * A folder, as files. `showDirectoryPicker` where it exists, and otherwise a
 * `webkitdirectory` input, whose `webkitRelativePath` carries the tree.
 */
export const pickFolder = async (
  observability?: ObservabilityService,
): Promise<Picked | undefined> => {
  // SAFETY: `showDirectoryPicker` is not in the DOM lib this project builds
  // against; the shape asserted here is the one the caller checks for with
  // `typeof` on the next line before ever calling it.
  const picker = (
    globalThis as {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (typeof picker === "function") {
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await picker();
    } catch {
      // The only failure worth distinguishing is "the reader closed it", and
      // every browser reports that as a rejection. Nothing was picked.
      return undefined;
    }
    const stop = observability?.span("import.pick.read", undefined, { "import.source": "folder" });
    const files: IntakeFile[] = [];
    try {
      await walk(handle, "", files);
    } finally {
      stop?.({ "import.files": files.length });
    }
    return files.length === 0 ? undefined : { name: handle.name, files };
  }

  const picked = await pickFiles({ webkitdirectory: "", directory: "", multiple: "" });
  if (picked.length === 0) return undefined;
  const relative = picked.map((file) => file.webkitRelativePath || file.name);
  const { root, cut } = stripCommonRoot(relative);
  const stop = observability?.span("import.pick.read", undefined, { "import.source": "folder" });
  const files: IntakeFile[] = [];
  try {
    for (const [index, file] of picked.entries()) {
      const path = (relative[index] ?? file.name).slice(cut);
      if (!usable(path)) continue;
      files.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
  } finally {
    stop?.({ "import.files": files.length });
  }
  return files.length === 0 ? undefined : { name: root === "" ? "project" : root, files };
};

/**
 * An archive, as files. `unzipSync` decodes the whole thing in memory, which is
 * the right trade for a scripture project: a Burrito of the whole Bible is a
 * few megabytes of text, and the streaming API costs a worker to use properly.
 */
export const pickZip = async (
  observability?: ObservabilityService,
): Promise<Picked | undefined> => {
  const picked = await pickFiles({ accept: ".zip,application/zip" });
  const archive = picked[0];
  if (archive === undefined) return undefined;

  const read = observability?.span("import.pick.read", undefined, { "import.source": "zip" });
  let archiveBytes: ArrayBuffer;
  try {
    archiveBytes = await archive.arrayBuffer();
  } finally {
    read?.();
  }
  const unzip = observability?.span("import.unzip", undefined, { "import.source": "zip" });
  let names: string[] = [];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(archiveBytes));
    names = Object.keys(entries).filter((name) => usable(name));
  } finally {
    unzip?.({ "import.entries": names.length });
  }
  if (names.length === 0) return undefined;
  const { root, cut } = stripCommonRoot(names);
  const files: IntakeFile[] = [];
  for (const name of names) {
    const bytes = entries[name];
    if (bytes === undefined) continue;
    files.push({ path: name.slice(cut), bytes });
  }
  const stem = lastSegment(archive.name).replace(/\.zip$/iu, "");
  return { name: root === "" ? stem : root, files };
};

/**
 * Writes what was picked into a fresh staging directory and describes it the
 * way `stage()` would.
 *
 * `onWritten` is called after each file so the dialog can count: an import of
 * sixty-six books is long enough that a spinner alone is not an answer.
 */
export const intake = (
  fileSystem: FileSystem.FileSystem,
  stagingRoot: string,
  picked: Picked,
  onWritten?: (written: number, total: number) => void,
): Effect.Effect<Staged, never, never> =>
  Effect.gen(function* () {
    yield* Effect.orElseSucceed(
      fileSystem.makeDirectory(stagingRoot, { recursive: true }),
      () => undefined,
    );
    const root = `${stagingRoot}/intake-${Date.now().toString(36)}`;
    yield* Effect.orElseSucceed(
      fileSystem.makeDirectory(root, { recursive: true }),
      () => undefined,
    );

    const written: string[] = [];
    for (const file of picked.files) {
      const target = `${root}/${file.path}`;
      const parent = target.slice(0, target.lastIndexOf("/"));
      yield* Effect.orElseSucceed(
        fileSystem.makeDirectory(parent, { recursive: true }),
        () => undefined,
      );
      // A file that cannot be written is skipped rather than fatal: the import
      // then classifies what did arrive, and `commit` refuses an empty or
      // unrecognisable staging directory with a reason worth reading.
      const done = yield* Effect.result(fileSystem.writeFile(target, file.bytes));
      if (done._tag === "Success") written.push(file.path);
      onWritten?.(written.length, picked.files.length);
    }

    return {
      stageId: lastSegment(root),
      root,
      sources: [picked.name],
      files: [...written].sort(),
    } satisfies Staged;
  });

/** A directory in the FileSystem port that now holds what somebody picked. */
export interface Intaken {
  /** The archive's or folder's own name, for a label. */
  readonly name: string;
  /** The path to read it back through the port. */
  readonly root: string;
}

/**
 * Pick a zip or a folder and leave it somewhere the port can read, for a
 * caller that wants a PATH rather than an import.
 *
 * Review is that caller (`src/app/ui/review/sources.ts`): the other side of a
 * comparison is a folder of books, and a zip becomes one by being unpacked
 * into a scratch directory. Nothing is classified and nothing is committed —
 * the bytes land under `scratchRoot` and the path comes back, so a comparison
 * can be a read of a directory and never a second reading of an archive.
 *
 * `undefined` means the reader closed the picker, which is not a failure.
 */
export const pickInto = (
  fileSystem: FileSystem.FileSystem,
  scratchRoot: string,
  source: "zip" | "folder",
): Effect.Effect<Intaken | undefined> =>
  Effect.flatMap(
    Effect.promise(() => (source === "zip" ? pickZip() : pickFolder())),
    (picked) =>
      picked === undefined
        ? Effect.succeed(undefined)
        : Effect.map(intake(fileSystem, scratchRoot, picked), (staged) => ({
            name: picked.name,
            root: staged.root,
          })),
  );
