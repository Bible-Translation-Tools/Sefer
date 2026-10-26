import { Effect, FileSystem } from "effect";
import { unzipSync } from "fflate";

import { lastSegment } from "#core/fileSystem/path";
import type { ObservabilityService } from "#core/observability";
import type { Staged } from "#core/resources/import";

export interface IntakeFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface Picked {
  readonly name: string;
  readonly files: readonly IntakeFile[];
}

const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|\._)/;

const usable = (path: string): boolean => path !== "" && !path.endsWith("/") && !IGNORED.test(path);

const entryPath = (name: string): string => name.replace(/^(?:\.?\/)+/u, "");

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

const pickFiles = (attributes: Readonly<Record<string, string>>): Promise<readonly File[]> =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    for (const [name, value] of Object.entries(attributes)) input.setAttribute(name, value);
    input.style.display = "none";
    let done = false;
    const finish = (files: readonly File[]): void => {
      if (done) return;
      done = true;
      globalThis.removeEventListener("focus", focused);
      input.remove();
      resolve(files);
    };
    const focused = (): void => {
      setTimeout(() => finish([...(input.files ?? [])]), 500);
    };
    input.addEventListener("change", () => finish([...(input.files ?? [])]), { once: true });
    input.addEventListener("cancel", () => finish([]), { once: true });
    globalThis.addEventListener("focus", focused);
    document.body.append(input);
    input.click();
  });

const walk = async (
  directory: FileSystemDirectoryHandle,
  prefix: string,
  into: IntakeFile[],
): Promise<void> => {
  for await (const [name, handle] of directory.entries()) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (handle.kind === "directory") {
      // SAFETY: `kind` is the discriminant the spec defines for these two handles, and the DOM types do not narrow on it.
      await walk(handle as FileSystemDirectoryHandle, path, into);
      continue;
    }
    if (!usable(path)) continue;
    // SAFETY: the branch above took every directory, so this is a file handle.
    const file = await (handle as FileSystemFileHandle).getFile();
    into.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
};

export const pickFolder = async (
  observability?: ObservabilityService,
): Promise<Picked | undefined> => {
  // SAFETY: `showDirectoryPicker` is not in the DOM lib this project builds against; the shape asserted here is the one the caller checks for with `typeof` on the next line before ever calling it.
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

const unzipPicked = async (
  archive: File,
  observability?: ObservabilityService,
): Promise<Picked | undefined> => {
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
    names = Object.keys(entries).filter((name) => usable(entryPath(name)));
  } finally {
    unzip?.({ "import.entries": names.length });
  }
  if (names.length === 0) return undefined;
  const { root, cut } = stripCommonRoot(names.map(entryPath));
  const files: IntakeFile[] = [];
  for (const name of names) {
    const bytes = entries[name];
    if (bytes === undefined) continue;
    files.push({ path: entryPath(name).slice(cut), bytes });
  }
  const stem = lastSegment(archive.name).replace(/\.zip$/iu, "");
  return { name: root === "" ? stem : root, files };
};

export const pickZip = async (
  observability?: ObservabilityService,
): Promise<Picked | undefined> => {
  const picked = await pickFiles({ accept: ".zip,application/zip" });
  const archive = picked[0];
  return archive === undefined ? undefined : unzipPicked(archive, observability);
};

const entriesOf = (directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> => {
  const reader = directory.createReader();
  const all: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    // `readEntries` answers in batches and an empty batch means done.
    const next = (): void =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });
};

const walkEntry = async (entry: FileSystemEntry, prefix: string, into: IntakeFile[]) => {
  const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
  if (entry.isDirectory) {
    // SAFETY: `isDirectory` is the discriminant the spec defines, and the DOM types do not narrow on it.
    for (const child of await entriesOf(entry as FileSystemDirectoryEntry))
      await walkEntry(child, path, into);
    return;
  }
  if (!usable(path)) return;
  const file = await new Promise<File>((resolve, reject) =>
    // SAFETY: the branch above took every directory, so this is a file entry.
    (entry as FileSystemFileEntry).file(resolve, reject),
  );
  into.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
};

export interface Dropped {
  readonly entry: FileSystemEntry | null;
  readonly file: File | undefined;
}

/**
 * What was dropped on the import area: one folder, or one zip. The caller takes `entry` and `file`
 * off the `DataTransfer` synchronously inside its drop handler, because the browser empties it after.
 */
export const readDropped = async (
  dropped: Dropped,
  observability?: ObservabilityService,
): Promise<Picked | undefined> => {
  const { entry, file } = dropped;
  if (entry?.isDirectory !== true)
    return file === undefined ? undefined : unzipPicked(file, observability);
  const stop = observability?.span("import.pick.read", undefined, { "import.source": "folder" });
  const files: IntakeFile[] = [];
  try {
    // SAFETY: checked `isDirectory` above.
    for (const child of await entriesOf(entry as FileSystemDirectoryEntry))
      await walkEntry(child, "", files);
  } finally {
    stop?.({ "import.files": files.length });
  }
  return files.length === 0 ? undefined : { name: entry.name, files };
};

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

export interface Intaken {
  readonly name: string;
  readonly root: string;
}

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
