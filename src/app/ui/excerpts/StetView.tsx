/**
 * Key terms (STET): the same multibuffer, fed by a term's occurrences.
 *
 * The term list is the sidebar's navigation on this screen: each term stands
 * where a book would, and the open one expands to its definition and the
 * curated verses this project has, each one a link into the list. Under them,
 * a switch adds the term's ADDITIONAL references to the list on the right —
 * to the list only: the sidebar stays the curated set a reviewer is asked to
 * work through. With the sidebar hidden the same list sits beside the cards.
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
import CircleIcon from "lucide-solid/icons/circle";
import CircleCheckIcon from "lucide-solid/icons/circle-check";
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";

import type { BookId } from "#core/book/book";
import type { BookExcerpts, Excerpt, OutlineRow } from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";
import type { Guide, Term } from "#core/stet/stet";
import type { EditorBook, Funnel } from "#editor/index";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import type { SourceReading } from "../../workflows/stet";
import type { CardViews } from "../multibuffer/cardViews";
import { Badge, Switch } from "../primitives";
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
    <div class="flex flex-col gap-1 text-small text-on-surface-primary">
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
  const shell = useShell();
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
  const firstMore = (): string | undefined => ordered().more[0]?.excerpts[0]?.sid;

  /** The accordion between the core verses and the additional ones: the sidebar switch's twin. */
  const Accordion = () => (
    <button
      type="button"
      data-stet-accordion=""
      aria-expanded={props.additional ? "true" : "false"}
      class="mt-3 flex h-12 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-start text-small font-semibold text-on-surface-primary transition-colors hover:bg-surface-secondary [&>svg]:size-5"
      onClick={() => props.onAdditional(!props.additional)}
    >
      <Show when={props.additional} fallback={<ChevronRight aria-hidden="true" />}>
        <ChevronDown aria-hidden="true" />
      </Show>
      {t("Additional references ({count})", { count: props.additionalCount })}
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

  /** Cards the list shows: the denominator of the count, as approvals are per card. */
  const inList = (): number => props.groups.reduce((sum, entry) => sum + entry.excerpts.length, 0);

  /**
   * The verses approved, per term, by card sid. In memory only: nothing in
   * Sefer stores a settled occurrence yet (`Term.done`), so a reload forgets.
   */
  const [approved, setApproved] = createSignal<ReadonlyMap<string, ReadonlySet<string>>>(
    new Map(),
    { name: "stetApproved" },
  );
  const isApproved = (sid: string): boolean => approved().get(props.selected)?.has(sid) === true;
  const toggleApproved = (sid: string): void => {
    const term = props.selected;
    const next = new Map(approved());
    const held = new Set(next.get(term) ?? []);
    if (held.has(sid)) held.delete(sid);
    else held.add(sid);
    next.set(term, held);
    setApproved(next);
  };
  /** The count's numerator: approved cards among those the list shows. */
  const approvedInList = (): number => {
    const held = approved().get(props.selected);
    if (held === undefined) return 0;
    let count = 0;
    for (const group of props.groups)
      for (const excerpt of group.excerpts) if (held.has(excerpt.sid)) count += 1;
    return count;
  };

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
      condensed: (excerpt) => excerpt.sid !== activeSid(),
      // Closed, the accordion follows the last core card; open, it heads the first additional one.
      after: (excerpt) =>
        !props.additional && props.additionalCount > 0 && excerpt.sid === lastCore() ? (
          <Accordion />
        ) : undefined,
      before: (excerpt) =>
        props.additional && excerpt.sid === firstMore() ? <Accordion /> : undefined,
      onActivate: (excerpt) => activate(excerpt.sid, "card"),
      status: (excerpt) =>
        isApproved(excerpt.sid) ? (
          <CheckIcon size={20} aria-label={t("Approved")} class="text-brand" />
        ) : undefined,
      actions: (excerpt) => [
        {
          kind: "button",
          id: "approve",
          label: isApproved(excerpt.sid) ? t("Approved") : t("Approve"),
          icon: isApproved(excerpt.sid) ? CircleCheckIcon : CircleIcon,
          pressed: isApproved(excerpt.sid),
          emphasis: "tertiary",
          onPress: () => toggleApproved(excerpt.sid),
        },
      ],
    },
  );

  /**
   * The term list: a row per term, the open one expanded.
   */
  const terms = () => (
    <>
      <nav aria-label={t("Key terms")} class="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-4">
        <Show
          when={!(props.loading === true && props.terms.length === 0)}
          fallback={
            <p class="px-2 py-4 text-small text-on-surface-tertiary">{t("Loading key terms…")}</p>
          }
        >
          <Show
            when={shown().length > 0}
            fallback={
              <p class="px-2 py-4 text-small text-on-surface-tertiary">
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
  function TermRow(rowProps: { readonly term: Term }) {
    const open = (): boolean => props.selected === rowProps.term.id;
    return (
      <li>
        <button
          type="button"
          data-term={rowProps.term.id}
          aria-expanded={open() ? "true" : "false"}
          data-open={open() ? "" : undefined}
          class="flex w-full cursor-pointer items-center gap-2 rounded-lg p-3 text-start text-small transition-colors data-open:font-semibold data-open:text-brand not-data-open:text-sidebar-on-surface not-data-open:hover:bg-sidebar-surface-hover"
          onClick={() => props.onSelect(rowProps.term.id)}
        >
          <span class="min-w-0 flex-1 truncate">{rowProps.term.term}</span>
          {/* Only the open term has a count: the others have not been mapped
              onto the project, and a placeholder pill would read as a zero. */}
          <Show when={open()}>
            <Badge tone="brand">
              {t("{done}/{total}", { done: approvedInList(), total: inList() })}
            </Badge>
          </Show>
          <Show
            when={open()}
            fallback={<ChevronRight size={16} aria-hidden="true" class="shrink-0" />}
          >
            <ChevronDown size={16} aria-hidden="true" class="shrink-0" />
          </Show>
        </button>

        <Show when={open()}>
          <div class="flex flex-col gap-2 px-3 pb-3">
            <Show when={rowProps.term.definition !== ""}>
              <Definition text={rowProps.term.definition} />
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
                        class="w-full cursor-pointer truncate rounded-lg px-3 py-2 text-start text-small tabular-nums transition-colors aria-current:bg-sidebar-surface-active aria-current:font-semibold aria-current:text-brand not-aria-current:text-on-surface-primary not-aria-current:hover:bg-sidebar-surface-hover"
                        onClick={() => activate(excerpt.sid, "sidebar")}
                      >
                        <span class="flex items-center gap-2">
                          <span class="min-w-0 flex-1 truncate">{excerpt.label}</span>
                          <Show when={isApproved(excerpt.sid)}>
                            <CheckIcon
                              size={16}
                              aria-label={t("Approved")}
                              class="shrink-0 text-brand"
                            />
                          </Show>
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
                class="w-full justify-between px-3 py-2"
                checked={props.additional}
                onChange={props.onAdditional}
                label={t("Show all ({count})", {
                  count: inList() + (props.additional ? 0 : props.additionalCount),
                })}
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
      {/* The sidebar hidden, the term list sits beside the cards instead. */}
      <Show when={!shell.sidebarShowing()}>
        <aside class="flex w-72 shrink-0 flex-col">{terms()}</aside>
      </Show>

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
          <p class="text-small text-on-surface-tertiary">
            {t("No occurrence of this term falls in a book this project has.")}
          </p>
        }
      />
    </div>
  );
}
