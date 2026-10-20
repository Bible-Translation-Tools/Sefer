import type { EditorBook } from "@sefer/editor";
import type { BookId } from "@sefer/text/book";
import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
} from "solid-js";

import { t } from "../../i18n";
import { VirtualList, type VirtualSection } from "../primitives";

export interface CardSession {
  readonly editing: boolean;
  readonly gone: boolean;
  readonly goneLabel: string;
  readonly start: () => void;
  readonly done: () => void;
}

export interface CardListProps<T> {
  readonly sections: readonly VirtualSection<T>[];
  readonly card: (item: Accessor<T>, key: string, session: CardSession) => JSX.Element;
  readonly bookOf: (item: T) => BookId;
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  readonly onRetake?: (bookId: BookId) => void;
  readonly whenGone?: (item: T) => T;
  readonly lineLabel: (item: T) => string;
  readonly goneLabel?: string;
  readonly resultsKey?: string;
  readonly onEditing?: (editing: boolean) => void;
  readonly focus?: string;
  readonly ref?: (goTo: (key: string) => void) => void;
  readonly empty?: JSX.Element;
}

interface Pin<T> {
  readonly key: string;
  readonly section: string;
  readonly sectionIndex: number;
  readonly after: string | undefined;
  readonly item: T;
  readonly estimate: number;
}

const LINE = "line:";
const PAUSE_MS = 400;

const insertRow = <T,>(
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

function createRetakeWatch<T>(props: CardListProps<T>) {
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
  return { watch, stopWatching: () => stopWatching?.() };
}

interface GoneLineProps {
  readonly id: string;
  readonly label: string;
  readonly goneLabel: string;
  readonly onDismiss: () => void;
}

function GoneLine(props: GoneLineProps) {
  return (
    <div class="pt-3" data-card-line={props.id}>
      <div class="flex items-center gap-2 rounded-md border border-dashed border-surface-border px-3 py-1.5 text-small text-on-surface-tertiary">
        <strong class="font-medium text-on-surface-secondary">{props.label}</strong>
        <span>{props.goneLabel}</span>
        <button
          type="button"
          class="ms-auto cursor-pointer text-smallest hover:text-on-surface-primary"
          aria-label={t("Dismiss")}
          onClick={() => props.onDismiss()}
        >
          ×
        </button>
      </div>
    </div>
  );
}

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
          insertRow(list, line, { key: `${LINE}${line.key}`, item: line.item, estimate: 40 });
      if (gone)
        insertRow(list, held, {
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

  const { watch, stopWatching } = createRetakeWatch(props);

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
    if (held !== undefined) setLines((was) => [...was, held]);
    stopWatching();
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
          <GoneLine
            id={key.slice(LINE.length)}
            label={props.lineLabel(item())}
            goneLabel={goneLabel()}
            onDismiss={() => setLines((was) => was.filter((line) => `${LINE}${line.key}` !== key))}
          />
        ) : (
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
