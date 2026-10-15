/**
 * What a resource HOLDS, and which reader parses it: the first of the two
 * places the closed union of content kinds is consulted
 * (`planning/items/2026-10-06-resource-kinds.mdx`, §3). The second is
 * the renderer registry (`src/app/ui/kinds/registry.tsx`). Between them
 * nothing narrows a `ContentKind`: a pane, a workflow or a screen asks whether
 * a handle HAS a slot (`handle.places`, `handle.documents`), never which kind
 * it is.
 *
 * Two facts, two fields. `ContainerKind` (below) is how a resource is
 * PACKED — a Burrito, a Resource Container, a folder of loose USFM. This is
 * what it holds. They vary independently: WA's `en_tn` is Markdown per chunk
 * and unfoldingWord's `tn` is TSV per book, both Resource Containers and both
 * Translation Notes, so `recognize` answers a kind AND a format, one reader
 * per (kind, format).
 *
 * `recognize` reads DECODED METADATA ONLY — never a filename, never a content
 * file. A mismatch is a refusal that names what was declared, not a guess and
 * not a try-the-next-reader cascade. The one container with no manifest,
 * loose USFM, is the only one decided by what its files are, and that was
 * decided before this module by `classify` (`import.ts`).
 */

import { Result } from "effect";

import type { Declared } from "../projectMetadata";

/**
 * How a resource is PACKED. The `unknown` classification is never registered.
 * Here beside `ContentKind` because they are the two facts a registered
 * resource carries (`Resource.container`, `Resource.content`), and the
 * Library imports both from one place.
 */
export type ContainerKind = "burrito" | "resourceContainer" | "looseUsfm";

/**
 * Every kind Sefer knows the NAME of. Closed on purpose: every kind is built
 * in, and an open registry would pay for third-party kinds nobody has asked
 * for. A kind is listed before it has a reader so the kind table and the
 * registry have to say, by construction, what they do with it — today, that
 * Sefer cannot show it yet.
 *
 *  - `usfm`     scripture text; the editor's own kind.
 *  - `tn`       Translation Notes: notes addressed by book, chapter and verse.
 *  - `tq`       Translation Questions: the same layout, open ranges. No reader yet.
 *  - `tw`       Translation Words: a dictionary, one article per term. No reader yet.
 *  - `macula-*` Macula's syntax trees: one opaque blob each, a `builtin`
 *               container with no manifest, so never reached through `recognize`.
 */
export type ContentKind = "usfm" | "tn" | "tq" | "tw" | "macula-greek" | "macula-hebrew";

/**
 * What `recognize` says a registered resource is: its kind and the ONE reader
 * that parses it. Only the pairs Sefer has a reader for are members; a kind
 * declared in a format with no reader is refused, never half-read.
 *
 *  - `usfm`            the engine parses it.
 *  - `rcHelpMarkdown`  rc0.2's help layout in Markdown: chapter directories of
 *                      chunk files, notes split by headings (`kinds/tn`).
 */
export type Recognition =
  | { readonly content: "usfm"; readonly format: "usfm" }
  | { readonly content: "tn"; readonly format: "rcHelpMarkdown" };

/** A resource Sefer can register but not read: what it declared, in a sentence. */
export interface Unrecognized {
  /** The kind it declared, when it declared one Sefer knows the name of. */
  readonly content?: ContentKind;
  readonly description: string;
}

/** Everything `recognize` is allowed to look at. */
export interface Recognizable {
  readonly container: ContainerKind;
  /** The Burrito flavor (`textTranslation`) or the Resource Container subject. */
  readonly subject?: string;
  /** `dublin_core.identifier`, lower-cased (`tn`, `ulb`). */
  readonly identifier?: string;
  /** A Resource Container's own `type` and `format`; empty for anything else. */
  readonly declared?: Declared;
}

const USFM: Recognition = { content: "usfm", format: "usfm" };

/** RC identifiers of the helps, and the kind each names. */
const HELPS: Readonly<Record<string, ContentKind>> = { tn: "tn", tq: "tq", tw: "tw" };

const refuse = (description: string, content?: ContentKind): Result.Result<never, Unrecognized> =>
  Result.fail(content === undefined ? { description } : { content, description });

/**
 * A Resource Container, by its `dublin_core`: `type` decides the layout (the
 * spec ties layout to type, not to MIME type) and `identifier` the kind;
 * `format` picks the reader.
 *
 * An RC that declares no `type` reads as scripture, as every RC did before
 * kinds existed: Sefer's own projects and the gateway texts it already holds
 * carry `bundle` or nothing, and refusing them now would empty the reference
 * column of texts that work.
 */
const resourceContainer = (resource: Recognizable): Result.Result<Recognition, Unrecognized> => {
  const type = resource.declared?.type?.toLowerCase();
  const format = resource.declared?.format?.toLowerCase();
  const help = resource.identifier === undefined ? undefined : HELPS[resource.identifier];
  if (type === undefined || type === "" || type === "book" || type === "bundle") {
    if (help !== undefined)
      return refuse(`declares ${resource.identifier} but type ${type ?? "(none)"}`, help);
    return Result.succeed(USFM);
  }
  if (help === "tn" && type === "help") {
    if (format === "text/markdown")
      return Result.succeed({ content: "tn", format: "rcHelpMarkdown" });
    return refuse(`Translation Notes in ${format ?? "an undeclared format"}: no reader yet`, "tn");
  }
  if (help !== undefined) return refuse(`${resource.identifier} (${type}): no reader yet`, help);
  return refuse(`a Resource Container of type ${type} (${resource.identifier ?? "no identifier"})`);
};

/**
 * What a resource holds and which reader parses it, from what it declares.
 *
 * Total over `ContainerKind`, and the only function in the application that
 * looks at a resource's labels to decide that. Called by `Library.add`, so a
 * resource is recognised once, when it is registered, and the answer is kept.
 */
export const recognize = (resource: Recognizable): Result.Result<Recognition, Unrecognized> => {
  switch (resource.container) {
    case "looseUsfm":
      return Result.succeed(USFM);
    case "burrito":
      // Burrito's scripture flavour. Notes would be an `x-` flavour the table
      // knows; none is read yet.
      return resource.subject === "textTranslation"
        ? Result.succeed(USFM)
        : refuse(`a Burrito of flavour ${resource.subject ?? "(none)"}`);
    case "resourceContainer":
      return resourceContainer(resource);
  }
};
