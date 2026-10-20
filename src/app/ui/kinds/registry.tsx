import type { JSX } from "@solidjs/web";
import { Cause, Exit } from "effect";
import Library from "lucide-solid/icons/library";
import { Show, createEffect, createSignal } from "solid-js";

import type { OpenHandle, Unavailable } from "#core/resources/kinds/handle";
import type { Resource, Role } from "#core/resources/library";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { DelayedSpinner, EmptyState } from "../primitives";
import { ReferenceCard } from "../workspace/ReferenceCard";
import { ReferencePane } from "../workspace/ReferencePane";
import { NotesPane } from "./NotesPane";

const useHandle = (resource: () => Resource) => {
  const shell = useShell();
  const [opened, setOpened] = createSignal<Exit.Exit<OpenHandle, Unavailable> | undefined>(
    undefined,
    { name: "resourceHandle" },
  );
  createEffect(
    () => resource(),
    (held) => {
      setOpened(undefined);
      let gone = false;
      void shell.resources.open(held).then((exit) => {
        if (!gone) setOpened(() => exit);
      });
      return () => {
        gone = true;
      };
    },
  );
  return opened;
};

const NotShown = (props: { readonly resource: Resource; readonly reason: string }) => (
  <EmptyState
    icon={<Library size={22} />}
    title={t("Sefer cannot show {title} yet", { title: props.resource.title })}
    description={props.reason}
  />
);

const byKind = (
  opened: OpenHandle,
  draw: {
    readonly usfm: () => JSX.Element;
    readonly tn: (handle: Extract<OpenHandle, { content: "tn" }>["handle"]) => JSX.Element;
    readonly unsupported: () => JSX.Element;
  },
): JSX.Element => {
  switch (opened.content) {
    case "usfm":
      return draw.usfm();
    case "tn":
      return draw.tn(opened.handle);
    case "tq":
    case "tw":
    case "macula-greek":
    case "macula-hebrew":
      return draw.unsupported();
  }
};

export interface ResourcePaneProps {
  readonly resource: Resource;
  readonly role: Role;
  readonly bookId: string;
  readonly clip: () => number | null;
}

export function ResourcePane(props: ResourcePaneProps) {
  const opened = useHandle(() => props.resource);
  const body = (): JSX.Element => {
    const exit = opened();
    if (exit === undefined) return <DelayedSpinner />;
    if (Exit.isFailure(exit)) {
      const reason = exit.cause.reasons.find(Cause.isFailReason);
      return (
        <NotShown
          resource={props.resource}
          reason={reason?.error.description ?? t("It could not be opened.")}
        />
      );
    }
    return byKind(exit.value, {
      usfm: () => (
        <ReferencePane
          bare
          resource={props.resource}
          role={props.role}
          bookId={props.bookId}
          clip={props.clip}
        />
      ),
      tn: (handle) => <NotesPane resource={props.resource} handle={handle} />,
      unsupported: () => (
        <NotShown resource={props.resource} reason={t("There is no reader for it yet.")} />
      ),
    });
  };
  return <>{body()}</>;
}

export interface ResourceCardProps {
  readonly resource: Resource;
  readonly bookId: string;
  readonly language: string;
  readonly onOpen: () => void;
}

export function ResourceCard(props: ResourceCardProps) {
  return (
    <Show
      when={props.resource.content !== "usfm"}
      fallback={
        <ReferenceCard
          resource={props.resource}
          bookId={props.bookId}
          language={props.language}
          onOpen={props.onOpen}
        />
      }
    >
      <button
        type="button"
        data-testid={`reference-card-${props.resource.id}`}
        class="flex w-full cursor-pointer flex-col gap-1 rounded-2xl bg-surface-primary p-4.5 text-start transition-colors hover:bg-surface-secondary"
        onClick={() => props.onOpen()}
      >
        <span class="truncate text-h4 font-semibold text-on-surface-primary">{props.language}</span>
        <span class="truncate text-small text-on-surface-secondary">{props.resource.title}</span>
      </button>
    </Show>
  );
}
