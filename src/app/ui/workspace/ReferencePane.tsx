import { mountReference, type PairedRange, type ReferenceMount } from "@sefer/editor";
import type { JSX } from "@solidjs/web";
import { Effect, Fiber, Option, Result, Stream } from "effect";
import X from "lucide-solid/icons/x";
import {
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";

import {
  blockAtOffset,
  equivalentBlock,
  equivalentVerse,
  verseAtOffset,
  type Skeleton,
  type SkeletonRow,
} from "#core/galley";
import type { Attrs } from "#core/observability";
import type { Resource, Role } from "#core/resources/library";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { IconButton } from "../primitives";
import { useAlignedGroup } from "./aligned";
import { bookName } from "./books";
import { FollowToggle } from "./FollowToggle";
import { metadataOf } from "./project";

import "@sefer/editor/editor.css";

export interface ReferencePaneProps {
  readonly resource: Resource;
  readonly role: Role;
  readonly bookId: string;
  readonly clip: () => number | null;
  readonly onUnbind?: () => void;
  /**
   * In place of the title, when the column holds more than one text: the
   * choice of which one this pane shows (one at a time; Will, 2026-10-08).
   */
  readonly title?: JSX.Element;
  /**
   * Drawn straight on the page: no card, no paper, no title line — the
   * column's language picker says whose text it is (Refine's reference text).
   * Follow stays, as the one control in its place (Will, 2026-10-08).
   */
  readonly bare?: boolean;
}

type Held =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "text"; readonly text: string };

const addressOf = (row: {
  readonly sid: string;
  readonly where: string;
  readonly ordinal: number;
}) => `${row.sid}\u0000${row.where}\u0000${row.ordinal}`;

const pairingFacts = (source: Skeleton | undefined, target: Skeleton | undefined): Attrs => {
  if (source === undefined) return { "reference.skeleton": false };
  const facts = {
    "reference.skeleton": true,
    "reference.blocks": source.blocks.length,
    "reference.verses": source.verses.length,
  };
  if (target === undefined) return facts;
  const blocks = new Set(source.blocks.map(addressOf));
  const verses = new Set(source.verses.map((verse) => verse.sid));
  let unpairedBlocks = 0;
  let unpairedEmpty = 0;
  for (const row of target.blocks) {
    if (blocks.has(addressOf(row))) continue;
    unpairedBlocks += 1;
    if (row.empty) unpairedEmpty += 1;
  }
  return {
    ...facts,
    "reference.target_blocks": target.blocks.length,
    "reference.target_verses": target.verses.length,
    "reference.unpaired_blocks": unpairedBlocks,
    "reference.unpaired_empty": unpairedEmpty,
    "reference.unpaired_verses": target.verses.filter((verse) => !verses.has(verse.sid)).length,
  };
};

function pairedRangeAt(
  target: Skeleton,
  source: Skeleton,
  at: number,
  unpairedAt: (block: SkeletonRow) => void,
): PairedRange | undefined {
  const here = blockAtOffset(target.blocks, at);
  if (here?.empty === true) {
    const row = equivalentBlock(source.blocks, here);
    if (row === undefined) unpairedAt(here);
    return row === undefined ? undefined : { from: row.from, to: row.end };
  }

  const verse = verseAtOffset(target, at);
  if (verse !== undefined) {
    const twin = equivalentVerse(source, verse.sid);
    return twin === undefined ? undefined : { from: twin.textFrom, to: twin.textTo };
  }

  if (here === undefined) return undefined;
  const row = equivalentBlock(source.blocks, here);
  return row === undefined ? undefined : { from: row.from, to: row.end };
}

function PaneHeader(props: {
  readonly resource: Resource;
  readonly role: Role;
  readonly title: JSX.Element | undefined;
  readonly following: boolean;
  readonly onToggleFollow: () => void;
  readonly onUnbind: (() => void) | undefined;
}) {
  return (
    <div class="flex items-center gap-2 border-b border-surface-border px-3 py-1.5">
      <p class="min-w-0 flex-1 truncate text-smallest text-on-surface-secondary">
        <Show
          when={props.title}
          fallback={<span class="font-bold text-on-surface-primary">{props.resource.title}</span>}
        >
          {props.title}
        </Show>
        <Show when={props.resource.language}>{(language) => <span> · {language()}</span>}</Show>
        <span> · {props.role === "source" ? t("Source") : t("Reference")}</span>
      </p>

      <FollowToggle
        testId={`follow-${props.resource.id}`}
        following={props.following}
        stopLabel={t("Stop {title} following the book", { title: props.resource.title })}
        startLabel={t("Let {title} follow the book", { title: props.resource.title })}
        onToggle={() => props.onToggleFollow()}
      />
      <Show when={props.onUnbind}>
        {(unbind) => (
          <IconButton
            size="sm"
            data-testid={`unbind-${props.resource.id}`}
            label={t("Remove {title}", { title: props.resource.title })}
            tooltipSide="left"
            icon={<X />}
            onClick={() => unbind()()}
          />
        )}
      </Show>
    </div>
  );
}

export function ReferencePane(props: ReferencePaneProps) {
  const shell = useShell();
  const { services } = shell;
  const resourceId = untrack(() => props.resource.id);
  const bookId = untrack(() => props.bookId);

  const [held, setHeld] = createSignal<Held>({ kind: "loading" }, { name: "referenceText" });
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "referenceHost",
  });
  const [mounted, setMounted] = createSignal<ReferenceMount | undefined>(undefined, {
    name: "referenceView",
  });

  const [following, setFollowing] = createSignal(
    untrack(() => services.settings.get(shellKeys(services.settings).syncReferences)),
    { name: "referenceFollows" },
  );

  // onCleanup in the component body: one inside an effect callback never runs (NO_OWNER_CLEANUP).
  let gone = false;
  onCleanup(() => {
    gone = true;
  });
  const loading = services.composition.observability.operation("reference.load", {
    "book.id": bookId,
    "reference.role": untrack(() => props.role),
  });
  void services
    .run(Effect.result(services.library.readBook(resourceId, bookId)))
    .then((outcome) => {
      if (gone) {
        loading.end("declined", { "reference.outcome": "unbound" });
        return;
      }
      if (Result.isFailure(outcome)) {
        loading.end("failed", {
          "reference.outcome": "failed",
          "reference.reason": outcome.failure.reason,
        });
        setHeld({ kind: "failed", reason: outcome.failure.description });
        return;
      }
      const text = Option.getOrUndefined(outcome.success);
      if (text === undefined) {
        loading.end("passed", { "reference.outcome": "missing" });
        setHeld({ kind: "missing" });
        return;
      }
      const cut = loading.span("reference.skeleton");
      const skeleton = skeletonOf(text);
      cut();
      setSourceSkeleton(skeleton);
      loading.end("passed", {
        "reference.outcome": "text",
        "reference.chars": text.length,
        ...pairingFacts(skeleton, untrack(targetSkeleton)),
      });
      setHeld({ kind: "text", text });
    });

  createEffect(
    () => ({ parent: host(), text: held() }),
    ({ parent, text }) => {
      if (parent === undefined || text.kind !== "text") return;
      const view = mountReference({
        parent,
        text: text.text,
        analyze: services.galley.memoize(),
        mode: untrack(() => shell.mode()),
        pairBlocks: untrack(() => services.settings.get(shellKeys(services.settings).pairBlocks)),
      });
      setMounted(view);
      // Returned, not onCleanup: a Solid 2 effect's callback has no owner (NO_OWNER_CLEANUP).
      return () => {
        setMounted(undefined);
        view.destroy();
      };
    },
  );

  createRenderEffect(
    () => ({ view: mounted(), mode: shell.mode() }),
    ({ view, mode }) => {
      view?.setMode(mode);
    },
  );

  createEffect(
    () => ({ view: mounted(), clip: props.clip() }),
    ({ view, clip }) => {
      view?.clipTo(clip);
    },
  );

  const aligned = useAlignedGroup();
  createEffect(
    () => mounted(),
    (view) => {
      if (view === undefined || aligned === undefined) return;
      return aligned.join({
        editor: view,
        book: props.bookId,
        leads: () => untrack(following),
        follows: () => untrack(following),
      });
    },
  );
  createEffect(
    () => ({ view: mounted(), follow: following() }),
    ({ view, follow }) => {
      if (view !== undefined && follow) aligned?.sync(view);
    },
  );

  const paneId = `sefer.pane.${resourceId}\u0000${bookId}`;

  const skeletonOf = (text: string): Skeleton | undefined => {
    try {
      services.galley.updateReference(paneId, text, true);
      return services.galley.skeleton(paneId);
    } catch {
      return undefined;
    }
  };

  const [sourceSkeleton, setSourceSkeleton] = createSignal<Skeleton | undefined>(undefined, {
    name: "referenceSkeleton",
  });

  onCleanup(() => {
    services.galley.remove(paneId);
  });

  /**
   * The open book's skeleton, refreshed when the book moves.
   *
   * Keyed on the STAMP and not the text: the stamp is what changes per
   * revision, reading it is free, and a memo over a whole book's text would
   * hold a second copy of it alive. ~0.4 ms per edit, which is the budget
   * `overlay.md` sets for exactly this.
   */
  const targetSkeleton = createMemo(
    (): Skeleton | undefined => {
      if (shell.focused() === undefined || shell.stampOf(bookId) === undefined) return undefined;
      try {
        return services.galley.skeleton(bookId);
      } catch {
        return undefined;
      }
    },
    { name: "targetSkeleton" },
  );

  let unpairedLast = "";
  const unpairedAt = (block: SkeletonRow): void => {
    const key = addressOf(block);
    if (key === unpairedLast) return;
    unpairedLast = key;
    services.composition.observability.note("reference.pair", "refused", undefined, {
      "book.id": bookId,
      "reference.role": untrack(() => props.role),
      "reference.sid": block.sid,
      "reference.where": block.where,
      "reference.ordinal": block.ordinal,
    });
  };

  const paired = createMemo(
    (): PairedRange | undefined => {
      const at = shell.caret();
      const target = targetSkeleton();
      const source = sourceSkeleton();
      if (at === undefined || target === undefined || source === undefined) return undefined;

      return pairedRangeAt(target, source, at, unpairedAt);
    },
    { name: "pairedRange" },
  );

  createEffect(
    () => mounted(),
    (view) => {
      if (view === undefined) return;
      const key = shellKeys(services.settings).pairBlocks;
      const fiber = services.runtime.runFork(
        Stream.runForEach(services.settings.changes(key), (on: boolean) =>
          Effect.sync(() => {
            view.pairBlocks(on);
          }),
        ),
      );
      return () => {
        Effect.runFork(Fiber.interrupt(fiber));
      };
    },
  );

  const pairState = (): string => {
    if (shell.caret() === undefined) return "no-caret";
    const target = targetSkeleton();
    if (target === undefined) return "no-target";
    if (sourceSkeleton() === undefined) return "no-source";
    const at = shell.caret();
    const verse = at === undefined ? undefined : verseAtOffset(target, at);
    const row = paired();
    if (row === undefined) return verse === undefined ? "no-verse-here" : `unpaired:${verse.sid}`;
    return verse === undefined ? "block" : verse.sid;
  };

  createEffect(
    () => ({ view: mounted(), row: paired() }),
    ({ view, row }) => {
      view?.showPair(row ?? null, following());
    },
  );

  const missing = (): string =>
    t("{title} has no {book}", {
      title: props.resource.title,
      book: bookName(bookId, metadataOf(shell.project())),
    });

  return (
    <div
      class="editor-host"
      data-bare={props.bare === true ? "" : undefined}
      data-reference={props.resource.id}
      data-role={props.role}
      data-mode={shell.mode()}
      data-state={held().kind}
      data-pair={pairState()}
    >
      <Show
        when={props.bare !== true}
        fallback={
          <div class="flex justify-end">
            <FollowToggle
              testId={`follow-${props.resource.id}`}
              following={following()}
              stopLabel={t("Stop {title} following the book", { title: props.resource.title })}
              startLabel={t("Let {title} follow the book", { title: props.resource.title })}
              onToggle={() => setFollowing((on) => !on)}
            />
          </div>
        }
      >
        <PaneHeader
          resource={props.resource}
          role={props.role}
          title={props.title}
          following={following()}
          onToggleFollow={() => setFollowing((on) => !on)}
          onUnbind={props.onUnbind}
        />
      </Show>

      <Switch>
        <Match when={held().kind === "loading"}>
          <p class="px-3 py-2 text-smallest text-on-surface-tertiary">{t("Looking…")}</p>
        </Match>
        <Match when={held().kind === "missing"}>
          <p data-testid="reference-missing" class="px-3 py-2 text-small text-on-surface-tertiary">
            {missing()}
          </p>
        </Match>
        <Match when={held().kind === "failed"}>
          <p class="px-3 py-2 text-small text-on-surface-tertiary">
            {t("Could not read {title}.", { title: props.resource.title })}
          </p>
        </Match>
        <Match when={held().kind === "text"}>
          <div class="cm-host" data-testid={`reference-host-${props.resource.id}`} ref={setHost} />
        </Match>
      </Switch>
    </div>
  );
}
