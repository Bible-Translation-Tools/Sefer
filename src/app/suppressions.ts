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
  load(root: string): Promise<void>;
  prune(): Promise<void>;
  suppress(finding: Finding, rung: Rung): Promise<boolean>;
  unsuppress(id: string): Promise<boolean>;
  rungOf(finding: Finding): Rung | undefined;
  clear(): void;
}

export const makeSuppressionStore = (options: {
  readonly services: Services;
  readonly changed: (event: ShellEvent) => void;
}): SuppressionStore => {
  const { services, changed } = options;
  let root: string | undefined;
  let held: Suppressions = NO_SUPPRESSIONS;
  let writable = true;

  const apply = (next: Suppressions): void => {
    held = next;
    services.projectAnalysis.setSuppressions(next);
  };

  let writing: Promise<void> = Promise.resolve();
  const save = async (next: Suppressions): Promise<boolean> => {
    if (root === undefined || !writable) return false;
    const at = root;
    apply(next);
    changed({ kind: "findings.suppress" });
    const text = encodeSuppressions(next);
    writing = writing.then(() =>
      services.run(
        Effect.ignore(writeDeviceFile(services.fileSystem, at, SOUS_SUPPRESSIONS_FILE, text)),
      ),
    );
    await writing;
    return true;
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
      if (id === undefined) return false;
      return save(withSuppression(pruned(held), rung, id, new Date().toISOString()));
    },
    unsuppress: async (id) => {
      const next = withoutSuppression(held, id);
      return next === held ? true : save(pruned(next));
    },
    rungOf: (finding) => {
      const keys = finding.suppression;
      if (keys === undefined) return undefined;
      if (held.here.has(keys.here)) return "here";
      if (keys.everywhere !== undefined && held.everywhere.has(keys.everywhere))
        return "everywhere";
      return undefined;
    },
    clear: () => {
      root = undefined;
      writable = true;
      apply(NO_SUPPRESSIONS);
    },
  };
};
