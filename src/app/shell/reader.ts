import { anchorFrom, type EditorBook } from "@sefer/editor";
import type { BookId } from "@sefer/text/book";
import { addressCode, chaptersAddress, type Address } from "@sefer/text/location/address";
import { addressAt, resolve } from "@sefer/text/location/locate";
import { Effect, Option, Result } from "effect";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
  type Setter,
} from "solid-js";

import { tocViewOf } from "#core/galley";
import type { SettingKey } from "#core/host/settings";
import type { Project } from "#core/project/project";
import { SaveCoordinator } from "#core/save/saveCoordinator";

import { t } from "../i18n";
import type { Location } from "../location";
import type { Services } from "../services";
import type { LastLocation, LastLocations, shellKeys } from "../settings";
import type { ShellStores } from "../shellStores";
import type { Navigate, LiveProject, Reveal, RevealAt } from "./types";

export interface ReaderDeps {
  readonly services: Services;
  readonly keys: ReturnType<typeof shellKeys>;
  readonly navigate: Navigate;
  readonly location: Location;
  readonly project: Accessor<Project | undefined>;
  readonly focused: Accessor<EditorBook | undefined>;
  readonly setFocused: Setter<EditorBook | undefined>;
  readonly chapter: Accessor<number | null>;
  readonly setChapter: Setter<number | null>;
  readonly pendingPlace: Accessor<Address | undefined>;
  readonly setPendingPlace: Setter<Address | undefined>;
  readonly landOnOpen: Accessor<string | undefined>;
  readonly setLandOnOpen: Setter<string | undefined>;
  readonly reveal: Accessor<Reveal | undefined>;
  readonly setReveal: Setter<Reveal | undefined>;
  readonly preferChapterView: Accessor<boolean>;
  readonly stampOf: ShellStores["stampOf"];
  readonly live: LiveProject;
  readonly persist: <S>(key: SettingKey<S>, value: S) => void;
  readonly report: (message: string) => void;
  readonly slug: () => string;
  readonly slugFor: (root: string) => string;
}

const createLocationMemory = ({
  services,
  keys,
  focused,
  chapter,
  live,
  persist,
}: Pick<ReaderDeps, "services" | "keys" | "focused" | "chapter" | "live" | "persist">) => {
  const [locations, setLocations] = createSignal<LastLocations>(
    services.settings.get(keys.lastLocation),
    { name: "lastLocations", equals: false },
  );

  let locationWrite: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (locationWrite !== undefined) clearTimeout(locationWrite);
  });

  const OFFSET_SETTLE = 250;
  let offsetWrite: ReturnType<typeof setTimeout> | undefined;

  const remember = (
    bookId: BookId | undefined,
    ordinal: number | null,
    at?: number,
    place?: LastLocation["place"],
  ): void => {
    const root = live.get()?.root;
    if (root === undefined || bookId === undefined) return;
    // A writer, not a reader: a one-time read of the map it rewrites (Solid 2: STRICT_READ_UNTRACKED otherwise).
    const held = untrack(locations);
    const previous = held[root];
    const same = previous?.bookId === bookId;
    const carried = same ? previous.at : undefined;
    const where = at ?? carried;
    const where2 = place ?? (same ? previous.place : undefined);
    const next: LastLocations = {
      ...held,
      [root]: {
        bookId,
        chapter: ordinal,
        ...(where === undefined ? {} : { at: where }),
        ...(where2 === undefined ? {} : { place: where2 }),
      },
    };
    setLocations(next);
    if (locationWrite !== undefined) clearTimeout(locationWrite);
    locationWrite = setTimeout(() => {
      locationWrite = undefined;
      persist(keys.lastLocation, next);
    }, 400);
  };

  const noteChapterAtTop = (ordinal: number, place?: LastLocation["place"]): void => {
    // Records where the viewport got to: one-time snapshots, subscribing to nothing.
    const book = untrack(focused);
    if (book === undefined) return;
    const root = live.get()?.root;
    if (root === undefined) return;
    const held = untrack(locations)[root];
    const sameBook = held?.bookId === book.id;
    const settled = held?.place?.chapter === place?.chapter && held?.place?.verse === place?.verse;
    if (sameBook && held.at === ordinal && settled) return;

    if (!sameBook || held.at !== ordinal) {
      if (offsetWrite !== undefined) {
        clearTimeout(offsetWrite);
        offsetWrite = undefined;
      }
      remember(book.id, untrack(chapter), ordinal, place);
      return;
    }

    if (offsetWrite !== undefined) clearTimeout(offsetWrite);
    offsetWrite = setTimeout(() => {
      offsetWrite = undefined;
      remember(book.id, untrack(chapter), ordinal, place);
    }, OFFSET_SETTLE);
  };

  const lastLocation = (root: string): LastLocation | undefined => locations()[root];

  return { remember, noteChapterAtTop, lastLocation };
};

const createPlace = ({
  services,
  focused,
  stampOf,
}: Pick<ReaderDeps, "services" | "focused" | "stampOf">) => {
  const [caret, setCaret] = createSignal<number | undefined>(undefined, { name: "caret" });

  const noteCaret = (offset: number | undefined): void => {
    setCaret(offset);
  };

  const place = createMemo(
    (held: Address | undefined): Address | undefined => {
      const at = caret();
      const book = focused();
      if (at === undefined || book === undefined) return undefined;
      const stamp = stampOf(book.id);
      const analysis = Option.getOrUndefined(services.projectAnalysis.analysis(book.id));
      if (stamp === undefined || analysis === undefined) return held;
      if (analysis.stamp.revision !== stamp.revision) return held;
      return addressAt(book.id, tocViewOf(analysis.analysis), at) ?? held;
    },
    {
      name: "place",
      equals: (a, b) =>
        a === b || (a !== undefined && b !== undefined && addressCode(a) === addressCode(b)),
    },
  );

  return { caret, noteCaret, place };
};

const arriveAt = (
  held: EditorBook,
  want: Address,
  steps: Pick<ReaderDeps, "location" | "report"> & {
    readonly showChapter: (ordinal: number) => void;
    readonly aim: (bookId: BookId, from: number, to?: number, at?: RevealAt) => void;
  },
): void => {
  const { location, report, showChapter, aim } = steps;
  const analysis = held.structure().analysis;
  if (analysis == null) return;
  const place = (): string => location.label(want);
  untrack(() => {
    const found = resolve(tocViewOf(analysis), want);
    const chapters = held.structure().chapters;
    const ordinalAt = (offset: number): number =>
      chapters.findIndex((chapter) => chapter.from <= offset && offset < chapter.to);

    switch (found.kind) {
      case "found": {
        const at = ordinalAt(found.from);
        if (at >= 0) showChapter(at);
        if (want.kind === "verses") aim(held.id, found.from, undefined, "top");
        return;
      }
      case "missing": {
        if (found.within !== undefined) {
          const at = ordinalAt(found.within.from);
          if (at >= 0) showChapter(at);
        }
        report(t("{place} is not in this book", { place: place() }));
        return;
      }
      case "ambiguous": {
        const first = found.spans[0];
        if (first !== undefined) {
          const at = ordinalAt(first.from);
          if (at >= 0) showChapter(at);
          if (want.kind === "verses") aim(held.id, first.from, undefined, "top");
        }
        report(t("{place} appears more than once in this book", { place: place() }));
        return;
      }
    }
  });
};

export const createReader = ({
  services,
  keys,
  navigate,
  location,
  project,
  focused,
  setFocused,
  chapter,
  setChapter,
  pendingPlace,
  setPendingPlace,
  landOnOpen,
  setLandOnOpen,
  reveal,
  setReveal,
  preferChapterView,
  stampOf,
  live,
  persist,
  report,
  slug,
  slugFor,
}: ReaderDeps) => {
  const { remember, noteChapterAtTop, lastLocation } = createLocationMemory({
    services,
    keys,
    focused,
    chapter,
    live,
    persist,
  });
  const { caret, noteCaret, place } = createPlace({ services, focused, stampOf });

  const openingChapter = (book: EditorBook, at: number | undefined): number | null => {
    if (!preferChapterView()) return null;
    if (at === undefined) return 0;
    const chapters = book.structure().chapters;
    let found = 0;
    for (const chapter of chapters) if (chapter.from <= at) found = chapter.ordinal;
    return found;
  };

  let honoured: Reveal | undefined;

  /**
   * Where to reopen this book: the last place, when it is in this book and
   * nothing asked for another. An aim (a finding, a search hit) and a place
   * still on its way (the palette, a chapter tile, a link) are requests; a
   * remembered place is only the absence of one.
   */
  const resumePlace = (bookId: BookId): LastLocation["place"] =>
    untrack(() => {
      if (pendingPlace()?.book === bookId || reveal()?.bookId === bookId) return undefined;
      const root = project()?.root;
      const held = root === undefined ? undefined : lastLocation(root);
      return held?.bookId === bookId ? held.place : undefined;
    });

  const focus = async (bookId: BookId | undefined): Promise<void> => {
    const staticProject = project();
    if (bookId === undefined || staticProject === undefined) {
      setFocused(undefined);
      return;
    }
    const seated = await services.run(
      Effect.gen(function* () {
        const book = yield* Effect.result(staticProject.instantiate(bookId));
        if (Result.isFailure(book)) return undefined;
        const coordinator = yield* SaveCoordinator;
        yield* coordinator.adopt(book.success);
        return book.success;
      }),
    );
    const editing = seated === undefined ? undefined : services.seated(bookId);
    if (editing === undefined) {
      report(t("could not open book {book}", { book: bookId }));
      return;
    }
    setFocused(editing);
    const aimed = reveal();
    const fresh = aimed !== undefined && aimed !== honoured && aimed.bookId === bookId;
    const at = fresh ? aimed.from : undefined;
    if (!fresh) setReveal(undefined);
    else honoured = aimed;

    const held = lastLocation(staticProject.root);
    const resume = at === undefined && held?.bookId === bookId ? held.at : undefined;

    const opening = openingChapter(editing, at);
    if (preferChapterView() && resume !== undefined) {
      setChapter(resume);
      remember(bookId, resume, resume);
      return;
    }
    setChapter(opening);
    remember(bookId, opening, resume);
  };

  const aim = (bookId: BookId, from: number, to?: number, at?: RevealAt): void => {
    setReveal({ bookId, from, to, at });
  };

  const showChapter = (ordinal: number): void => {
    const book = focused();
    if (book === undefined) return;
    remember(book.id, preferChapterView() ? ordinal : null, ordinal);
    if (preferChapterView()) {
      setChapter(ordinal);
      return;
    }
    const chapter = book.structure().chapters[ordinal];
    if (chapter === undefined) return;
    setChapter(null);
    aim(book.id, anchorFrom(chapter), undefined, "top");
  };

  const showReference = (address: Address): void => {
    if (project() === undefined) return;
    if (!location.holds(address.book)) {
      report(
        t("This project has no {book}", {
          book: location.label({ kind: "book", book: address.book }),
        }),
      );
      return;
    }
    if (address.kind !== "book") setPendingPlace(address);
    void navigate({
      to: "/project/$slug/book/$book",
      params: { slug: slug(), book: encodeURIComponent(address.book) },
    });
  };

  const openProjectAtStart = (root: string): void => {
    setLandOnOpen(root);
    void navigate({ to: "/project/$slug", params: { slug: slugFor(root) } });
  };

  createEffect(
    () => ({ open: project(), want: landOnOpen() }),
    ({ open, want }) => {
      if (open === undefined || want === undefined || open.root !== want) return;
      setLandOnOpen(undefined);
      const book = open.book("MAT") ?? open.books[0];
      if (book !== undefined) untrack(() => showReference(chaptersAddress(book.id, 1)));
    },
  );

  createEffect(
    () => ({ held: focused(), want: pendingPlace() }),
    ({ held, want }) => {
      if (want === undefined || held === undefined || held.id !== want.book) return;
      setPendingPlace(undefined);
      arriveAt(held, want, { location, report, showChapter, aim });
    },
  );

  return {
    focus,
    caret,
    noteCaret,
    place,
    noteChapterAtTop,
    lastLocation,
    resumePlace,
    remember,
    aim,
    showChapter,
    showReference,
    openProjectAtStart,
  };
};
