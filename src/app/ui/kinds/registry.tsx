import type { JSX } from "@solidjs/web";
import { Cause, Exit } from "effect";
import Library from "lucide-solid/icons/library";
import { createEffect, createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";
import type { OpenHandle, Unavailable } from "#core/resources/kinds/handle";
import type { Resource, Role } from "#core/resources/library";

import { useShell } from "../../ProjectContext";
import { DelayedSpinner, EmptyState } from "../primitives";
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
    title={m.kinds_sefer_cannot_show_title_yet({ title: props.resource.title })}
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
  /** `false`: no Follow button (Refine's language panels, a design tweak). */
  readonly followControl?: boolean;
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
          reason={reason?.error.description ?? m.kinds_it_could_not_be_opened()}
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
          followControl={props.followControl}
        />
      ),
      tn: (handle) => <NotesPane resource={props.resource} handle={handle} />,
      unsupported: () => (
        <NotShown resource={props.resource} reason={m.kinds_there_is_no_reader_for()} />
      ),
    });
  };
  return <>{body()}</>;
}
