/**
 * Key terms (STET): the same multibuffer, fed by a term's occurrences.
 *
 * The term list is the sidebar's navigation on this screen: each term stands
 * where a book would, and the open one expands to its definition and the
 * curated verses this project has, each one a link into the list. Under them,
 * a switch adds the term's ADDITIONAL references to the list on the right —
 * to the list only: the sidebar stays the curated set a reviewer is asked to
 * work through. Hiding the panel hides the list with it.
 * Right, the excerpt list, where every card reads the PAIRED RESOURCE beside
 * the TARGET, and the target is the editable one.
 *
 * The paired side is the honest part of this screen. Its reading is the
 * guide's own frozen text for that reference, with the guide's precomputed
 * gloss offsets highlighted; when the guide has no reading, a resource bound
 * to the project under the `source` role answers; when neither does, the card
 * says so rather than showing the project's own text twice and calling one of
 * them the paired resource. `sourceOf` is that whole decision, resolved by
 * `src/app/workflows/stet.ts` before a card renders. It is STATIC — a frozen
 * reading has no markup view and no context to widen — so the card offers
 * neither on that side and everything else as it does in Find.
 *
 * The TARGET carries no highlight, deliberately. The guide's offsets
 * index into the guide's reading; this project may put the term elsewhere in
 * the verse, or render it with another word entirely — which is the very thing
 * the reviewer is here to judge. Guessing a highlight would answer the
 * question the screen is asking.
 */

import CheckIcon from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import ChevronUp from "lucide-solid/icons/chevron-up";
import PencilIcon from "lucide-solid/icons/pencil";
import ThumbsUpIcon from "lucide-solid/icons/thumbs-up";
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";

import type { BookId } from "#core/book/book";
import type { BookExcerpts, Excerpt, OutlineRow } from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";
import type { Guide, Term } from "#core/stet/stet";
import type { EditorBook, Funnel } from "#editor/index";

import { t } from "../../i18n";
import type { SourceReading } from "../../workflows/stet";
import type { CardViews } from "../multibuffer/cardViews";
import { cardPolicy } from "../multibuffer/policy";
import { Switch } from "../primitives";
import { ProjectControl } from "../workspace/ProjectSidebar";
import { claimSidebar } from "../workspace/sidebarSlot";
import { excerptCard } from "./cardSpec";
import type { ContextStep, Paired } from "./ExcerptCard";
import { ExcerptList } from "./ExcerptList";

export interface StetViewProps {
  readonly terms: readonly Term[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
  /** The text the term list is filtered by. The URL owns it. */
  readonly filter: string;
  readonly onFilter: (text: string) => void;

  readonly guides: readonly Guide[];
  readonly locale: string;
  readonly onLocale: (locale: string) => void;

  readonly groups: readonly BookExcerpts[];
  /** Every card's view on this screen — the feed's. */
  readonly views: CardViews<Excerpt>;
  readonly outline: readonly OutlineRow[];
  readonly onOpen: (bookId: BookId, from: number, to?: number) => void;
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  readonly seatedOf?: (bookId: BookId) => Funnel | undefined;
  readonly shownOf?: (excerpt: Excerpt) => Excerpt;
  readonly analyze: (text: string) => Analysis;
  readonly onEdited?: (bookId: BookId) => void;
  readonly onExpand: (sid: string, step: ContextStep) => void;
  /** The shell's mode, handed to the excerpt cards. */
  readonly mode?: "regular" | "usfm";

  /** The source reading for one excerpt, or nothing when none is bound. */
  readonly sourceOf?: (excerpt: Excerpt) => SourceReading | undefined;
  /** Whether the list also shows the term's additional references. */
  readonly additional: boolean;
  readonly onAdditional: (on: boolean) => void;
  /** How many core verses this project has for a term: its row's count, open or not. */
  readonly coreTotalOf: (termId: string) => number;
  /** How many additional references this project has for the open term. */
  readonly additionalCount: number;
  /** Is this card one of the curated verses — one the sidebar lists? */
  readonly isCurated: (excerpt: Excerpt) => boolean;
  readonly loading?: boolean;
}

/**
 * A term's definition. The guide has no markup: a list is an introducing line
 * ending in ":" ("This word can describe:") with one item per line after it,
 * and any other line break is a new paragraph.
 */
function Definition(props: { readonly text: string }) {
  const lines = () =>
    props.text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  const listed = () => {
    const held = lines();
    return held.length > 1 && held[0]?.endsWith(":") === true;
  };
  return (
    <div class="flex flex-col gap-1 text-small leading-[2] text-on-surface-primary">
      <Show when={listed()} fallback={<For each={lines()}>{(line) => <p>{line}</p>}</For>}>
        <p>{lines()[0]}</p>
        <ul class="list-disc space-y-1 ps-5">
          <For each={lines().slice(1)}>{(line) => <li>{line}</li>}</For>
        </ul>
      </Show>
    </div>
  );
}

export function StetView(props: StetViewProps) {
  let goTo: ((key: string) => void) | undefined;

  /**
   * The list's order: every curated card first, book by book, then the
   * additional ones, book by book — never interleaved. A book with both is
   * two sections, told apart by `extra` (`sectionKey` below).
   */
  const extra = new WeakSet<BookExcerpts>();
  const ordered = createMemo(
    (): { readonly core: readonly BookExcerpts[]; readonly more: readonly BookExcerpts[] } => {
      const core: BookExcerpts[] = [];
      const more: BookExcerpts[] = [];
      for (const group of props.groups) {
        const curated: Excerpt[] = [];
        const rest: Excerpt[] = [];
        for (const excerpt of group.excerpts)
          (props.isCurated(excerpt) ? curated : rest).push(excerpt);
        if (curated.length > 0) core.push({ ...group, excerpts: curated, count: curated.length });
        if (rest.length > 0) {
          const held = { ...group, excerpts: rest, count: rest.length };
          extra.add(held);
          more.push(held);
        }
      }
      return { core, more };
    },
    { name: "stetOrdered" },
  );
  const listed = (): readonly BookExcerpts[] => [...ordered().core, ...ordered().more];
  const lastCore = (): string | undefined => ordered().core.at(-1)?.excerpts.at(-1)?.sid;
  const lastListed = (): string | undefined => listed().at(-1)?.excerpts.at(-1)?.sid;

  /** The accordion between the core verses and the additional ones: the sidebar switch's twin. */
  const openTerm = (): Term | undefined => props.terms.find((term) => term.id === props.selected);

  /**
   * Shaped like a condensed card — its 24px padding and radius, no border and
   * no fill — so it reads as one more row of the list: the way to the rest of
   * the term's verses, or back.
   */
  const Accordion = () => (
    <button
      type="button"
      data-stet-accordion=""
      aria-expanded={props.additional ? "true" : "false"}
      class="mt-3 flex w-full cursor-pointer items-center gap-3 rounded-3xl border border-transparent bg-transparent p-6 text-start text-on-surface-secondary transition-colors hover:bg-surface-primary hover:text-on-surface-primary [&>svg]:size-5 [&>svg]:shrink-0"
      onClick={() => props.onAdditional(!props.additional)}
    >
      <span class="flex min-w-0 flex-1 flex-col gap-1 ps-3">
        <span class="text-small font-bold">
          {props.additional ? t("Show less") : t("Show more")}
        </span>
        <span class="text-small">
          {t("There are {count} additional verses with the word “{term}”", {
            count: props.additionalCount,
            term: openTerm()?.term ?? "",
          })}
        </span>
      </span>
      <Show when={props.additional} fallback={<ChevronDown aria-hidden="true" />}>
        <ChevronUp aria-hidden="true" />
      </Show>
    </button>
  );

  /**
   * The one active card: whole, with its actions; every other is condensed.
   * Held with the term it belongs to, so opening another term starts again at
   * that term's first card rather than at a sid it does not have.
   */
  const [picked, setPicked] = createSignal<{ readonly term: string; readonly sid: string }>(
    { term: "", sid: "" },
    { name: "stetActiveCard" },
  );
  const allExcerpts = (): readonly Excerpt[] => listed().flatMap((group) => group.excerpts);
  const activeSid = (): string | undefined => {
    const held = picked();
    const all = allExcerpts();
    if (held.term === props.selected && all.some((excerpt) => excerpt.sid === held.sid))
      return held.sid;
    return all[0]?.sid;
  };
  /** The chapter shown whole on `sid`'s card, put back to the verse. */
  const collapse = (sid: string | undefined): void => {
    const excerpt = allExcerpts().find((held) => held.sid === sid);
    if (excerpt?.extent.chapter === true) props.onExpand(excerpt.sid, "chapter");
  };
  /**
   * Where the list goes to show `sid`: the card BEFORE it, so the one just
   * left (or the one above) stays in view, condensed, over the active card.
   * The first card has none, and is gone to itself.
   */
  const anchorOf = (sid: string): string => {
    const all = allExcerpts();
    const at = all.findIndex((excerpt) => excerpt.sid === sid);
    return at > 0 ? (all[at - 1]?.sid ?? sid) : sid;
  };
  /** Make `sid` the active card: the last one folds back; from the sidebar, the list goes to it. */
  const activate = (sid: string, from: "card" | "sidebar"): void => {
    const was = activeSid();
    if (was !== sid) collapse(was);
    setPicked({ term: props.selected, sid });
    // The list stays where it is: the cards open and close in place. Only a
    // pick from the sidebar, which may be far off, goes to it.
    if (from === "sidebar") {
      const anchor = anchorOf(sid);
      queueMicrotask(() => goTo?.(anchor));
    }
  };

  /**
   * The room an expanded card's chapter may take: the list's height, less the
   * card's own chrome and one condensed card after it, so exactly one
   * neighbour stays in view. Written as `--card-room` for the cards to read.
   */
  const [room, setRoom] = createSignal<number | undefined>(undefined, { name: "stetCardRoom" });
  const measure = (element: HTMLElement): void => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setRoom(entry.contentRect.height);
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  };
  /** A card's heading, gaps, padding and action row, and the one condensed card above it. */
  const CHROME = 164;
  const NEIGHBOUR = 100;

  /**
   * The verses approved, per term, by card sid. In memory only: nothing in
   * Sefer stores a settled occurrence yet (`Term.done`), so a reload forgets.
   */
  const [approved, setApproved] = createSignal<ReadonlyMap<string, ReadonlySet<string>>>(
    new Map(),
    { name: "stetApproved" },
  );
  const isApproved = (sid: string): boolean => approved().get(props.selected)?.has(sid) === true;

  /**
   * Which verses have been edited. A card's own unit, as raw USFM, is taken
   * the first time it is seen; it is edited while the text the list now holds
   * differs from that. No hook into the editor: the list re-reads a book's
   * results as it is typed in, so a fresh excerpt IS the news. In memory, for
   * the session — the same as approvals.
   */
  const baseline = new Map<string, string>();
  const ownText = (excerpt: Excerpt): string =>
    excerpt.source.slice(excerpt.own.from - excerpt.span.from, excerpt.own.to - excerpt.span.from);
  const edits = createMemo(
    (): ReadonlySet<string> => {
      const changed = new Set<string>();
      for (const group of props.groups)
        for (const excerpt of group.excerpts) {
          const now = ownText(excerpt);
          const was = baseline.get(excerpt.sid);
          if (was === undefined) baseline.set(excerpt.sid, now);
          else if (was !== now) changed.add(excerpt.sid);
        }
      return changed;
    },
    { name: "stetEdited" },
  );
  const isEdited = (sid: string): boolean => edits().has(sid);

  /**
   * A verse's status mark, the same on its card and in the sidebar: a pencil
   * once edited (brand when approved with the edits, quiet until then), a
   * check when approved as it stood, nothing otherwise.
   */
  const Status = (statusProps: { readonly sid: string; readonly size: number }) => (
    <Show
      when={isEdited(statusProps.sid)}
      fallback={
        <Show when={isApproved(statusProps.sid)}>
          <CheckIcon
            size={statusProps.size}
            aria-label={t("Approved")}
            class="shrink-0 text-brand"
          />
        </Show>
      }
    >
      <PencilIcon
        size={statusProps.size}
        aria-label={isApproved(statusProps.sid) ? t("Approved with edits") : t("Edited")}
        class={
          isApproved(statusProps.sid) ? "shrink-0 text-brand" : "shrink-0 text-on-surface-secondary"
        }
      />
    </Show>
  );
  /**
   * Approvals of CORE verses, per term: each row's numerator, kept whether
   * the term is open or not. An additional verse can be approved too; it does
   * not count here, since the row counts the core set.
   */
  const [coreApproved, setCoreApproved] = createSignal<ReadonlyMap<string, ReadonlySet<string>>>(
    new Map(),
    { name: "stetCoreApproved" },
  );
  const toggleApproved = (excerpt: Excerpt): void => {
    const term = props.selected;
    const sid = excerpt.sid;
    const flip = (map: ReadonlyMap<string, ReadonlySet<string>>, on: boolean) => {
      const next = new Map(map);
      const held = new Set(next.get(term) ?? []);
      if (on) held.add(sid);
      else held.delete(sid);
      next.set(term, held);
      return next;
    };
    const on = !isApproved(sid);
    setApproved(flip(approved(), on));
    if (props.isCurated(excerpt)) setCoreApproved(flip(coreApproved(), on));
  };
  const coreDone = (termId: string): number => coreApproved().get(termId)?.size ?? 0;

  /** The open term's curated verses this project has, in list order. */
  const verses = createMemo(
    () => props.groups.flatMap((group) => group.excerpts.filter(props.isCurated)),
    { name: "stetVerses" },
  );

  const shown = createMemo(
    () => {
      const needle = props.filter.trim().toLowerCase();
      if (needle === "") return props.terms;
      return props.terms.filter(
        (term) =>
          term.term.toLowerCase().includes(needle) ||
          term.englishTerm.toLowerCase().includes(needle) ||
          term.glosses.some((gloss) => gloss.toLowerCase().includes(needle)),
      );
    },
    { name: "stetShownTerms" },
  );

  /**
   * The paired resource for one card: the guide's frozen reading of the place,
   * or a bound resource's, or the words saying there is none. Static either
   * way — no USFM view and no context, because what the guide baked is one
   * verse's reading and not a parse.
   */
  const paired = (excerpt: Excerpt): Paired => {
    const reading = props.sourceOf?.(excerpt);
    const name = reading?.origin === "library" ? t("Paired resource") : t("Guide");
    if (reading === undefined)
      return { kind: "none", name: t("Paired resource"), message: t("No paired resource bound") };
    return { kind: "static", name, text: reading.text, spans: reading.spans ?? [] };
  };

  /** Key terms' cards: Find's. The screen's handlers are read when a card asks. */
  const card = excerptCard(
    {
      kind: "chapter",
      step: (sid, step) => {
        props.onExpand(sid, step);
      },
    },
    // No "Open in editor": the card is edited where it stands.
    { kind: "none" },
    {
      edit: { kind: "direct" },
      // Notes are not this workflow: in Regular they are hidden and passed
      // through untouched, as `\s5` is, over the cards' locked verse numbers.
      // USFM shows everything, notes included.
      policy: (mode) => cardPolicy(mode, "hide-notes"),
      condensed: (excerpt) => excerpt.sid !== activeSid(),
      // The accordion always follows the last core card, open or closed, so
      // pressing it never moves it: the additional verses appear below it.
      // The last card of the list carries room after it, so the list does
      // not end hard against the bottom edge.
      after: (excerpt) => (
        <>
          {props.additionalCount > 0 && excerpt.sid === lastCore() ? <Accordion /> : undefined}
          {excerpt.sid === lastListed() ? <div aria-hidden="true" class="h-24" /> : undefined}
        </>
      ),
      onActivate: (excerpt) => activate(excerpt.sid, "card"),
      status: (excerpt) =>
        isApproved(excerpt.sid) || isEdited(excerpt.sid) ? (
          <Status sid={excerpt.sid} size={20} />
        ) : undefined,
      actions: (excerpt) => [
        {
          kind: "button",
          id: "approve",
          label: isApproved(excerpt.sid)
            ? isEdited(excerpt.sid)
              ? t("Approved with edits")
              : t("Approved")
            : isEdited(excerpt.sid)
              ? t("Approve with edits")
              : t("Approve"),
          icon: isApproved(excerpt.sid) ? CheckIcon : ThumbsUpIcon,
          // As wide as its longest words ("Approved with edits"), whatever it
          // says now, so approving never shifts the row.
          class: "w-52 justify-center",
          pressed: isApproved(excerpt.sid),
          // The card's call to action until it is done; approved, the pressed
          // toggle (the light brand fill), pressed in rather than shouting.
          emphasis: "primary",
          onPress: () => toggleApproved(excerpt),
        },
      ],
    },
  );

  /**
   * The term list: a row per term, the open one expanded.
   */
  const terms = () => (
    <>
      {/* Rows line up with the project card above: 16px each side, the right
          16px being the scrollbar's own track (`scrollbar-padded`), reserved
          whether or not it scrolls. */}
      <nav
        aria-label={t("Spiritual terms")}
        class="scrollbar-padded min-h-0 flex-1 overflow-y-auto ps-4 pt-4 pb-4"
      >
        <Show
          when={!(props.loading === true && props.terms.length === 0)}
          fallback={
            <p class="px-2 py-4 text-small text-on-surface-primary">
              {t("Loading spiritual terms…")}
            </p>
          }
        >
          <Show
            when={shown().length > 0}
            fallback={
              <p class="px-2 py-4 text-small text-on-surface-primary">
                {t("No term matches that.")}
              </p>
            }
          >
            <ul>
              <For each={shown()}>{(term) => <TermRow term={term} />}</For>
            </ul>
          </Show>
        </Show>
      </nav>
    </>
  );

  /** One term, where a book row would be; open, its definition and verses. */
  /** The current term's row folded away, while its cards stay on the right. */
  const [folded, setFolded] = createSignal(false, { name: "stetTermFolded" });

  function TermRow(rowProps: { readonly term: Term }) {
    /** The term being worked on: its cards are the list on the right. */
    const current = (): boolean => props.selected === rowProps.term.id;
    /** Showing its definition and verses. The current term can be folded. */
    const open = (): boolean => current() && !folded();
    return (
      <li>
        <button
          type="button"
          data-term={rowProps.term.id}
          aria-expanded={open() ? "true" : "false"}
          data-open={current() ? "" : undefined}
          class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-4 py-3 text-start text-small transition-colors data-open:font-semibold data-open:text-brand not-data-open:text-sidebar-on-surface not-data-open:hover:bg-sidebar-surface-hover"
          onClick={() => {
            // The current term folds and unfolds; the list on the right stays
            // on it. Another term is opened, and the list goes to its verses.
            if (current()) setFolded(!folded());
            else {
              setFolded(false);
              props.onSelect(rowProps.term.id);
            }
          }}
        >
          <span class="min-w-0 flex-1 truncate">{rowProps.term.term}</span>
          {/* Every row's count, open or not: core verses approved of the core
              verses this project has. A check before it once all are done. */}
          <Show when={props.coreTotalOf(rowProps.term.id) > 0}>
            <Show when={coreDone(rowProps.term.id) >= props.coreTotalOf(rowProps.term.id)}>
              <CheckIcon aria-label={t("Done")} class="size-5 shrink-0" />
            </Show>
            <span class="shrink-0 text-small tabular-nums">
              {t("{done}/{total}", {
                done: coreDone(rowProps.term.id),
                total: props.coreTotalOf(rowProps.term.id),
              })}
            </span>
          </Show>
          <Show
            when={open()}
            fallback={<ChevronRight aria-hidden="true" class="size-5 shrink-0" />}
          >
            <ChevronDown aria-hidden="true" class="size-5 shrink-0" />
          </Show>
        </button>

        <Show when={open()}>
          <div class="flex flex-col gap-2 px-4 pb-3">
            <Show when={rowProps.term.definition !== ""}>
              {/* 16px more below the description (24px in all) before the verses. */}
              <div class="pb-4">
                <Definition text={rowProps.term.definition} />
              </div>
            </Show>
            <Show
              when={verses().length > 0}
              fallback={
                <p class="text-small text-on-surface-primary">
                  {t("No curated verse falls in a book this project has.")}
                </p>
              }
            >
              <ul class="flex flex-col">
                <For each={verses()}>
                  {(excerpt) => (
                    <li>
                      <button
                        type="button"
                        data-term-verse={excerpt.sid}
                        aria-current={activeSid() === excerpt.sid ? "true" : undefined}
                        class="flex h-12 w-full cursor-pointer items-center truncate rounded-lg px-3 text-start text-small tabular-nums transition-colors aria-current:bg-sidebar-surface-active aria-current:font-semibold aria-current:text-brand not-aria-current:text-on-surface-primary not-aria-current:hover:bg-sidebar-surface-hover"
                        onClick={() => activate(excerpt.sid, "sidebar")}
                      >
                        <span class="flex w-full min-w-0 items-center gap-2">
                          <span class="min-w-0 flex-1 truncate">{excerpt.label}</span>
                          <Status sid={excerpt.sid} size={16} />
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            {/* The additional references join the list on the right only;
                this list stays the curated set. */}
            <Show when={props.additionalCount > 0}>
              <Switch
                labelFirst
                class="h-12 w-full justify-between px-3"
                checked={props.additional}
                onChange={props.onAdditional}
                // How many MORE, the same number the accordion on the right gives.
                label={t("Show {count} more", { count: props.additionalCount })}
              />
            </Show>
          </div>
        </Show>
      </li>
    );
  }

  onCleanup(
    claimSidebar(() => (
      <div
        class="flex h-full flex-col border-e border-sidebar-border bg-sidebar-surface"
        data-testid="sidebar"
        data-sidebar="terms"
      >
        <ProjectControl />
        {terms()}
      </div>
    )),
  );

  return (
    <div
      ref={measure}
      class="flex min-h-0 flex-1 gap-4"
      style={
        room() === undefined
          ? undefined
          : { "--card-room": `${Math.max(160, (room() ?? 0) - CHROME - NEIGHBOUR)}px` }
      }
    >
      {/* The term list is the panel's: hiding the panel hides it too, and
          the cards take the width. */}

      <ExcerptList
        goneLabel={t("No longer an occurrence")}
        resultsKey={`${props.selected}:${props.additional ? "all" : "curated"}`}
        claimsSidebar={false}
        goTo={(go) => {
          goTo = go;
        }}
        groups={listed()}
        sections={{
          sectionKey: (group) => (extra.has(group) ? `${group.bookId}:more` : group.bookId),
        }}
        views={props.views}
        outline={props.outline}
        card={card}
        seat={props.seat}
        seatedOf={props.seatedOf}
        shownOf={props.shownOf}
        analyze={props.analyze}
        onEdited={props.onEdited}
        mode={props.mode ?? "regular"}
        pairedOf={paired}
        empty={
          <p class="text-small text-on-surface-primary">
            {t("No occurrence of this term falls in a book this project has.")}
          </p>
        }
      />
    </div>
  );
}
