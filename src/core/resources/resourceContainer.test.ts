import { Result } from "effect";
import { describe, expect, test } from "vitest";

import fixture from "../../../fixtures/resources/manifest.json?raw";
import {
  decodeResourceContainerManifest,
  type ResourceContainerManifest,
} from "./resourceContainer";

const realManifest = (): Record<string, unknown> => JSON.parse(fixture);

const decoded = (value: unknown): ResourceContainerManifest => {
  const result = decodeResourceContainerManifest(value);
  if (Result.isFailure(result)) throw new Error(`decode refused: ${result.failure.message}`);
  return result.success;
};

const refusal = (value: unknown): string => {
  const result = decodeResourceContainerManifest(value);
  if (Result.isSuccess(result))
    throw new Error("decode accepted a manifest it should have refused");
  return result.failure.message;
};

describe("decodeResourceContainerManifest", () => {
  test("decodes the fixture manifest into its dublin_core, checking and projects", () => {
    const manifest = decoded(realManifest());

    expect(manifest.dublin_core.identifier).toBe("reg");
    expect(manifest.dublin_core.title).toBe("Bible");
    expect(manifest.dublin_core.version).toBe("21-05.1");
    expect(manifest.dublin_core.subject).toBe("Bible");
    expect(manifest.dublin_core.format).toBe("text/usfm");
    expect(manifest.dublin_core.type).toBe("bundle");
    expect(manifest.dublin_core.rights).toBe("CC BY-SA 4.0");
    expect(manifest.dublin_core.language).toEqual({
      identifier: "llx",
      direction: "ltr",
      title: "Lauan",
    });
    expect(manifest.dublin_core.source?.[0]).toEqual({
      identifier: "ulb",
      language: "en",
      version: "21-05",
    });
    expect(manifest.checking?.checking_level).toBe("1");
    expect(manifest.projects).toHaveLength(27);
    expect(manifest.projects[0]).toEqual({
      identifier: "mat",
      title: "Maciu",
      path: "./41-MAT.usfm",
      sort: 40,
      versification: "ufw",
      categories: ["bible-nt"],
    });
  });

  test("refuses a manifest with no dublin_core, naming the path", () => {
    const { dublin_core, ...withoutDublinCore } = realManifest();
    expect(dublin_core).toBeDefined();

    expect(refusal(withoutDublinCore)).toContain("dublin_core");
  });

  test("accepts an unknown top-level field", () => {
    const manifest = decoded({ ...realManifest(), unknownFutureField: { a: 1 } });

    expect(manifest.dublin_core.identifier).toBe("reg");
  });
});
