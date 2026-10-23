import type { JSX } from "@solidjs/web";
import PencilIcon from "lucide-solid/icons/pencil";
import { Show } from "solid-js";

import { t } from "../../i18n";
import { Badge, Card, cx } from "../primitives";
import { CardActionButton, CardActions, type CardAction } from "./CardAction";

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
  readonly gone?: string | undefined;
  readonly info?: JSX.Element;
  readonly notes?: JSX.Element;
  readonly headerActions?: readonly CardAction[];
  readonly edit: CardEdit;
  readonly open?: CardAction | undefined;
  readonly children: JSX.Element;
  readonly context?: JSX.Element;
  readonly flush?: boolean;
  readonly actions?: readonly CardAction[];
  readonly condensed?: boolean;
  readonly onActivate?: () => void;
  readonly current?: boolean;
  readonly onDblClick?: (event: MouseEvent) => void;
  readonly data?: Readonly<Record<`data-${string}`, string | undefined>>;
}

const editAction = (edit: CardEdit): CardAction | undefined => {
  if (edit.kind === "none") return undefined;
  if (edit.editing)
    return {
      kind: "button",
      id: "done",
      label: t("Done"),
      emphasis: "primary",
      title: t("Stop editing (Escape)"),
      onPress: edit.onDone,
    };
  return {
    kind: "button",
    id: "edit",
    label: t("Edit"),
    icon: PencilIcon,
    emphasis: "tertiary",
    onPress: edit.onEdit,
  };
};

type CardHeaderProps = Pick<
  CardFrameProps,
  "flush" | "title" | "gone" | "info" | "headerActions" | "edit" | "open"
>;

function CardHeader(props: CardHeaderProps) {
  return (
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
  );
}

export function CardFrame(props: CardFrameProps) {
  const editing = (): boolean => props.edit.kind === "edit" && props.edit.editing;
  const hasFooter = (): boolean =>
    props.context !== undefined || (props.actions !== undefined && props.actions.length > 0);
  return (
    <Card
      padded={props.flush === true}
      raised={props.condensed !== true}
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
        "group/card overflow-hidden",
        props.current === true && "outline-2 -outline-offset-1 outline-brand",
        props.flush === true &&
          "transition-[padding,opacity] duration-300 ease-in-out motion-reduce:transition-none",
        props.condensed === true &&
          "cursor-pointer opacity-60 hover:opacity-100 focus-visible:opacity-100",
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
        <CardHeader
          flush={props.flush}
          title={props.title}
          gone={props.gone}
          info={props.info}
          headerActions={props.headerActions}
          edit={props.edit}
          open={props.open}
        />

        <Show when={props.notes}>
          <div data-card-notes class="pt-1">
            {props.notes}
          </div>
        </Show>
      </div>

      {props.children}

      <Show when={hasFooter()}>
        <footer class="flex items-center gap-2 px-3 pt-0.5 pb-1.5">
          <div class="opacity-50 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 motion-reduce:transition-none">
            {props.context}
          </div>
          <div data-card-actions class="ms-auto flex items-center gap-1">
            <CardActions actions={props.actions ?? []} />
          </div>
        </footer>
      </Show>
    </Card>
  );
}
