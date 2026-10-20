import {
  mountCard,
  policyKey,
  type CardMount,
  type DiffPaint,
  type EditorBook,
  type EditorPolicy,
  type MarkedRange,
} from "@sefer/editor";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { Analysis } from "#core/galley";

import "@sefer/editor/editor.css";

export interface CardEditorProps {
  readonly book: EditorBook;
  readonly range: { readonly from: number; readonly to: number };
  readonly policy: EditorPolicy;
  readonly surface?: string;
  readonly analyze: (text: string) => Analysis;
  readonly marks?: readonly MarkedRange[];
  readonly at?: number | undefined;
  readonly point?: { x: number; y: number } | undefined;
  readonly select?: { readonly from: number; readonly to: number } | undefined;
  readonly diff?: DiffPaint;
  readonly session?: boolean;
  readonly reclip?: boolean;
  readonly label: string;
  readonly onEditor?: (card: CardMount | undefined) => void;
  readonly onDone: () => void;
}

export function CardEditor(props: CardEditorProps) {
  const policy = createMemo(() => props.policy, {
    name: "cardPolicy",
    equals: (a, b) => policyKey(a) === policyKey(b),
  });
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "cardEditorHost",
  });
  const [live, setLive] = createSignal<CardMount | undefined>(undefined, {
    name: "cardEditorLive",
  });

  createEffect(
    () => host(),
    (parent) => {
      if (parent === undefined) return;
      const diff = untrack(() => props.diff);
      const card = untrack(() =>
        mountCard({
          parent,
          book: props.book,
          range: props.range,
          policy: policy(),
          surface: props.surface ?? "cm-excerpt",
          analyze: props.analyze,
          marks: props.marks ?? [],
          ...(diff === undefined ? {} : { diff }),
          session: props.session === true,
          caret: { at: props.at, point: props.point, select: props.select },
          onEscape: () => props.onDone(),
          label: props.label,
        }),
      );
      setLive(card);
      untrack(() => props.onEditor)?.(card);

      // Returned, not onCleanup: a Solid 2 effect's callback has no owner (NO_OWNER_CLEANUP).
      return () => {
        untrack(() => props.onEditor)?.(undefined);
        card.destroy();
      };
    },
  );

  createEffect(
    () => ({ card: live(), next: policy() }),
    ({ card, next }) => card?.setPolicy(next),
  );

  createEffect(
    () => ({ card: live(), range: props.range }),
    ({ card, range }) => {
      if (card === undefined || untrack(() => props.reclip) === false) return;
      card.setRange(range);
    },
  );

  createEffect(
    () => ({ card: live(), marks: props.marks }),
    ({ card, marks }) => {
      if (card === undefined || marks === undefined) return;
      card.setMarks(marks);
    },
  );

  return <div class="cm-host cm-editing" data-card-editor ref={setHost} />;
}
