import * as TextResult from "@wycliffeassociates/sefer-text/result";
import { decode } from "@wycliffeassociates/sefer-text/source";
import { Effect, Result } from "effect";

import { Galley } from "../galley";
import { Git, type Repo } from "../git/git";
import { headerOf, namesOf, type Names } from "./bookNames";

/**
 * Book names as a version recorded them, for the two places the project list
 * is written from the books (RFC "Book names"): Record, which renames the
 * books whose names changed since the last version, and combine, which takes
 * the shared project's manifest and then renames again the books renamed on
 * this side. Both ask "did this book's names change between two versions?",
 * read off the engine's parse of each version's text.
 */

/** A text's three names, from a fresh parse. */
export const namesOfText = (text: string, why: string) =>
  Effect.gen(function* () {
    const galley = yield* Galley;
    return namesOf(headerOf(galley.analyzeText(text, why)));
  });

/** A book's three names at `rev`; undefined when that version has no such file. */
export const namesAt = (repo: Repo, rev: string, path: string) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const bytes = yield* Effect.result(git.show(repo, rev, path));
    if (Result.isFailure(bytes)) return undefined;
    const source = decode(bytes.success);
    if (TextResult.isFailure(source)) return undefined;
    return yield* namesOfText(source.success.text, "bookNames.recorded");
  });

/** Whether two sets of names differ; a book that had no version before counts as changed. */
export const renamed = (before: Names | undefined, after: Names): boolean =>
  before === undefined ||
  before.short !== after.short ||
  before.long !== after.long ||
  before.abbr !== after.abbr;
