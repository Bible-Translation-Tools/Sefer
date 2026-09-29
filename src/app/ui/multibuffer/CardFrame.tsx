/**
 * The frame every card in Sefer wears — Find, Key terms, Findings, Review —
 * so a card looks and behaves the same wherever it is:
 *
 *  - **Header:** the place (one small title row), the `gone` badge while the
 *    card is held by an edit though its result ended, the screen's own badges,
 *    then on the right the screen's header actions, Edit or Done, and open.
 *  - **Notes:** an optional block under the header (Findings' one line per
 *    finding).
 *  - **Body:** the text — read-only until Edit or a double-click, then the
 *    Book itself (`CardEditor`).
 *  - **Footer:** an optional control on the left (context steps) and the
 *    screen's actions on the right.
 *
 * The frame holds no state: what "editing" means, and what Edit does, is the
 * list's edit session (`CardList`) and the card's own.
 */

import type { JSX } from "@solidjs/web";
import PencilIcon from "lucide-solid/icons/pencil";
import { Show } from "solid-js";

import { t } from "../../i18n";
import { Badge, Button, Card, cx } from "../primitives";

export interface CardFrameProps {
  readonly label: JSX.Element;
  /** Held by an edit though the result ended: what to call it ("Resolved"). */
  readonly gone?: string | undefined;
  /** Beside the label: a count, a status, a kind. */
  readonly badges?: JSX.Element;
  /** The header's right-hand slot, before Edit/Done: decisions, say. */
  readonly headerActions?: JSX.Element;
  /** Whether this card can be edited at all. Absent is yes. */
  readonly editable?: boolean;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onDone: () => void;
  /** The open control (to the editor, to the book), when the screen has one. */
  readonly open?: JSX.Element;
  readonly notes?: JSX.Element;
  readonly children: JSX.Element;
  /** The footer's left: the context control. */
  readonly control?: JSX.Element;
  /** The footer's right: whatever this screen lets a reader do here. */
  readonly actions?: JSX.Element;
  /** Is this the card the screen's cursor is on? A ring. */
  readonly current?: boolean;
  readonly onDblClick?: (event: MouseEvent) => void;
  /** The card's own data attributes (`data-sid`, `data-diff-card`). */
  readonly data?: Readonly<Record<`data-${string}`, string | undefined>>;
}

export function CardFrame(props: CardFrameProps) {
  return (
    <Card
      padded={false}
      {...props.data}
      data-editing={props.editing ? "true" : undefined}
      data-current={props.current === true ? "true" : undefined}
      class={cx("overflow-hidden", props.current === true && "ring-1 ring-brand")}
      onDblClick={(event: MouseEvent) => props.onDblClick?.(event)}
    >
      <header class="flex flex-wrap items-center gap-2 border-b border-surface-border px-3 py-1.5">
        <strong class="text-small font-medium text-on-surface-primary tabular-nums">
          {props.label}
        </strong>
        <Show when={props.gone}>
          {(said) => (
            <Badge tone="success" data-card-gone="">
              {said()}
            </Badge>
          )}
        </Show>
        {props.badges}
        <div class="ms-auto flex shrink-0 items-center gap-1">
          {props.headerActions}
          <Show when={props.editable !== false}>
            <Show
              when={props.editing}
              fallback={
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<PencilIcon size={13} />}
                  data-card-edit=""
                  onClick={() => props.onEdit()}
                >
                  {t("Edit")}
                </Button>
              }
            >
              <Button
                size="sm"
                variant="primary"
                data-card-done=""
                title={t("Stop editing (Escape)")}
                onClick={() => props.onDone()}
              >
                {t("Done")}
              </Button>
            </Show>
          </Show>
          {props.open}
        </div>
      </header>

      <Show when={props.notes}>
        <div data-card-notes class="px-3 pt-1.5">
          {props.notes}
        </div>
      </Show>

      {props.children}

      <Show when={props.control !== undefined || props.actions !== undefined}>
        <footer class="flex items-center gap-2 border-t border-surface-border px-3 py-1.5">
          {props.control}
          <Show when={props.actions}>
            <div data-card-actions class="ms-auto flex items-center gap-1">
              {props.actions}
            </div>
          </Show>
        </footer>
      </Show>
    </Card>
  );
}
