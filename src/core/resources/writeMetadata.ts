/**
 * Writes a new project's metadata: one description, two files.
 *
 *   metadata.json    Scripture Burrito — what Sefer reads (`discovery.ts`
 *                    reads the Burrito first)
 *   manifest.yaml    Resource Container — output only, for the
 *                    organisation's other tools; if it drifts, the Burrito
 *                    wins and the next write fixes it
 *
 * Both follow what WA's own converter (usfm-tools, "UsfmWizard") writes for
 * `Tech_Advance/bwc_reg`, with the three corrections the migration note
 * lists: contributors de-duplicated, sources de-duplicated, and sources as
 * Burrito relationships (`wycliffeassociates::en/ulb`, revision = the listed
 * version), not only RC `source`.
 *
 * The Burrito is checked against the same schema every reader decodes
 * through, so a project Sefer writes is a project Sefer can open.
 *
 * Pure: the caller writes the bytes. Kept in `src/core/resources` until a
 * second tool needs it, then extracted (the note's "shared org library").
 */

import { Result } from "effect";
import { stringify as stringifyYaml } from "yaml";

import { CANON } from "../location/canon";
import { decodeBurritoMetadata } from "./burrito";
import { fingerprint } from "./checksum";
import { SOURCE_AUTHORITY, toBurritoRelationships, type RelatedResource } from "./relationships";

export interface NewProjectBook {
  /** Upper case: `1JN`. */
  readonly book: string;
  /** What the project calls it: "1 Yohane". */
  readonly title: string;
  /** `63-1JN.usfm`. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** The project form, as the person confirmed it. */
export interface NewProjectMetadata {
  readonly title: string;
  readonly language: {
    readonly id: string;
    readonly name: string;
    readonly direction: "ltr" | "rtl";
  };
  /** `reg`, `ulb`. */
  readonly resource: string;
  readonly contributors: readonly string[];
  /** Every listed version: the files keep them all, as written. */
  readonly sources: readonly RelatedResource[];
  /** Ours, not the source's: Writer's `"3"` is the SOURCE's checking level. */
  readonly checkingLevel: string;
  readonly rights: string;
  readonly books: readonly NewProjectBook[];
  /** ISO date, `2026-10-06`. */
  readonly date: string;
}

const testamentOf = (book: string): "bible-ot" | "bible-nt" =>
  CANON.find((entry) => entry.id === book)?.testament === "ot" ? "bible-ot" : "bible-nt";

const sortOf = (book: string): number => CANON.findIndex((entry) => entry.id === book);

/**
 * Merged on a normalised key — case-folded, `_` read as a space, whitespace
 * collapsed — keeping the first spelling seen. A team written as one string
 * ("Kapiso Gershom, Salt Mwinuna, …") stays one entry: splitting on commas
 * would break names that contain one.
 */
export const dedupeContributors = (names: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = name.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(name.trim());
  }
  return out;
};

/** Every listed version, once each: (language, resource, version). */
export const dedupeSources = (sources: readonly RelatedResource[]): readonly RelatedResource[] => {
  const seen = new Set<string>();
  return sources.filter((ref) => {
    const key = `${ref.language}/${ref.resource}/${ref.version ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** `metadata.json`'s text, or why the schema refuses it. */
export const burritoText = (form: NewProjectMetadata): Result.Result<string, string> => {
  const scope = Object.fromEntries(form.books.map((book) => [book.book, []]));
  const value = {
    format: "scripture burrito",
    meta: {
      version: "1.0.0",
      category: "source",
      defaultLocale: "en",
      dateCreated: form.date,
      generator: { softwareName: "Sefer" },
    },
    idAuthorities: {
      [SOURCE_AUTHORITY.key]: { id: SOURCE_AUTHORITY.id, name: SOURCE_AUTHORITY.name },
    },
    identification: {
      name: { en: form.title },
      abbreviation: { en: form.resource },
    },
    confidential: false,
    type: {
      flavorType: {
        name: "scripture",
        flavor: {
          name: "textTranslation",
          projectType: "standard",
          translationType: "newTranslation",
          audience: "common",
          usfmVersion: "3.0",
        },
        currentScope: scope,
      },
    },
    languages: [
      {
        tag: form.language.id,
        name: { en: form.language.name, [form.language.id]: form.language.name },
        scriptDirection: form.language.direction,
      },
    ],
    ingredients: Object.fromEntries(
      form.books.map((book) => {
        const print = fingerprint(book.bytes);
        return [
          book.path,
          {
            checksum: { md5: print.md5 },
            mimeType: "text/x-usfm",
            size: print.size,
            scope: { [book.book]: [] },
          },
        ];
      }),
    ),
    localizedNames: Object.fromEntries(
      form.books.map((book) => [book.book, { short: { [form.language.id]: book.title } }]),
    ),
    relationships: toBurritoRelationships(form.sources),
  };
  const checked = decodeBurritoMetadata(value);
  return Result.isFailure(checked)
    ? Result.fail(checked.failure.message)
    : Result.succeed(`${JSON.stringify(value, null, 2)}\n`);
};

/** `manifest.yaml`'s text, in bwc_reg's shape. */
export const resourceContainerText = (form: NewProjectMetadata): string =>
  stringifyYaml({
    dublin_core: {
      conformsto: "rc0.2",
      contributor: [...form.contributors],
      creator: "Bible translation community",
      format: "text/usfm",
      identifier: form.resource,
      issued: form.date,
      language: {
        direction: form.language.direction,
        identifier: form.language.id,
        title: form.language.name,
      },
      modified: form.date,
      publisher: "Wycliffe Associates",
      relation: [`${form.language.id}/${form.resource}`],
      rights: form.rights,
      source: form.sources.map((ref) => ({
        identifier: ref.resource,
        language: ref.language,
        ...(ref.version === undefined ? {} : { version: ref.version }),
      })),
      subject: "Bible",
      title: form.title,
      type: "bundle",
      version: "1",
    },
    checking: { checking_entity: [], checking_level: form.checkingLevel },
    projects: [...form.books]
      .sort((a, b) => sortOf(a.book) - sortOf(b.book))
      .map((book) => ({
        title: book.title,
        identifier: book.book.toLowerCase(),
        path: `./${book.path}`,
        sort: sortOf(book.book),
        categories: [testamentOf(book.book)],
        versification: "ufw",
      })),
  });
