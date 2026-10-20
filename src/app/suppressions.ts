/**
 * The open project's proofreading suppressions: read when the project opens,
 * applied to `ProjectAnalysis`, written on every change, and pruned of
 * entries whose text is gone.
 *
 *   Fine here       suppress(finding, "here")         this text at this place
 *   Always allow    suppress(finding, "everywhere")   this exact claim, anywhere
 *   take one back   unsuppress(id)
 *
 * The file and its keys are core's (`#core/findings/suppressions`); this is
 * only the open project's copy and the doors to change it.
 */

import { Effect } from "effect";

import type { Finding } from "#core/findings/finding";
import {
  decodeSuppressions,
  encodeSuppressions,
  isEmpty,
  NO_SUPPRESSIONS,
  SOUS_SUPPRESSIONS_FILE,
  staleHere,
  withoutSuppression,
  withSuppression,
  type Rung,
  type Suppressions,
} from "#core/findings/suppressions";
import { readDeviceFile, writeDeviceFile } from "#core/project/deviceFile";

import type { Services } from "./services";
import type { ShellEvent } from "./shellEvent";

export interface SuppressionStore {
  /** Reads the project's file and applies it. Before `attach`, so the first publication is already filtered. */
  load(root: string): Promise<void>;
  /** Drops entries whose text is gone, once the project's books are analysed. */
  prune(): Promise<void>;
  suppress(finding: Finding, rung: Rung): Promise<void>;
  unsuppress(id: string): Promise<void>;
  /** Back to none, when the project closes. */
  clear(): void;
}

export const makeSuppressionStore = (options: {
  readonly services: Services;
  readonly changed: (event: ShellEvent) => void;
}): SuppressionStore => {
  const { services, changed } = options;
  let root: string | undefined;
  let held: Suppressions = NO_SUPPRESSIONS;
  // A file this build could not read is left alone: saving over it would erase it.
  let writable = true;

  const apply = (next: Suppressions): void => {
    held = next;
    services.projectAnalysis.setSuppressions(next);
  };

  const save = async (next: Suppressions): Promise<void> => {
    if (root === undefined || !writable) return;
    const at = root;
    apply(next);
    changed({ kind: "findings.suppress" });
    await services.run(
      Effect.ignore(
        writeDeviceFile(services.fileSystem, at, SOUS_SUPPRESSIONS_FILE, encodeSuppressions(next)),
      ),
    );
  };

  const pruned = (from: Suppressions): Suppressions =>
    staleHere(from, (bookId) => services.projectAnalysis.versesIn(bookId)).reduce(
      withoutSuppression,
      from,
    );

  return {
    load: async (opened) => {
      root = opened;
      const text = await services.run(
        readDeviceFile(services.fileSystem, opened, SOUS_SUPPRESSIONS_FILE),
      );
      const decoded =
        text === "" ? NO_SUPPRESSIONS : text === undefined ? undefined : decodeSuppressions(text);
      writable = decoded !== undefined;
      apply(decoded ?? NO_SUPPRESSIONS);
    },
    prune: async () => {
      if (isEmpty(held)) return;
      const next = pruned(held);
      if (next !== held) await save(next);
    },
    suppress: async (finding, rung) => {
      const keys = finding.suppression;
      const id = rung === "here" ? keys?.here : keys?.everywhere;
      if (id === undefined) return;
      await save(withSuppression(pruned(held), rung, id, new Date().toISOString()));
    },
    unsuppress: async (id) => {
      const next = withoutSuppression(held, id);
      if (next !== held) await save(pruned(next));
    },
    clear: () => {
      root = undefined;
      writable = true;
      apply(NO_SUPPRESSIONS);
    },
  };
};
