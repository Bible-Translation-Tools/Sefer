import { Dynamic, type JSX } from "@solidjs/web";
import { For, Show, type Accessor } from "solid-js";

import { Button, IconButton } from "../primitives";

export type CardIcon = (props: { readonly size?: number }) => JSX.Element;

interface ActionBase {
  readonly id: string;
  readonly label: string;
  readonly pressed?: boolean;
  readonly title?: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly class?: string;
}

export type CardAction =
  | (ActionBase & {
      readonly kind: "button";
      readonly icon?: CardIcon;
      readonly emphasis?: "primary" | "secondary" | "tertiary";
    })
  | (ActionBase & { readonly kind: "icon"; readonly icon: CardIcon });

const pressedOf = (action: CardAction): "true" | "false" | undefined => {
  if (action.pressed === undefined) return undefined;
  return action.pressed ? "true" : "false";
};

export function CardActionButton(props: {
  readonly action: Accessor<CardAction>;
  readonly size?: "sm" | "md";
}): JSX.Element {
  const asIcon = () => {
    const action = props.action();
    return action.kind === "icon" ? action : undefined;
  };
  const asButton = () => {
    const action = props.action();
    return action.kind === "button" ? action : undefined;
  };
  return (
    <>
      <Show when={asIcon()}>
        {(action) => (
          <IconButton
            size={props.size ?? "sm"}
            label={action().label}
            icon={<Dynamic component={action().icon} />}
            aria-pressed={pressedOf(action())}
            disabled={action().disabled}
            data-card-action={action().id}
            onClick={() => action().onPress()}
          />
        )}
      </Show>
      <Show when={asButton()}>
        {(action) => (
          <Button
            size={props.size ?? "sm"}
            variant={action().emphasis ?? "secondary"}
            icon={action().icon === undefined ? undefined : <Dynamic component={action().icon} />}
            aria-pressed={pressedOf(action())}
            title={action().title}
            class={action().class}
            disabled={action().disabled}
            data-card-action={action().id}
            onClick={() => action().onPress()}
          >
            {action().label}
          </Button>
        )}
      </Show>
    </>
  );
}

export function CardActions(props: {
  readonly actions: readonly CardAction[];
  readonly size?: "sm" | "md";
}): JSX.Element {
  return (
    <For each={props.actions} keyed={(action) => action.id}>
      {(action) => <CardActionButton action={action} size={props.size} />}
    </For>
  );
}
