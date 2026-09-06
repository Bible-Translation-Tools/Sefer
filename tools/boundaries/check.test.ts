import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { checkCoreBoundary } from "./check";

let root: string;

const write = (relativePath: string, source: string): void => {
  const full = path.join(root, relativePath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, source, "utf8");
};

const violationsFor = (relativePath: string, source: string) => {
  write(relativePath, source);
  return checkCoreBoundary({
    coreDir: path.join(root, "src", "core"),
    paths: { "@/*": ["./src/*"] },
    pathsBase: root,
  }).filter((violation) => violation.file === path.join(root, relativePath));
};

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "sefer-boundaries-"));
  mkdirSync(path.join(root, "src", "core", "nested"), { recursive: true });
  mkdirSync(path.join(root, "src", "platform"), { recursive: true });
  write("src/core/ports.ts", "export type Port = { readonly id: string };\n");
  write("src/platform/host.ts", "export const detectHost = () => 'web';\n");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("core boundary checker", () => {
  test("catches a deep relative import that escapes core", () => {
    const found = violationsFor(
      "src/core/nested/deep.ts",
      'import { detectHost } from "../../platform/host";\nexport const a = detectHost;\n',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ line: 1, specifier: "../../platform/host" });
    expect(found[0]?.reason).toContain("outside core");
  });

  test("catches a dynamic import", () => {
    const found = violationsFor(
      "src/core/dynamic.ts",
      'export const load = () => import("../platform/host");\n',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toContain("import()");
  });

  test("catches a re-export", () => {
    const found = violationsFor("src/core/reexport.ts", 'export * from "../platform/host";\n');
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toContain("export … from");
  });

  test("catches a type-only import", () => {
    const found = violationsFor(
      "src/core/typeonly.ts",
      'import type { detectHost } from "../platform/host";\nexport type A = typeof detectHost;\n',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toContain("import type");
  });

  test("catches a tsconfig path alias", () => {
    const found = violationsFor(
      "src/core/aliased.ts",
      'import { detectHost } from "@/platform/host";\nexport const a = detectHost;\n',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toContain("alias resolves to");
  });

  test("catches require in both spellings", () => {
    const found = violationsFor(
      "src/core/required.ts",
      'const host = require("../platform/host");\nimport legacy = require("../platform/host");\nexport const a = [host, legacy];\n',
    );
    expect(found).toHaveLength(2);
    expect(found.map((violation) => violation.reason.split(" (")[1])).toEqual([
      "require())",
      "import = require)",
    ]);
  });

  test("catches an import.meta.glob pattern", () => {
    const found = violationsFor(
      "src/core/globbed.ts",
      'export const modules = import.meta.glob("../platform/*.ts");\n',
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.reason).toContain("import.meta.glob");
  });

  test("catches forbidden framework packages", () => {
    const found = violationsFor(
      "src/core/framework.ts",
      'import { createSignal } from "solid-js";\nimport { EditorState } from "@codemirror/state";\nimport { createRouter } from "@tanstack/solid-router";\nimport { invoke } from "@tauri-apps/api/core";\nimport git from "isomorphic-git";\nexport const a = [createSignal, EditorState, createRouter, invoke, git];\n',
    );
    expect(found.map((violation) => violation.specifier)).toEqual([
      "solid-js",
      "@codemirror/state",
      "@tanstack/solid-router",
      "@tauri-apps/api/core",
      "isomorphic-git",
    ]);
  });

  test("allows core-to-core imports at any depth", () => {
    expect(
      violationsFor(
        "src/core/nested/inner.ts",
        'import type { Port } from "../ports";\nexport type A = Port;\n',
      ),
    ).toEqual([]);
  });

  test("allows effect and node builtins", () => {
    expect(
      violationsFor(
        "src/core/allowed.ts",
        'import { Effect } from "effect";\nimport path from "node:path";\nexport const a = [Effect, path];\n',
      ),
    ).toEqual([]);
  });
});
