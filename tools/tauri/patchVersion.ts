import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SEMVER = /^\d+\.\d+\.\d+(?:-\d{1,5})?$/u;

const patchJson = (file: string, version: string): void => {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (parsed === null || typeof parsed !== "object") throw new Error(`${file} is not an object`);
  const next = { ...parsed, version };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
};

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
