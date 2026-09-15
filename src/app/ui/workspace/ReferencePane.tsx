/**
 * One bound reference, as a read-only editor over the SAME book the reader
 * has open.
 *
 * This is the second place in the shell that touches CodeMirror, and it is
 * allowed to be for the reason the first one is not: there is no Book here.
 * `BookEditor` owns the one Solid/Book subscription because its text is
 * canonical and every keystroke has to become a receipt. A reference is a
 * string read off another resource's disk — nothing writes it, nothing
 * publishes it, and no Book in this process describes it — so the rule it has
 * to keep is simply that it can never be edited, which
 * `src/editor/recipes/reference.ts` says twice.
 *
 * What the pane adds over the recipe is the shell's half of the wiring:
 *
 *  - the TEXT, from `Library.readBook` — the whole book, because the engine
 *    parses a book and not a passage;
 *  - the MODE, from `shell.mode()`, so Regular/USFM switches both panes at
 *    once and a translator comparing markup sees markup on both sides;
 *  - the PLACE, from the main editor's location watcher, so scrolling the
 *    book scrolls the reference beside it.
 *
 * Sync is CHAPTER-level, and by the chapter's own `\c` number rather than by
 * ordinal: the two texts are different files of the same book, so an ordinal
 * into one chapter table means nothing in the other, and the number a
 * translator reads is the only thing they are guaranteed to agree about.
 * Verse-level sync would need the main editor's CARET, and the shell has no
 * reactive signal for a selection — `book.changes` fires on document changes
 * only. Adding one means a selection listener in `BookEditor`; until that
 * exists this follows the reader's scroll and their clip.
 *
 * A reference that simply has no file for this book is the ordinary case and
 * gets one line, not an empty editor.
 */

import { Effect, Option, Result } from "effect";
import X from "lucide-solid/icons/x";
import {
  Match,
  Show,
  Switch,
  createEffect,
  createRenderEffect,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";

import type { Resource, Role } from "../../../core/resources/library";
import { mountReference, type ReferenceMount } from "../../../editor";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { IconButton } from "../primitives";
import { bookName } from "./books";
import { metadataOf } from "./project";

// The editor's own stylesheet, for the same reason `BookEditor` imports it:
// the pane paints with `usfm-*` classes and a route that never opens a book
// never loads them.
import "../../../editor/editor.css";

export interface ReferencePaneProps {
  readonly resource: Resource;
  readonly role: Role;
  /** The book the reader has open; the reference is asked for the same one. */
  readonly bookId: string;
  /** The chapter NUMBER at the top of the main editor, when it is known. */
  readonly at: () => number | undefined;
  /** The chapter NUMBER the main editor is clipped to, or `null` for whole-book. */
  readonly clip: () => number | null;
  readonly onUnbind: () => void;
}

/** What the pane is showing, once the read has answered. */
type Held =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "text"; readonly text: string };

export function ReferencePane(props: ReferencePaneProps) {
  const shell = useShell();
  const { services } = shell;
  // Read once, and said so: this component is remounted whenever the binding
  // set or the open book changes (see `ReferenceColumn`), so neither of these
  // can move under a mounted view.
  const resourceId = untrack(() => props.resource.id);
  const bookId = untrack(() => props.bookId);

  const [held, setHeld] = createSignal<Held>({ kind: "loading" }, { name: "referenceText" });
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "referenceHost",
  });
  const [mounted, setMounted] = createSignal<ReferenceMount | undefined>(undefined, {
    name: "referenceView",
  });

  // The read. One per pane, started at setup rather than from an effect: its
  // two inputs are constants for this instance's whole life, so an effect
  // would be a dependency list with nothing in it. `onCleanup` here is at the
  // COMPONENT's own owner — which is a real owner, unlike one inside an
  // effect callback — so a pane unbound mid-read writes no signal after it is
  // gone.
  let gone = false;
  onCleanup(() => {
    gone = true;
  });
  void services
    .run(Effect.result(services.library.readBook(resourceId, bookId)))
    .then((outcome) => {
      if (gone) return;
      if (Result.isFailure(outcome)) {
        setHeld({ kind: "failed", reason: outcome.failure.description });
        return;
      }
      const text = Option.getOrUndefined(outcome.success);
      setHeld(text === undefined ? { kind: "missing" } : { kind: "text", text });
    });

  // An effect and not a render effect: CodeMirror measures itself, so the view
  // is built after its parent is in the document.
  createEffect(
    () => ({ parent: host(), text: held() }),
    ({ parent, text }) => {
      if (parent === undefined || text.kind !== "text") return;
      const view = mountReference({
        parent,
        text: text.text,
        // This pane's own memo. One per view, for the reason composition gives
        // each Book one: a shared memo between two documents is a memo that
        // never hits.
        analyze: services.galley.memoize(),
        mode: untrack(() => shell.mode()),
      });
      setMounted(view);
      // RETURNED, not `onCleanup`: a Solid 2 effect's cleanup is its return
      // value, and `onCleanup` inside an effect callback runs outside any
      // owner and never fires (see `BookEditor` for the same note).
      return () => {
        setMounted(undefined);
        view.destroy();
      };
    },
  );

  // The mode follows the main editor through the recipe's compartment. A
  // render effect, like the editor's own: it is a reconfigure and not a
  // measurement.
  createRenderEffect(
    () => ({ view: mounted(), mode: shell.mode() }),
    ({ view, mode }) => {
      view?.setMode(mode);
    },
  );

  // And the place follows the reader: the clip first (it decides what is on
  // screen at all), then the scroll.
  createEffect(
    () => ({ view: mounted(), clip: props.clip(), at: props.at() }),
    ({ view, clip, at }) => {
      if (view === undefined) return;
      view.clipTo(clip);
      if (at !== undefined) view.showChapter(at);
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
      data-reference={props.resource.id}
      data-role={props.role}
      data-mode={shell.mode()}
      data-state={held().kind}
    >
      {/* The header line: whose text this is, and the one way out of it. The
          × unbinds and does not delete — the resource stays registered, and
          every other project's binding to it is untouched. */}
      <div class="flex items-center gap-2 border-b border-surface-border px-3 py-1.5">
        <p class="min-w-0 flex-1 truncate text-smallest text-on-surface-secondary">
          <span class="font-bold text-on-surface-primary">{props.resource.title}</span>
          <Show when={props.resource.language}>{(language) => <span> · {language()}</span>}</Show>
          <span> · {props.role === "source" ? t("Source") : t("Reference")}</span>
        </p>
        <IconButton
          size="sm"
          data-testid={`unbind-${props.resource.id}`}
          label={t("Remove {title}", { title: props.resource.title })}
          tooltipSide="left"
          icon={<X size={14} />}
          onClick={() => props.onUnbind()}
        />
      </div>

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
