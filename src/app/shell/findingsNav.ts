import type { EditorBook } from "@wycliffeassociates/sefer-editor";
import * as TextResult from "@wycliffeassociates/sefer-text/result";
import { Option, Result } from "effect";
import type { Accessor, Setter } from "solid-js";

import { m } from "#app/paraglide/messages";
import type { Finding } from "#core/findings/finding";
import { navigateTarget } from "#core/findings/findings";
import * as Fixes from "#core/fixes/fixes";
import type { Project } from "#core/project/project";

import type { Services } from "../services";
import type { ShellStores } from "../shellStores";
import type { Navigate } from "./types";

export interface FindingsNavDeps {
  readonly services: Services;
  readonly navigate: Navigate;
  readonly stores: ShellStores;
  readonly project: Accessor<Project | undefined>;
  readonly focused: Accessor<EditorBook | undefined>;
  readonly cursor: Accessor<number>;
  readonly setCursor: Setter<number>;
  readonly aim: (bookId: Finding["bookId"], from: number) => void;
  readonly slugFor: (root: string) => string;
  readonly report: (message: string) => void;
}

export const createFindingsNav = ({
  services,
  navigate,
  stores,
  project,
  focused,
  cursor,
  setCursor,
  aim,
  slugFor,
  report,
}: FindingsNavDeps) => {
  const { changed, findings } = stores;

  const finding = (): Finding | undefined => {
    const list = findings();
    return list.length === 0 ? undefined : list[cursor() % list.length];
  };

  const stepFinding = (delta: 1 | -1): void => {
    const list = findings();
    if (list.length === 0) {
      report(m.findings_no_findings());
      return;
    }
    const next = (cursor() + delta + list.length) % list.length;
    setCursor(next);
    const held = list[next];
    if (held === undefined) return;
    const target = navigateTarget(held);
    const held_project = project();
    if (held_project === undefined) return;
    aim(target.bookId, target.from);
    void navigate({
      to: "/project/$slug/book/$book",
      params: { slug: slugFor(held_project.root), book: encodeURIComponent(target.bookId) },
    });
    report(m.findings_code_at_from({ code: held.code, from: target.from }));
  };

  const applyFix = (): void => {
    const held = finding();
    const book = focused();
    if (held === undefined || book === undefined) return;
    const analysis = Option.getOrUndefined(services.projectAnalysis.analysis(held.bookId));
    if (analysis === undefined) {
      report(m.findings_no_analysis_for_book({ book: held.bookId }));
      return;
    }
    const previewed = Fixes.preview(held, book, analysis.analysis);
    if (Result.isFailure(previewed)) {
      report(m.findings_no_fix_reason({ reason: previewed.failure.reason }));
      return;
    }
    const applied = Fixes.applyFix(previewed.success, book);
    report(
      TextResult.isSuccess(applied)
        ? m.findings_applied_label({ label: previewed.success.label })
        : m.findings_refused_by_rule({ rule: applied.failure.rule }),
    );
    changed({ kind: "book.apply", books: [held.bookId] });
  };

  return { finding, stepFinding, applyFix };
};
