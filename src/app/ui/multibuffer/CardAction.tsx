/**
 * Every button on a card, as one contract.
 *
 * A screen says WHAT a card lets the reader do — an action's id, its words,
 * whether it is a toggle and whether it is pressed — and the frame draws it.
 * Nobody hand-builds a card button, so every one is the same size, reads the
 * same when pressed (`aria-pressed`, which `Button` styles), has an accessible
 * name, and answers to one selector: `data-card-action="<id>"`.
 *
 * Two kinds, because an icon without words must say what it does another way:
 * `icon` takes its `label` as the accessible name and tooltip, and must have
 * an icon; `button` shows its words and may lead with an icon.
 */

import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

import { Button, IconButton } from "../primitives";

/** A lucide icon, or anything drawn the same way. */
export type CardIcon = (props: { readonly size?: number }) => JSX.Element;

interface ActionBase {
  /** Stable, for `data-card-action`: "edit", "usfm", "fix:empty-paragraph". */
  readonly id: string;
  /** The words — shown on a `button`, the accessible name of an `icon`. */
  readonly label: string;
  /** A toggle's state. Absent is not a toggle. */
  readonly pressed?: boolean;
  /** A native tooltip, for a button whose words need one ("Stop editing (Escape)"). */
  readonly title?: string;
  readonly onPress: () => void;
}

export type CardAction =
  | (ActionBase & {
      readonly kind: "button";
      readonly icon?: CardIcon;
      /** How loud: primary for the one thing to do now (Done), tertiary for quiet. */
      readonly emphasis?: "primary" | "secondary" | "tertiary";
    })
  | (ActionBase & { readonly kind: "icon"; readonly icon: CardIcon });

const pressedOf = (action: CardAction): "true" | "false" | undefined =>
  action.pressed === undefined ? undefined : action.pressed ? "true" : "false";

/**
 * One action, drawn. A function of one immutable action, not a component: a
 * caller hands a NEW action when anything about it changes (its label, its
 * pressed state), and the `<For>` below re-draws that one.
 */
export const drawAction = (action: CardAction): JSX.Element => {
  if (action.kind === "icon") {
    const Icon = action.icon;
    return (
      <IconButton
        size="sm"
        label={action.label}
        icon={<Icon size={14} />}
        aria-pressed={pressedOf(action)}
        data-card-action={action.id}
        onClick={() => action.onPress()}
      />
    );
  }
  const Icon = action.icon;
  return (
    <Button
      size="sm"
      variant={action.emphasis ?? "secondary"}
      icon={Icon === undefined ? undefined : <Icon size={13} />}
      aria-pressed={pressedOf(action)}
      title={action.title}
      data-card-action={action.id}
      onClick={() => action.onPress()}
    >
      {action.label}
    </Button>
  );
};

/** A run of actions, in order. */
export function CardActions(props: { readonly actions: readonly CardAction[] }): JSX.Element {
  return <For each={props.actions}>{(action) => drawAction(action)}</For>;
}
