import {
  mountReader,
  policyKey,
  type EditorPolicy,
  type Following,
  type MarkedRange,
  type ReaderMount,
} from "@sefer/editor";
import { createEffect, createMemo, createSignal, untrack } from "solid-js";

import type { Analysis } from "#core/galley";

import "@sefer/editor/editor.css";

export interface ExcerptReaderProps {
  readonly analysis: Analysis;
  readonly span: { readonly from: number; readonly to: number };
  readonly policy: EditorPolicy;
  readonly marks: readonly MarkedRange[];
  readonly label: string;
  readonly follow?: Following | undefined;
  readonly onEdit?: (at: number | undefined, point?: { x: number; y: number }) => void;
  readonly direct?: boolean;
  readonly onReveal?: (reveal: (at: number) => void) => void;
}

export function ExcerptReader(props: ExcerptReaderProps) {
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "readerHost",
  });
  const [live, setLive] = createSignal<ReaderMount | undefined>(undefined, {
    name: "readerMount",
  });

  const analysis = createMemo(() => props.analysis, { name: "readerAnalysis" });
  const policy = createMemo(() => props.policy, {
    name: "readerPolicy",
    equals: (a, b) => policyKey(a) === policyKey(b),
  });

  createEffect(
    () => ({ parent: host(), analysis: analysis() }),
    ({ parent, analysis }) => {
      if (parent === undefined) return;
      const mount = mountReader({
        parent,
        analysis,
        range: untrack(() => props.span),
        policy: untrack(policy),
        marks: untrack(() => props.marks),
        surface: "cm-excerpt",
        label: untrack(() => props.label),
        selectable: untrack(() => props.direct) !== true,
      });
      setLive(mount);
      // Returned, not onCleanup: a Solid 2 effect's callback has no owner (NO_OWNER_CLEANUP).
      return () => {
        mount.destroy();
      };
    },
  );

  createEffect(
    () => live(),
    (mount) => {
      if (mount === undefined) return;
      props.onReveal?.((at) => mount.reveal({ from: at }, { scroll: "start" }));
    },
  );

  createEffect(
    () => ({ mount: live(), span: props.span }),
    ({ mount, span }) => mount?.reclip(span),
  );
  createEffect(
    () => ({ mount: live(), policy: policy() }),
    ({ mount, policy }) => mount?.setPolicy(policy),
  );
  createEffect(
    () => ({ mount: live(), marks: props.marks }),
    ({ mount, marks }) => mount?.remark(marks),
  );
  createEffect(
    () => ({ mount: live(), host: props.follow }),
    ({ mount, host }) => {
      if (mount === undefined || host === undefined) return;
      mount.follow(host);
      return () => {
        mount.follow(undefined);
      };
    },
  );

  const editAt = (event: MouseEvent): void => {
    const edit = props.onEdit;
    if (edit === undefined) return;
    const mount = live();
    const point = { x: event.clientX, y: event.clientY };
    edit(mount?.offsetAt(point), point);
  };

  return (
    <div
      class="cm-host"
      ref={setHost}
      tabindex={props.direct === true && props.onEdit !== undefined ? 0 : undefined}
      onDblClick={(event) => {
        if (props.direct !== true) editAt(event);
      }}
      onClick={(event) => {
        if (props.direct === true) editAt(event);
      }}
      onKeyDown={(event) => {
        if (props.direct === true && event.key === "Enter") {
          event.preventDefault();
          props.onEdit?.(undefined);
        }
      }}
    />
  );
}
