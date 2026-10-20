import { CANON } from "@sefer/text/location/canon";
import { Result } from "effect";
import { stringify as stringifyYaml } from "yaml";

import { decodeBurritoMetadata } from "./burrito";
import { fingerprint } from "./checksum";
import { SOURCE_AUTHORITY, toBurritoRelationships, type RelatedResource } from "./relationships";

export interface NewProjectBook {
  readonly book: string;
  readonly title: string;
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface NewProjectMetadata {
  readonly title: string;
  readonly language: {
    readonly id: string;
    readonly name: string;
    readonly direction: "ltr" | "rtl";
  };
  readonly resource: string;
  readonly contributors: readonly string[];
  readonly sources: readonly RelatedResource[];
  readonly checkingLevel: string;
  readonly rights: string;
  readonly books: readonly NewProjectBook[];
  readonly date: string;
}

const testamentOf = (book: string): "bible-ot" | "bible-nt" =>
  CANON.find((entry) => entry.id === book)?.testament === "ot" ? "bible-ot" : "bible-nt";

const sortOf = (book: string): number => CANON.findIndex((entry) => entry.id === book);

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

export const dedupeSources = (sources: readonly RelatedResource[]): readonly RelatedResource[] => {
  const seen = new Set<string>();
  return sources.filter((ref) => {
    const key = `${ref.language}/${ref.resource}/${ref.version ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

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
