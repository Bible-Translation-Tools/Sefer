import { readFileSync } from "node:fs";

import { read } from "@wycliffeassociates/scripture-kitchen/bento";
import { describe, expect, test } from "vitest";

import { fromManifest, unreadable } from "./projectMetadata";

const fixture = (name: string): Uint8Array =>
  readFileSync(new URL(`../../../fixtures/resources/${name}`, import.meta.url));

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("fromManifest", () => {
  test("a Burrito: its primary id, names, language, books, sources and flavor", () => {
    const metadata = fromManifest(read("metadata.json", fixture("metadata.json")));

    expect(metadata?.container).toBe("burrito");
    expect(metadata?.name.en).toBe("Unlocked Literal Bible");
    expect(metadata?.abbreviation.en).toBe("ULB");
    expect(metadata?.language.tag).toBe("en");
    expect(metadata?.defaultLocale).toBe("en");
    expect(metadata?.subject).toBe("textTranslation");
    expect(Object.keys(metadata?.bookNames ?? {})).toEqual(["PSA", "PHM", "3JN", "JUD"]);
    expect(metadata?.declared).toEqual({ type: undefined, format: undefined });
  });

  test("a Resource Container: identifier as id and abbreviation, keyed by its language", () => {
    const metadata = fromManifest(read("manifest.yaml", fixture("manifest.yaml")));

    expect(metadata?.container).toBe("resourceContainer");
    expect(metadata?.id).toBe("reg");
    expect(metadata?.abbreviation).toEqual({ llx: "reg" });
    expect(metadata?.language).toEqual({ tag: "llx", name: { llx: "Lauan" }, direction: "ltr" });
    expect(metadata?.defaultLocale).toBe("llx");
    expect(metadata?.subject).toBe("Bible");
    expect(metadata?.version).toBe("21-05.1");
    expect(metadata?.declared).toEqual({ type: "bundle", format: "text/usfm" });
    expect(Object.keys(metadata?.bookNames ?? {})).toHaveLength(27);
    expect(metadata?.bookNames.MAT).toEqual({ llx: "Maciu" });
  });

  test("a Resource Container's sources become related texts, lower-cased", () => {
    const yaml =
      "dublin_core:\n  identifier: reg\n  language: { identifier: llx, title: Lauan }\n" +
      "  source:\n    - { identifier: ULB, language: EN, version: '12' }\n" +
      "projects: []\n";
    expect(fromManifest(read("manifest.yaml", encode(yaml)))?.related).toEqual([
      { relation: "source", language: "en", resource: "ulb", version: "12" },
    ]);
  });

  test("a BTT Writer manifest.json is a book to migrate, not a project to open", () => {
    const writer = JSON.stringify({
      target_language: { id: "tmf", name: "Toba-Maskoy" },
      project: { id: "3jn" },
      resource: { id: "reg" },
    });
    const writerRead = read("manifest.json", encode(writer));
    expect(unreadable(writerRead)).toBe(false);
    expect(fromManifest(writerRead)).toBeUndefined();
  });

  test("a file that is not JSON stops the read", () => {
    expect(unreadable(read("metadata.json", encode("{ not json")))).toBe(true);
  });
});
