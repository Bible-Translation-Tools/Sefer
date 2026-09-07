import { Result } from "effect";
import { describe, expect, test } from "vitest";

import fixture from "../../../fixtures/resources/metadata.json?raw";
import { type BurritoMetadata, decodeBurritoMetadata } from "./burrito";

const realMetadata = (): Record<string, unknown> => JSON.parse(fixture);

const decoded = (value: unknown): BurritoMetadata => {
  const result = decodeBurritoMetadata(value);
  if (Result.isFailure(result)) throw new Error(`decode refused: ${result.failure.message}`);
  return result.success;
};

const refusal = (value: unknown): string => {
  const result = decodeBurritoMetadata(value);
  if (Result.isSuccess(result)) throw new Error("decode accepted metadata it should have refused");
  return result.failure.message;
};

describe("decodeBurritoMetadata", () => {
  test("decodes the fixture metadata into its identification, type, language and ingredients", () => {
    const metadata = decoded(realMetadata());

    expect(metadata.format).toBe("scripture burrito");
    expect(metadata.meta.version).toBe("1.0.0");
    expect(metadata.identification.name.en).toBe("Unlocked Literal Bible");
    expect(metadata.identification.abbreviation?.en).toBe("ULB");
    expect(metadata.type.flavorType.name).toBe("scripture");
    expect(metadata.type.flavorType.flavor.name).toBe("textTranslation");
    expect(Object.keys(metadata.type.flavorType.currentScope ?? {})).toEqual([
      "PSA",
      "PHM",
      "3JN",
      "JUD",
    ]);
    expect(metadata.languages[0]).toEqual({
      tag: "en",
      name: { en: "English" },
      scriptDirection: "ltr",
    });
    expect(metadata.ingredients["release/58-PHM.usfm"]).toEqual({
      checksum: { md5: "725192c740aca0dcd9e21ed685f15d2e" },
      mimeType: "text/usfm",
      size: 2683,
      scope: { PHM: [] },
    });
    expect(metadata.localizedNames?.["3JN"]?.short.en).toBe("3 John");
  });

  test("refuses metadata with no identification, naming the path", () => {
    const { identification, ...withoutIdentification } = realMetadata();
    expect(identification).toBeDefined();

    expect(refusal(withoutIdentification)).toContain("identification");
  });

  test("refuses metadata whose format is not a scripture burrito", () => {
    const message = refusal({ ...realMetadata(), format: "resource container" });

    expect(message).toContain("format");
  });

  test("accepts an unknown top-level field", () => {
    const metadata = decoded({ ...realMetadata(), unknownFutureField: { a: 1 } });

    expect(metadata.identification.name.en).toBe("Unlocked Literal Bible");
  });
});
