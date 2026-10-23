import type { BookId } from "@sefer/text/book";
import type { UseNavigateResult } from "@tanstack/solid-router";

import type { Project } from "#core/project/project";

export type RevealAt = "top" | "centre";

export interface Reveal {
  readonly bookId: BookId;
  readonly from: number;
  readonly to?: number;
  readonly at?: RevealAt;
}

export type Navigate = UseNavigateResult<string>;

export interface RecentProject {
  readonly root: string;
  readonly name: string;
  readonly at: string;
}

export interface LiveProject {
  readonly get: () => Project | undefined;
  readonly set: (project: Project | undefined) => void;
}
