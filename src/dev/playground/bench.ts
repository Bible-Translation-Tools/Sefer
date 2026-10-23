import { Option, Result } from "effect";

import { diffSkeleton } from "#core/diff/skeleton";
import type { GalleyService } from "#core/galley";
import type { Project } from "#core/project/project";
import type { SaveCoordinatorService } from "#core/save/saveCoordinator";

import type { Bench } from "./experiment";

export type BaselineKind = "draft" | "disk";

const SPACING: Record<string, number> = { light: 29, normal: 11, heavy: 4 };

const syntheticDraft = (text: string, spacing: number): string => {
  const lines = text.split("\n");
  const out: string[] = [];
  let verse = 0;
  for (const line of lines) {
    if (!line.startsWith("\\v ")) {
      out.push(line);
      continue;
    }
    verse += 1;
    if (verse % spacing !== 0) {
      out.push(line);
      continue;
    }
    const shape = Math.floor(verse / spacing) % 5;
    const marker = /^\\v \S+\s*/.exec(line)?.[0] ?? "\\v ? ";
    const body = line.slice(marker.length);
    const words = body.split(" ");
    if (shape === 0) {
      const at = Math.max(1, Math.floor(words.length / 3));
      out.push(
        marker +
          [...words.slice(0, at), "in", "the", "former", "rendering", ...words.slice(at + 3)].join(
            " ",
          ),
      );
    } else if (shape === 1) {
      out.push(marker + words.slice(0, Math.max(1, Math.ceil(words.length / 2))).join(" "));
    } else if (shape === 2) {
      continue;
    } else if (shape === 3) {
      out.push("\\q1");
      out.push(line);
    } else {
      out.push(line);
      out.push(`${marker}And they abode there, and it was told in the tents of their fathers.`);
    }
  }
  return out.join("\n");
};

export interface BenchRequest {
  readonly project: Project | undefined;
  readonly galley: GalleyService;
  readonly save: SaveCoordinatorService;
  readonly bookId: string | undefined;
  readonly baseline: BaselineKind;
  readonly density: string;
}

export const benchFor = (request: BenchRequest): Bench | undefined => {
  const { project, bookId } = request;
  if (project === undefined || bookId === undefined) return undefined;
  const book = project.book(bookId);
  if (book === undefined) return undefined;

  const currentText = book.source().text;
  const baselineText =
    request.baseline === "disk"
      ? Option.getOrUndefined(request.save.baseline(book))?.text
      : syntheticDraft(currentText, SPACING[request.density] ?? 9);
  if (baselineText === undefined) return undefined;

  const found = diffSkeleton(request.galley, bookId, baselineText, currentText, {
    unchanged: true,
  });

  return {
    bookId,
    baselineLabel: request.baseline === "disk" ? "on disk" : "a synthetic earlier draft",
    currentLabel: "in the editor",
    baselineText,
    currentText,
    skeleton: Result.isSuccess(found) ? found.success : undefined,
    refusal: Result.isFailure(found) ? found.failure.description : undefined,
    galley: request.galley,
  };
};
