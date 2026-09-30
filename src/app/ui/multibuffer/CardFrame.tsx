/**
 * The frame every card in Sefer wears — Find, Key terms, Findings, Review —
 * so a card looks and behaves the same wherever it is. Named slots, in the one
 * order every card reads in:
 *
 *  - **Header**, everything ABOUT the place, above one border:
 *    - `title` — the place ("Genesis 3:6"), then `gone` while the card is held
 *      by an edit though its result ended, then `info` (badges: severity,
 *      "markup only", a count);
 *    - on the right, `headerActions`, then Edit or Done (from `edit`), then
 *      `open`;
 *    - `notes` under the title row (Findings' one line per finding).
 *  - **Body** (`children`): the text — read-only until Edit or a double-click,
 *    then the Book itself (`CardEditor`).
 *  - **Footer**: `context` on the left (the steps), `actions` on the right.
 *
 * Every button in a slot is a `CardAction`, drawn here; the frame holds no
 * state. What "editing" means, and what Edit does, is the list's edit session
 * (`CardList`) and the card's own.
 */

import type { JSX } from "@solidjs/web";
import PencilIcon from "lucide-solid/icons/pencil";
import { Show } from "solid-js";

import { t } from "../../i18n";
import { Badge, Card, cx } from "../primitives";
import { CardActionButton, CardActions, type CardAction } from "./CardAction";

/** Whether a card can be edited, and the session when it can. */
export type CardEdit =
  | { readonly kind: "none" }
  | {
      readonly kind: "edit";
      readonly editing: boolean;
      readonly onEdit: () => void;
      readonly onDone: () => void;
    };

export interface CardFrameProps {
  readonly title: JSX.Element;
  /** Held by an edit though the result ended: what to call it ("Resolved"). */
  readonly gone?: string | undefined;
  /** Beside the title: what this place IS — a status, a kind, a count. */
  readonly info?: JSX.Element;
  /** Under the title row, inside the header's border. */
  readonly notes?: JSX.Element;
  /** The header's right, before Edit/Done: decisions, a switch. */
  readonly headerActions?: readonly CardAction[];
  readonly edit: CardEdit;
  /** Last in the header: the way out to the editor or the book. */
  readonly open?: CardAction | undefined;
  /** The body. */
  readonly children: JSX.Element;
  /** The footer's left: the context control. */
  readonly context?: JSX.Element;
  /**
   * The large card — 24px padding and radius — with no rule under the header,
   * and the title a bold heading that starts where the card's text does (a
   * reading's own 12px). Key terms'.
   */
  readonly flush?: boolean;
  /** The footer's right: what this screen lets a reader do about this place. */
  readonly actions?: readonly CardAction[];
  /**
   * One dimmed line while another card is the active one (Key terms'). The
   * whole card is then a button that makes it active — a click, or Enter or
   * Space from the keyboard. The card draws its own regions; this is the
   * frame's part: the look, and the way in.
   */
  readonly condensed?: boolean;
  readonly onActivate?: () => void;
  /** Is this the card the screen's cursor is on? A ring. */
  readonly current?: boolean;
  readonly onDblClick?: (event: MouseEvent) => void;
  /** The card's own data attributes (`data-sid`, `data-diff-card`). */
  readonly data?: Readonly<Record<`data-${string}`, string | undefined>>;
}

/** Edit or Done, as the frame's own actions. */
const editAction = (edit: CardEdit): CardAction | undefined =>
  edit.kind === "none"
    ? undefined
    : edit.editing
      ? {
          kind: "button",
          id: "done",
          label: t("Done"),
          emphasis: "primary",
          title: t("Stop editing (Escape)"),
          onPress: edit.onDone,
        }
      : { kind: "button", id: "edit", label: t("Edit"), icon: PencilIcon, onPress: edit.onEdit };

export function CardFrame(props: CardFrameProps) {
  const editing = (): boolean => props.edit.kind === "edit" && props.edit.editing;
  const hasFooter = (): boolean =>
    props.context !== undefined || (props.actions !== undefined && props.actions.length > 0);
  return (
    <Card
      padded={props.flush === true}
      size={props.flush === true ? "lg" : "md"}
      {...props.data}
      data-editing={editing() ? "true" : undefined}
      data-current={props.current === true ? "true" : undefined}
      data-condensed={props.condensed === true ? "" : undefined}
      role={props.condensed === true ? "button" : undefined}
      tabindex={props.condensed === true ? 0 : undefined}
      aria-label={
        props.condensed === true ? t("Open {place}", { place: String(props.title) }) : undefined
      }
      class={cx(
        "overflow-hidden",
        props.current === true && "ring-1 ring-brand",
        // Padding and opacity ease with the regions' rows, so the card moves
        // as one thing.
        props.flush === true &&
          "transition-[padding,opacity] duration-300 ease-in-out motion-reduce:transition-none",
        props.condensed === true &&
          "cursor-pointer py-4 opacity-60 hover:opacity-100 focus-visible:opacity-100",
      )}
      onClick={() => {
        if (props.condensed === true) props.onActivate?.();
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (props.condensed !== true || event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        props.onActivate?.();
      }}
      onDblClick={(event: MouseEvent) => props.onDblClick?.(event)}
    >
      <div
        class={cx(
          props.flush === true
            ? cx(
                "px-3 transition-[padding] duration-300 ease-in-out motion-reduce:transition-none",
                props.condensed === true ? "pb-1" : "pb-2",
              )
            : "border-b border-surface-border px-3 py-1.5",
        )}
      >
        <header class="flex flex-wrap items-center gap-2">
          <Show
            when={props.flush === true}
            fallback={
              <strong class="text-small font-medium text-on-surface-primary tabular-nums">
                {props.title}
              </strong>
            }
          >
            <h3 class="text-small font-bold text-on-surface-primary tabular-nums">{props.title}</h3>
          </Show>
          <Show when={props.gone}>
            {(said) => (
              <Badge tone="success" data-card-gone="">
                {said()}
              </Badge>
            )}
          </Show>
          {props.info}
          <div class="ms-auto flex shrink-0 items-center gap-1">
            <CardActions actions={props.headerActions ?? []} />
            <Show when={editAction(props.edit)}>
              {(action) => <CardActionButton action={action} />}
            </Show>
            <Show when={props.open}>{(action) => <CardActionButton action={action} />}</Show>
          </div>
        </header>

        <Show when={props.notes}>
          <div data-card-notes class="pt-1">
            {props.notes}
          </div>
        </Show>
      </div>

      {props.children}

      <Show when={hasFooter()}>
        <footer class="flex items-center gap-2 border-t border-surface-border px-3 py-1.5">
          {props.context}
          <div data-card-actions class="ms-auto flex items-center gap-1">
            <CardActions actions={props.actions ?? []} />
          </div>
        </footer>
      </Show>
    </Card>
  );
}
