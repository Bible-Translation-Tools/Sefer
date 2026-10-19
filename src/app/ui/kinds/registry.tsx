/**
 * The renderer registry: the second and last place a `ContentKind` is
 * narrowed (the first is `recognize`, `core/resources/kinds/content.ts`).
 * Rendering is the one job where knowing what a thing is is the point — a
 * note is drawn as a note, Macula's words right to left with their parsing on
 * hover — so this is where the switch lives, and nowhere between.
 *
 * A screen asks for `ResourcePane` or `ResourceCard` with a `Resource`; this
 * opens the handle through the shell (`shell.resources`, which owns its
 * lifetime) and hands the kind's own component the handle typed for its kind.
 * The pane speaks to the rest of the app only in Address, through
 * `shell.place`.
 *
 * Adding a kind: a row in the kind table (`app/kinds/table.ts`), a case here.
 * TypeScript refuses a `ContentKind` either one forgets.
 */

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

/** The handle on `resource`, opened through the shell; `undefined` while it opens. */
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

/** What a kind with nothing to draw (yet) says, the same everywhere. */
const NotShown = (props: { readonly resource: Resource; readonly reason: string }) => (
  <EmptyState
    icon={<Library size={22} />}
    title={t("Sefer cannot show {title} yet", { title: props.resource.title })}
    description={props.reason}
  />
);

/** Switches on the open handle's kind; one case per `ContentKind`. */
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
  /** The book the reader has open. */
  readonly bookId: string;
  /** The chapter NUMBER the editor is clipped to, or `null`. */
  readonly clip: () => number | null;
  /** `false`: no Follow button (Refine's language panels, a design tweak). */
  readonly followControl?: boolean;
}

/** The pane the reference column shows for one resource, whatever it holds. */
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
          followControl={props.followControl}
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

/**
 * One resource folded to a card. Scripture shows its opening verses
 * (`ReferenceCard`); a kind with no verses to show names itself and what it
 * is, which is all a folded card is for.
 */
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
