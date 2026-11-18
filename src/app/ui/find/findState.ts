import type { ReferenceMount } from "@wycliffeassociates/sefer-editor";
import type { BookId } from "@wycliffeassociates/sefer-text/book";
import { createRoot, createSignal } from "solid-js";

/**
 * The floating Find box's state: one per window, so the right-click menu,
 * Cmd+F and the box itself (which remounts with each book) share it. Design
 * prototype; when it graduates this belongs on the shell.
 */
export interface FindOrigin {
  readonly bookId: BookId;
  readonly offset: number;
}

/** An open source (or reference) pane Find also searches: its text, read-only. */
export interface FindSource {
  readonly resourceId: string;
  readonly bookId: string;
  readonly text: string;
  readonly language: string | undefined;
  readonly mount: ReferenceMount;
}

/** A match Replace changed: kept in the list, highlighted, until the box closes. */
interface Replaced {
  readonly bookId: BookId;
  readonly from: number;
  readonly to: number;
}

const store = createRoot(() => {
  const [sources, setSources] = createSignal<readonly FindSource[]>([], {
    name: "findBoxSources",
  });
  const [replaced, setReplaced] = createSignal<readonly Replaced[]>([], {
    name: "findBoxReplaced",
  });
  const [open, setOpen] = createSignal(false, { name: "findBoxOpen" });
  const [text, setText] = createSignal("", { name: "findBoxText" });
  const [replacing, setReplacing] = createSignal(false, { name: "findBoxReplacing" });
  const [replacement, setReplacement] = createSignal("", { name: "findBoxReplacement" });
  const [origin, setOrigin] = createSignal<FindOrigin | undefined>(undefined, {
    name: "findBoxOrigin",
  });
  const [place, setPlace] = createSignal<{ x: number; y: number } | undefined>(undefined, {
    name: "findBoxPlace",
  });
  /**
   * Where the current match is: the first match at or after it is the current
   * one. `source` set: in that open source pane's text, not the book's.
   */
  const [at, setAt] = createSignal<{ bookId: BookId; from: number; source?: string } | undefined>(
    undefined,
    {
      name: "findBoxAt",
    },
  );
  /** Bumped on every opening, so an already open box re-focuses and re-seeds. */
  const [opened, setOpened] = createSignal(0, { name: "findBoxOpened" });
  return {
    sources,
    setSources,
    replaced,
    setReplaced,
    open,
    setOpen,
    text,
    setText,
    replacing,
    setReplacing,
    replacement,
    setReplacement,
    origin,
    setOrigin,
    place,
    setPlace,
    at,
    setAt,
    opened,
    setOpened,
  };
});

export const findBox = store;

/** Opens the box, seeded with `seed` when there is one (the selected text). */
export const openFind = (seed: string, origin: FindOrigin | undefined): void => {
  const clean = seed.replace(/\s+/g, " ").trim();
  if (clean !== "" && clean.length <= 200) store.setText(clean);
  if (!store.open()) {
    store.setOrigin(origin);
    store.setAt(origin === undefined ? undefined : { bookId: origin.bookId, from: origin.offset });
  }
  store.setOpen(true);
  store.setOpened((count) => count + 1);
};

/** Lists an open source pane with Find; the answer unlists it. */
export const addFindSource = (source: FindSource): (() => void) => {
  store.setSources((held) => [
    ...held.filter((one) => one.resourceId !== source.resourceId),
    source,
  ]);
  return () => {
    source.mount.setFindMarks(null);
    store.setSources((held) => held.filter((one) => one !== source));
  };
};
