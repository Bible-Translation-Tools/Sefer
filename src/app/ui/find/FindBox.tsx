import { useNavigate } from "@tanstack/solid-router";
import type { BookEditorMount, EditorBook } from "@wycliffeassociates/sefer-editor";
import type { BookId } from "@wycliffeassociates/sefer-text/book";
import * as TextResult from "@wycliffeassociates/sefer-text/result";
import { Result } from "effect";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import MoreVertical from "lucide-solid/icons/more-vertical";
import X from "lucide-solid/icons/x";
import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import { m } from "#app/paraglide/messages";
import { useShell } from "#app/ProjectContext";
import { createFreshReadings, createReadings, type Readings } from "#core/search/reading";
import * as Search from "#core/search/search";

import { Button, IconButton, Input, toasts } from "../primitives";
import { findBox } from "./findState";

const WIDTH = 360;
const MARGIN = 16;

/** A USFM marker in the query: then the search reads the markup, and the editor shows it. */
const asksForUsfm = (text: string): boolean => /\\\+?[a-z]/i.test(text);

/** One entry in Find's list: a match in a book, in an open source text, or a replacement kept for review. */
interface Item {
  readonly bookId: BookId;
  readonly from: number;
  readonly to: number;
  /** The search hit, for Replace; absent on a kept replacement and in a source text. */
  readonly hit?: Search.Hit;
  /** The source pane's resource, when the match is in its text. */
  readonly source?: string;
  readonly replaced?: boolean;
  /** Chapter × 1000 + verse, for reading order. */
  readonly verse: number;
}

/** Where a match falls in reading order: book, verse, source before translation, offset. */
const rank = (
  item: {
    readonly bookId: BookId;
    readonly verse: number;
    readonly source?: string;
    readonly from: number;
  },
  turns: ReadonlyMap<BookId, number>,
): readonly number[] => [
  turns.get(item.bookId) ?? 0,
  item.verse,
  item.source === undefined ? 1 : 0,
  item.from,
];

const compare = (a: readonly number[], b: readonly number[]): number => {
  for (let at = 0; at < a.length; at += 1) {
    const step = (a[at] ?? 0) - (b[at] ?? 0);
    if (step !== 0) return step;
  }
  return 0;
};

/** Offset → chapter × 1000 + verse, from the text's \\c and \\v markers. */
const verseIndex = (text: string): ((offset: number) => number) => {
  const starts: number[] = [];
  const keys: number[] = [];
  let chapter = 0;
  for (const found of text.matchAll(/\\([cv])\s+(\d+)/g)) {
    const number = Number(found[2]);
    if (found[1] === "c") chapter = number;
    starts.push(found.index);
    keys.push(found[1] === "c" ? chapter * 1000 : chapter * 1000 + number);
  }
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    let key = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((starts[mid] ?? 0) <= offset) {
        key = keys[mid] ?? 0;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return key;
  };
};

const escape = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches in a source text: its words only, or its markup when the query asks for USFM. */
const matchesInText = (
  text: string,
  query: string,
  usfm: boolean,
  readings: Readings,
  id: BookId,
): readonly { from: number; to: number }[] => {
  const pattern = new RegExp(escape(query), "giu");
  const reading = usfm ? undefined : readings.of({ id, text });
  const haystack = reading?.text ?? text;
  const found: { from: number; to: number }[] = [];
  for (const match of haystack.matchAll(pattern)) {
    const from = match.index;
    const to = from + match[0].length;
    if (reading === undefined) {
      found.push({ from, to });
      continue;
    }
    const first = reading.pieces(from, to)[0];
    if (first !== undefined) found.push(first);
  }
  return found;
};

/**
 * Find, the Google Docs way: a small box floating over the editor, every
 * match in the project highlighted where it stands, the current one darker.
 * Project-wide whatever the chapter view, starting from the reader's place.
 * Replace is one match at a time, never all (the product owner's rule).
 */
export function FindBox(props: {
  readonly editor: BookEditorMount;
  readonly book: EditorBook;
  readonly host: HTMLElement;
}) {
  const shell = useShell();
  const navigate = useNavigate();
  const bookId: BookId = untrack(() => props.book.id);
  const readings = createReadings(shell.services.galley);

  // Every edit to this book re-runs the search, so a fixed spelling drops out of the count.
  const [version, setVersion] = createSignal(0, { name: "findBoxVersion" });
  onCleanup(untrack(() => props.book.changes(() => setVersion((held) => held + 1))));

  const order = createMemo(
    () => new Map((shell.project()?.books ?? []).map((book, at) => [book.id, at])),
    { name: "findBoxOrder" },
  );

  const hits = createMemo(
    () => {
      version();
      const project = shell.project();
      const text = findBox.text();
      if (project === undefined || !Search.longEnough(text)) return [];
      const query: Search.Query = { text, caseSensitive: false };
      const found = asksForUsfm(text)
        ? Search.find(project.books, query)
        : Search.findInReading(readings, project.books, query);
      return Result.isSuccess(found) ? found.success : [];
    },
    { name: "findBoxHits" },
  );

  /** The open source text for this book: an English one when there are several. */
  const source = createMemo(
    () => {
      const open = findBox.sources().filter((one) => one.bookId === bookId);
      return open.find((one) => one.language?.toLowerCase().startsWith("en") === true) ?? open[0];
    },
    { name: "findBoxSource" },
  );

  const sourceHits = createMemo(
    () => {
      const held = source();
      const text = findBox.text();
      if (held === undefined || !Search.longEnough(text)) return [];
      return matchesInText(
        held.text,
        text,
        asksForUsfm(text),
        createFreshReadings(shell.services.galley),
        bookId,
      );
    },
    { name: "findBoxSourceHits" },
  );

  /** The verse each offset sits in, per text, for ordering source and target together. */
  const verses = new Map<string, (offset: number) => number>();
  const verseOf = (text: string, offset: number): number => {
    let lookup = verses.get(text);
    if (lookup === undefined) {
      lookup = verseIndex(text);
      if (verses.size > 8) verses.clear();
      verses.set(text, lookup);
    }
    return lookup(offset);
  };
  const textOf = (id: BookId): string => shell.project()?.book(id)?.source().text ?? "";

  /**
   * Every match, in reading order: book by book, and inside the open book
   * verse by verse, the source text's match before the translation's (left
   * to right). Replaced matches stay until the box closes.
   */
  const items = createMemo(
    (): readonly Item[] => {
      version();
      const kept = findBox.replaced();
      const isKept = (bookAt: BookId, from: number): boolean =>
        kept.some((one) => one.bookId === bookAt && one.from === from);
      const found: Item[] = hits()
        .filter((hit) => !isKept(hit.bookId, hit.from))
        .map((hit) => ({ bookId: hit.bookId, from: hit.from, to: hit.to, hit, verse: 0 }));
      for (const one of kept)
        found.push({ bookId: one.bookId, from: one.from, to: one.to, replaced: true, verse: 0 });
      const held = source();
      if (held !== undefined)
        for (const range of sourceHits())
          found.push({ bookId, ...range, source: held.resourceId, verse: 0 });
      const keyed = found.map((item) => ({
        ...item,
        verse: verseOf(
          item.source === undefined ? textOf(item.bookId) : (held?.text ?? ""),
          item.from,
        ),
      }));
      const turns = order();
      return keyed.sort((a, b) => compare(rank(a, turns), rank(b, turns)));
    },
    { name: "findBoxItems" },
  );

  /** The current match: the first at or after the place the reader is on. */
  const index = createMemo(
    () => {
      const list = items();
      if (list.length === 0) return -1;
      const at = findBox.at();
      if (at === undefined) return 0;
      const text = at.source === undefined ? textOf(at.bookId) : (source()?.text ?? "");
      const here = rank({ ...at, verse: verseOf(text, at.from) }, order());
      const turns = order();
      const found = list.findIndex((item) => compare(rank(item, turns), here) >= 0);
      return found < 0 ? 0 : found;
    },
    { name: "findBoxIndex" },
  );

  createEffect(
    () => ({ list: items(), at: index() }),
    ({ list, at }) => {
      const current = list[at];
      const mine = list.filter((item) => item.bookId === bookId && item.source === undefined);
      // The current match's verse stays bright in BOTH texts (only in this book).
      const verse = current?.bookId === bookId ? current.verse : undefined;
      props.editor.setFindMarks({
        ranges: mine,
        active: current === undefined ? -1 : mine.indexOf(current),
        ...(verse === undefined ? {} : { verse }),
      });
      const held = untrack(source);
      if (held === undefined) return;
      const theirs = list.filter((item) => item.source === held.resourceId);
      held.mount.setFindMarks({
        ranges: theirs,
        active: current === undefined ? -1 : theirs.indexOf(current),
        ...(verse === undefined ? {} : { verse }),
      });
    },
  );
  onCleanup(() => {
    props.editor.setFindMarks(null);
    untrack(source)?.mount.setFindMarks(null);
  });

  // Typing: the first match after the reader's place comes into view, in this book only.
  createEffect(
    () => findBox.text(),
    () => {
      const current = untrack(() => items()[index()]);
      if (current?.bookId === bookId && current.source === undefined)
        props.editor.showRange(current.from, current.to);
    },
  );

  // `\p` and the like: the markers are only visible in USFM.
  createEffect(
    () => asksForUsfm(findBox.text()),
    (usfm) => {
      if (usfm && untrack(shell.mode) !== "usfm") shell.setMode("usfm");
    },
  );

  const goTo = (item: Item): void => {
    findBox.setAt({
      bookId: item.bookId,
      from: item.from,
      ...(item.source === undefined ? {} : { source: item.source }),
    });
    if (item.source !== undefined) {
      source()?.mount.showRange(item.from, item.to);
      return;
    }
    if (item.bookId === bookId) {
      props.editor.showRange(item.from, item.to);
      return;
    }
    shell.aim(item.bookId, item.from, item.to, "centre");
    void navigate({
      to: "/project/$slug/book/$book",
      params: { slug: shell.slug(), book: encodeURIComponent(item.bookId) },
    });
  };

  const step = (delta: 1 | -1): void => {
    const list = items();
    if (list.length === 0) return;
    const next = list[(index() + delta + list.length) % list.length];
    if (next !== undefined) goTo(next);
  };

  /** Whether Replace can act on the current match: the book's own, not yet replaced. */
  const replaceable = (): boolean => {
    const current = items()[index()];
    return current?.hit !== undefined;
  };

  const replace = (): void => {
    const current = items()[index()];
    const hit = current?.hit;
    if (current === undefined) return;
    if (hit === undefined) {
      step(1);
      return;
    }
    if (hit.bookId !== bookId) {
      goTo(current);
      return;
    }
    const book = shell.project()?.book(hit.bookId);
    if (book === undefined) return;
    const insert = findBox.replacement();
    const done = Search.replaceInBook(book, [hit], insert);
    if (TextResult.isFailure(done)) {
      toasts.error({ title: m.find_box_replace_refused() });
      return;
    }
    shell.changed({ kind: "book.apply", books: [hit.bookId] });
    // The new words stay in the list, highlighted, so going back shows what changed.
    const shift = insert.length - (hit.to - hit.from);
    findBox.setReplaced((held) => [
      ...held.map((one) =>
        one.bookId === hit.bookId && one.from >= hit.to
          ? { ...one, from: one.from + shift, to: one.to + shift }
          : one,
      ),
      { bookId: hit.bookId, from: hit.from, to: hit.from + insert.length },
    ]);
    // Past the new words, so the next match becomes the current one.
    findBox.setAt({ bookId: hit.bookId, from: hit.from + Math.max(insert.length, 1) });
    // A frame later: the search re-runs on the book's change, not inside this handler.
    requestAnimationFrame(() => {
      const next = untrack(() => items()[index()]);
      if (next !== undefined) goTo(next);
    });
  };

  const close = (): void => {
    const origin = findBox.origin();
    findBox.setOpen(false);
    findBox.setAt(undefined);
    findBox.setReplacing(false);
    findBox.setReplaced([]);
    props.editor.setFindMarks(null);
    source()?.mount.setFindMarks(null);
    if (origin === undefined) return;
    if (origin.bookId === bookId) {
      props.editor.placeCaret(origin.offset);
      props.editor.showRange(origin.offset, origin.offset);
      props.editor.focus();
      return;
    }
    shell.aim(origin.bookId, origin.offset, undefined, "centre");
    void navigate({
      to: "/project/$slug/book/$book",
      params: { slug: shell.slug(), book: encodeURIComponent(origin.bookId) },
    });
  };

  // Where the box floats: the editor's top-right, until the reader drags it.
  const place = (): { x: number; y: number } => {
    const held = findBox.place();
    if (held !== undefined) return held;
    const rect = props.host.getBoundingClientRect();
    return {
      x: Math.max(MARGIN, Math.min(rect.right, window.innerWidth) - WIDTH - MARGIN),
      y: Math.max(MARGIN, rect.top + MARGIN),
    };
  };

  const drag = (event: PointerEvent): void => {
    const target = event.target;
    if (event.button !== 0 || (target instanceof Element && target.closest("button") !== null))
      return;
    const start = place();
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const header = event.currentTarget;
    if (!(header instanceof HTMLElement)) return;
    header.setPointerCapture(event.pointerId);
    const move = (moved: PointerEvent): void => {
      findBox.setPlace({
        x: Math.max(0, Math.min(window.innerWidth - WIDTH, moved.clientX - dx)),
        y: Math.max(0, Math.min(window.innerHeight - 64, moved.clientY - dy)),
      });
    };
    const up = (): void => {
      header.removeEventListener("pointermove", move);
      header.removeEventListener("pointerup", up);
    };
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", up);
  };

  const [input, setInput] = createSignal<HTMLInputElement | undefined>(undefined, {
    name: "findBoxInput",
  });
  createEffect(
    () => ({ field: input(), opened: findBox.opened() }),
    ({ field }) => {
      if (field === undefined) return;
      // At once, so keys typed straight after Cmd+F land here, not in the editor.
      field.focus();
      field.select();
    },
  );

  const count = (): string =>
    items().length === 0 ? "" : m.find_box_count({ at: index() + 1, total: items().length });

  const onKeys = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  return (
    <div
      role="dialog"
      aria-label={findBox.replacing() ? m.find_box_replace_title() : m.find_box_title()}
      data-testid="find-box"
      class="fixed z-40 space-y-3 rounded-[12px] border border-surface-border bg-surface-primary p-4 text-small text-on-surface-primary shadow-large"
      style={{ left: `${place().x}px`, top: `${place().y}px`, width: `${WIDTH}px` }}
      onKeyDown={onKeys}
    >
      <div
        class="-mx-4 -mt-4 flex cursor-grab items-center justify-between px-4 pt-2 active:cursor-grabbing"
        onPointerDown={drag}
      >
        <h2 class="text-h4 font-semibold select-none">
          {findBox.replacing() ? m.find_box_replace_title() : m.find_box_title()}
        </h2>
        <IconButton label={m.find_box_close()} icon={<X />} onClick={close} />
      </div>

      <div class="flex items-center gap-1">
        <div class="relative min-w-0 flex-1">
          <Input
            ref={setInput}
            data-testid="find-box-input"
            wrapperClass="w-full"
            class="pe-20"
            aria-label={m.find_box_title()}
            placeholder={m.find_box_placeholder()}
            value={findBox.text()}
            onInput={(event) => findBox.setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }}
          />
          <span
            data-testid="find-box-count"
            class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-small text-on-surface-secondary tabular-nums"
          >
            {count()}
          </span>
        </div>
        <Show when={!findBox.replacing()}>
          <IconButton label={m.find_box_next()} icon={<ChevronDown />} onClick={() => step(1)} />
          <IconButton label={m.find_box_previous()} icon={<ChevronUp />} onClick={() => step(-1)} />
          <IconButton
            label={m.find_box_replace_title()}
            icon={<MoreVertical />}
            onClick={() => findBox.setReplacing(true)}
          />
        </Show>
      </div>

      <Show when={findBox.replacing()}>
        <label class="flex items-center gap-3">
          <span class="shrink-0 font-semibold">{m.find_box_replace_with()}</span>
          <Input
            data-testid="find-box-replacement"
            wrapperClass="min-w-0 flex-1"
            value={findBox.replacement()}
            onInput={(event) => findBox.setReplacement(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              replace();
            }}
          />
        </label>
        <div class="grid grid-cols-3 gap-2">
          <Button variant="accent" disabled={!replaceable()} onClick={replace}>
            {m.find_box_replace()}
          </Button>
          <Button variant="accent" icon={<ChevronUp />} onClick={() => step(-1)}>
            {m.find_box_previous()}
          </Button>
          <Button variant="primary" icon={<ChevronDown />} onClick={() => step(1)}>
            {m.find_box_next()}
          </Button>
        </div>
      </Show>
    </div>
  );
}
