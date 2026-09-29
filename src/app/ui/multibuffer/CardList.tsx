/**
 * The multibuffer's list: cards in sections, windowed, with ONE edit session
 * at a time — the pattern every list of places in Sefer
 * shares (Find, Key terms, Findings, Review).
 *
 * A card is a view of a RESULT, and an edit can end the result: fix the error
 * and the finding is gone, change the word and the match is gone, edit a verse
 * back to the other side's text and the change is gone. So this list owns the
 * edit session, the same way on every screen:
 *
 *  - **Pin.** Starting an edit snapshots the card — its key, its section, the
 *    row before it and its item. While the edit lasts, a card missing from new
 *    results is put back at that place and told it is `gone`, so the screen
 *    can say why ("Resolved", "No longer matches"). The editor inside is the
 *    real Book, so the caret and the live parse stay.
 *  - **Re-take.** At each pause in typing (`PAUSE_MS`), and on Done, the
 *    screen is asked to re-take its results (`onRetake`), so "gone" is known
 *    while the reader is still in the card rather than after.
 *  - **One line.** Done releases the pin; a card whose result ended leaves as
 *    one dismissable line where it stood, so the cards below move up by a line,
 *    not by a card. Those lines go when another edit starts or when the results
 *    are of something else (`resultsKey`).
 *
 * Items are the screen's: an excerpt, a diff hunk. The list never reads them
 * beyond the functions it is handed.
 */

import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
} from "solid-js";

import type { BookId } from "#core/book/book";
import type { EditorBook } from "#editor/index";

import { t } from "../../i18n";
import { VirtualList, type VirtualSection } from "../primitives";

/** What a card is told about the edit session. */
export interface CardSession {
  /** This card is the one being edited. */
  readonly editing: boolean;
  /** Being edited, and no longer in the results — held here by the pin. */
  readonly gone: boolean;
  /** What to call that ("Resolved"), for the card's header. */
  readonly goneLabel: string;
  readonly start: () => void;
  readonly done: () => void;
}

export interface CardListProps<T> {
  readonly sections: readonly VirtualSection<T>[];
  readonly card: (item: Accessor<T>, key: string, session: CardSession) => JSX.Element;
  /** The book a card's edits land in: its edits are what the re-take waits for. */
  readonly bookOf: (item: T) => BookId;
  /** Plain → Instantiated, for the book being edited. */
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  /**
   * Re-take the results for the book being edited: at each pause in typing,
   * and when an edit ends. That book only — every other book's results stand.
   */
  readonly onRetake?: (bookId: BookId) => void;
  /** A card held by the pin after its result ended — its stale marks cleared. */
  readonly whenGone?: (item: T) => T;
  /** The one-line row's title. */
  readonly lineLabel: (item: T) => string;
  /** "Resolved", "No longer matches". */
  readonly goneLabel?: string;
  /** What the results are OF; when it changes, the one-line rows go. */
  readonly resultsKey?: string;
  /**
   * Whether a card is being edited. A screen that swaps the list for an empty
   * state when the results run out must not while this is true: the edit that
   * ended the last result is still under way in the card it ended.
   */
  readonly onEditing?: (editing: boolean) => void;
  readonly focus?: string;
  readonly ref?: (goTo: (key: string) => void) => void;
  readonly empty?: JSX.Element;
}

/** The snapshot an edit takes of its card. */
interface Pin<T> {
  readonly key: string;
  readonly section: string;
  readonly sectionIndex: number;
  readonly after: string | undefined;
  readonly item: T;
  readonly estimate: number;
}

const LINE = "line:";
/** A pause in typing long enough to re-take the results. */
const PAUSE_MS = 400;

export function CardList<T>(props: CardListProps<T>) {
  const [editing, setEditing] = createSignal<string | undefined>(undefined, {
    name: "cardEditing",
  });
  const [pin, setPin] = createSignal<Pin<T> | undefined>(undefined, { name: "cardPin" });
  const [lines, setLines] = createSignal<readonly Pin<T>[]>([], { name: "cardLines" });

  const keys = createMemo(
    () => new Set(props.sections.flatMap((section) => section.rows.map((row) => row.key))),
    { name: "cardKeys" },
  );
  const pinGone = (): boolean => {
    const held = pin();
    return held !== undefined && !keys().has(held.key);
  };
  const goneLabel = (): string => props.goneLabel ?? t("No longer in the results");

  /** One row back after `after` in section `key`, making the section if it went. */
  const insert = (
    list: VirtualSection<T>[],
    at: Pin<T>,
    row: VirtualSection<T>["rows"][number],
  ): void => {
    const index = list.findIndex((section) => section.key === at.section);
    if (index < 0) {
      list.splice(Math.min(at.sectionIndex, list.length), 0, { key: at.section, rows: [row] });
      return;
    }
    const section = list[index];
    if (section === undefined) return;
    const rows = [...section.rows];
    const before = at.after === undefined ? -1 : rows.findIndex((entry) => entry.key === at.after);
    rows.splice(before + 1, 0, row);
    list[index] = { key: section.key, rows };
  };

  const shown = createMemo(
    (): readonly VirtualSection<T>[] => {
      const held = pin();
      const left = lines();
      const gone = held !== undefined && pinGone();
      if (!gone && left.length === 0) return props.sections;
      const list = [...props.sections];
      const present = keys();
      for (const line of left)
        if (!present.has(line.key))
          insert(list, line, { key: `${LINE}${line.key}`, item: line.item, estimate: 40 });
      if (gone)
        insert(list, held, {
          key: held.key,
          item: props.whenGone?.(held.item) ?? held.item,
          estimate: held.estimate,
        });
      return list;
    },
    { name: "cardShown" },
  );

  createEffect(
    () => props.resultsKey,
    () => {
      if (untrack(lines).length > 0) setLines([]);
    },
  );

  createEffect(
    () => editing() !== undefined,
    (now) => {
      props.onEditing?.(now);
    },
  );

  // --- the re-take, while an edit lasts -------------------------------------

  let stopWatching: (() => void) | undefined;
  const watch = (bookId: BookId): void => {
    stopWatching?.();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: (() => void) | undefined;
    let live = true;
    void props.seat(bookId).then((book) => {
      if (!live || book === undefined) return;
      stop = book.changes(() => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => props.onRetake?.(bookId), PAUSE_MS);
      });
    });
    stopWatching = () => {
      live = false;
      if (timer !== undefined) clearTimeout(timer);
      stop?.();
      stopWatching = undefined;
    };
  };
  onCleanup(() => stopWatching?.());

  const start = (key: string, item: T): void => {
    if (untrack(editing) === key) return;
    for (const [sectionIndex, section] of props.sections.entries()) {
      const at = section.rows.findIndex((row) => row.key === key);
      if (at < 0) continue;
      setPin({
        key,
        section: section.key,
        sectionIndex,
        after: section.rows[at - 1]?.key,
        item,
        estimate: section.rows[at]?.estimate ?? 120,
      });
      break;
    }
    setLines([]);
    setEditing(key);
    watch(props.bookOf(item));
  };

  const done = (): void => {
    const held = untrack(pin);
    // Left for EVERY released card and drawn only while its key is missing: a
    // screen that re-takes on Done learns "gone" only after this.
    if (held !== undefined) setLines((was) => [...was, held]);
    stopWatching?.();
    setPin(undefined);
    setEditing(undefined);
    if (held !== undefined) props.onRetake?.(props.bookOf(held.item));
  };

  return (
    <VirtualList<T>
      sections={shown()}
      pinned={editing()}
      focus={props.focus}
      ref={props.ref}
      empty={props.empty}
      row={(item, key) =>
        key.startsWith(LINE) ? (
          <div class="pt-3" data-card-line={key.slice(LINE.length)}>
            <div class="flex items-center gap-2 rounded-md border border-dashed border-surface-border px-3 py-1.5 text-small text-on-surface-tertiary">
              <strong class="font-medium text-on-surface-secondary">
                {props.lineLabel(item())}
              </strong>
              <span>{goneLabel()}</span>
              <button
                type="button"
                class="ms-auto cursor-pointer text-smallest hover:text-on-surface-primary"
                aria-label={t("Dismiss")}
                onClick={() =>
                  setLines((was) => was.filter((line) => `${LINE}${line.key}` !== key))
                }
              >
                ×
              </button>
            </div>
          </div>
        ) : (
          // The gap is padding INSIDE the measured row: the virtualizer
          // positions rows by their measured height, and a margin is outside it.
          <div class="pt-3">
            {props.card(item, key, {
              get editing() {
                return editing() === key;
              },
              get gone() {
                return editing() === key && pinGone();
              },
              get goneLabel() {
                return goneLabel();
              },
              start: () => start(key, untrack(item)),
              done,
            })}
          </div>
        )
      }
    />
  );
}
