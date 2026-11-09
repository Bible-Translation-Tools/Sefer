import type { Manifest, Read } from "@wycliffeassociates/scripture-kitchen/bento";
import type { LocalizedText } from "@wycliffeassociates/sefer-text/localized";

import type { RelatedResource } from "./relationships";

export type TextDirection = "ltr" | "rtl";

export interface ProjectLanguageMetadata {
  readonly tag: string;
  readonly name: LocalizedText;
  readonly direction: TextDirection;
}

/**
 * What Sefer asks of a project's manifest, adapted from bento's `Manifest`
 * (`fromManifest`). The shape stays because the library stores `container`
 * and `declared` in `library.json`, and resource kinds are recognised on
 * them; bento owns the reading, the leniency and the findings.
 */
export interface ProjectMetadata {
  readonly container: "burrito" | "resourceContainer";
  /** A Burrito's primary id (`Tech_Advance/cdi_reg`); a Resource Container's `identifier`. */
  readonly id: string | undefined;
  readonly name: LocalizedText;
  /**
   * The text's shorthand (`ULB`, `REG`): a Burrito's `identification.abbreviation`,
   * a Resource Container's `dublin_core` identifier.
   */
  readonly abbreviation: LocalizedText;
  readonly language: ProjectLanguageMetadata;
  readonly defaultLocale: string | undefined;
  readonly bookNames: Readonly<Record<string, LocalizedText>>;
  readonly related: readonly RelatedResource[];
  /** As written: a Burrito's flavor (`textTranslation`), a Resource Container's `subject`. */
  readonly subject: string | undefined;
  readonly version: string | undefined;
  readonly declared: Declared;
}

/** A Resource Container's own `type` and `format`; a Burrito declares neither here. */
export interface Declared {
  readonly type: string | undefined;
  readonly format: string | undefined;
}

const blank = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

/**
 * A Burrito or Resource Container manifest as Sefer uses it; `undefined` for
 * a BTT Writer `manifest.json`, which is a book project to migrate, not a
 * project to open.
 */
export const fromManifest = (read: Read): ProjectMetadata | undefined => {
  const manifest: Manifest | undefined = read.manifest;
  if (manifest === undefined || manifest.format === "bttwriter") return undefined;
  const rc = manifest.format === "rc";
  const bookNames: Record<string, LocalizedText> = {};
  for (const entry of manifest.books) bookNames[entry.book] = entry.title;
  const defaultLocale =
    read.detail?.format === "burrito"
      ? blank(read.detail.document.meta?.defaultLocale)
      : blank(manifest.language.tag);
  return {
    container: rc ? "resourceContainer" : "burrito",
    id: rc ? blank(manifest.kind.declared.identifier) : manifest.id,
    name: manifest.name,
    abbreviation: manifest.abbreviation,
    language: manifest.language,
    defaultLocale,
    bookNames,
    related: manifest.sources,
    subject: rc ? manifest.kind.declared.subject : manifest.kind.flavor,
    version: manifest.version,
    declared: rc
      ? { type: manifest.kind.declared.type, format: manifest.kind.declared.format }
      : { type: undefined, format: undefined },
  };
};

/** Whether a read stopped at an error (`manifest-unreadable`), as `readOrThrow` would throw. */
export const unreadable = (read: Read): boolean =>
  read.manifest === undefined || read.findings.some((finding) => finding.severity === "error");
