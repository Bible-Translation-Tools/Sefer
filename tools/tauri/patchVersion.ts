/**
 * Stamps one version into the three manifests a desktop release reads.
 *
 * The in-tree version is `0.0.0` and stays there: a release's version comes
 * from the tag, and keeping it out of the working tree means no commit exists
 * whose only purpose is a version bump. CI calls this just before building.
 *
 * All three have to agree or the updater breaks in a way nobody sees until an
 * install silently does nothing: `tauri.conf.json`'s version is what the
 * plugin substitutes into `{{current_version}}`, `Cargo.toml`'s is what the
 * bundler names the artifact, and `package.json`'s is what the About panel
 * would otherwise contradict.
 *
 * Usage: `node tools/tauri/patchVersion.ts 1.2.3`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** Tauri's MSI bundler accepts only a single numeric pre-release identifier. */
const SEMVER = /^\d+\.\d+\.\d+(?:-\d{1,5})?$/u;

const patchJson = (file: string, version: string): void => {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (parsed === null || typeof parsed !== "object") throw new Error(`${file} is not an object`);
  const next = { ...parsed, version };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
};

/**
 * Only the FIRST `version = "…"` is replaced, which is the `[package]` one:
 * every dependency's version line comes after it. A TOML parser would be
 * heavier than the guarantee it buys here.
 */
const patchCargo = (file: string, version: string): void => {
  const text = readFileSync(file, "utf8");
  const patched = text.replace(/^version = ".*"$/mu, `version = "${version}"`);
  if (patched === text) throw new Error(`${file}: no [package] version line to patch`);
  writeFileSync(file, patched, "utf8");
};

const main = (): void => {
  const version = process.argv[2];
  if (version === undefined || !SEMVER.test(version)) {
    process.stderr.write(
      "usage: node tools/tauri/patchVersion.ts <x.y.z[-N]>  (N numeric, <= 65535)\n",
    );
    process.exit(2);
    return;
  }
  const root = process.cwd();
  patchJson(path.join(root, "package.json"), version);
  patchJson(path.join(root, "src-tauri/tauri.conf.json"), version);
  patchCargo(path.join(root, "src-tauri/Cargo.toml"), version);
  process.stdout.write(
    `version ${version} stamped into package.json, tauri.conf.json, Cargo.toml\n`,
  );
};

main();
