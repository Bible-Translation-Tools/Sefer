/**
 * A search result, shown as the chapter it lives in.
 *
 * This is the `ClipWindow` surface (seams §3.9): a second view over the SAME
 * canonical text, clipped to the chapter containing the hit. It is not a copy
 * — every edit it makes goes back through the book's one write path, and the
 * canonical text arriving back moves the window's state without resubmitting
 * it. That is why a result card can be editable at all.
 *
 * `openWindow` answers `null` when the offset is no longer inside the book,
 * which is the ordinary case for a stale hit; the card says so rather than
 * opening on the wrong place.
 */

import { EditorView } from "@codemirror/view";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";

import type { Analysis } from "../../core/galley";
import type { EditorBook } from "../../editor";
import { commandsLayer, openWindow, viewLayer } from "../../editor";
import { t } from "../i18n";
import { Card } from "./primitives";

import "../../editor/editor.css";

export interface ResultCardProps {
  readonly book: EditorBook;
  readonly at: number;
  /** The one parse the window may run while it is a turn behind the book. */
  readonly analyze: (text: string) => Analysis;
}

export function ResultCard(props: ResultCardProps) {
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "resultHost",
  });
  const [missing, setMissing] = createSignal(false, { name: "resultMissing" });

  createEffect(
    () => host(),
    (parent) => {
      if (parent === undefined) return;
      const held = openWindow(props.book, props.at, {
        analyze: props.analyze,
        extensions: [commandsLayer, viewLayer()],
      });
      if (held === null) {
        setMissing(true);
        return;
      }
      let view: EditorView | undefined;
      view = new EditorView({
        state: held.state,
        parent,
        dispatchTransactions: (transactions) => {
          if (view !== undefined) held.fromView(view, transactions);
        },
      });
      const created = view;
      const unbind = held.bindView(created);
      created.dom.classList.add("cm-mode-regular");

      onCleanup(() => {
        unbind();
        created.destroy();
        held.close();
      });
    },
  );

  // The card is the surface every other panel uses; the editor host inside it
  // is full-bleed (`padded={false}`), because CodeMirror owns its own gutters
  // and a padded wrapper would put the text twice as far from the edge as the
  // main editor does.
  return (
    <Show
      when={!missing()}
      fallback={
        <Card class="text-small text-on-surface-tertiary">
          {t("That hit is no longer in the text.")}
        </Card>
      }
    >
      <Card padded={false} class="overflow-hidden">
        <div class="editor-host cm-host max-h-96" ref={setHost} />
      </Card>
    </Show>
  );
}
