import { Result } from "effect";

import type { Declared } from "../projectMetadata";

export type ContainerKind = "burrito" | "resourceContainer" | "looseUsfm";

export type ContentKind = "usfm" | "tn" | "tq" | "tw" | "macula-greek" | "macula-hebrew";

export type Recognition =
  | { readonly content: "usfm"; readonly format: "usfm" }
  | { readonly content: "tn"; readonly format: "rcHelpMarkdown" };

export interface Unrecognized {
  readonly content?: ContentKind;
  readonly description: string;
}

export interface Recognizable {
  readonly container: ContainerKind;
  readonly subject?: string;
  readonly identifier?: string;
  readonly declared?: Declared;
}

const USFM: Recognition = { content: "usfm", format: "usfm" };

const HELPS: Readonly<Record<string, ContentKind>> = { tn: "tn", tq: "tq", tw: "tw" };

const refuse = (description: string, content?: ContentKind): Result.Result<never, Unrecognized> =>
  Result.fail(content === undefined ? { description } : { content, description });

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

export const recognize = (resource: Recognizable): Result.Result<Recognition, Unrecognized> => {
  switch (resource.container) {
    case "looseUsfm":
      return Result.succeed(USFM);
    case "burrito":
      return resource.subject === "textTranslation"
        ? Result.succeed(USFM)
        : refuse(`a Burrito of flavour ${resource.subject ?? "(none)"}`);
    case "resourceContainer":
      return resourceContainer(resource);
  }
};
