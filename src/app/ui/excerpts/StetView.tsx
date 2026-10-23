import type { EditorBook, Following } from "@sefer/editor";
import type { BookId } from "@sefer/text/book";
import CheckIcon from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import ChevronUp from "lucide-solid/icons/chevron-up";
import CircleAlert from "lucide-solid/icons/circle-alert";
import PencilIcon from "lucide-solid/icons/pencil";
import ThumbsUpIcon from "lucide-solid/icons/thumbs-up";
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";

import type { BookExcerpts, Excerpt, Extent, OutlineRow } from "#core/excerpts/excerpts";
import type { Analysis } from "#core/galley";
import { isStanding, type ApprovalState } from "#core/stet/approvals";
import type { Guide, Term } from "#core/stet/stet";

import type { ApprovalsHandle } from "../../approvals";
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
  readonly filter: string;
  readonly onFilter: (text: string) => void;

  readonly guides: readonly Guide[];
  readonly locale: string;
  readonly onLocale: (locale: string) => void;

  readonly groups: readonly BookExcerpts[];
  readonly views: CardViews<Excerpt>;
  readonly outline: readonly OutlineRow[];
  readonly onOpen: (bookId: BookId, from: number, to?: number) => void;
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  readonly seatedOf?: (bookId: BookId) => Following | undefined;
  readonly shownOf?: (excerpt: Excerpt) => Excerpt;
  readonly analyze: (text: string) => Analysis;
  readonly onEdited?: (bookId: BookId) => void;
  readonly initial: Extent;
  readonly onExpand: (sid: string, step: ContextStep) => void;
  readonly mode?: "regular" | "usfm";

  readonly sourceOf?: (excerpt: Excerpt) => SourceReading | undefined;
  readonly additional: boolean;
  readonly onAdditional: (on: boolean) => void;
  readonly coreTotalOf: (termId: string) => number;
  readonly additionalCount: number;
  readonly isCurated: (excerpt: Excerpt) => boolean;
  readonly approvals: ApprovalsHandle;
  readonly loading?: boolean;
}

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

  const openTerm = (): Term | undefined => props.terms.find((term) => term.id === props.selected);

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
  const collapse = (sid: string | undefined): void => {
    const excerpt = allExcerpts().find((held) => held.sid === sid);
    if (excerpt?.extent.chapter === true) props.onExpand(excerpt.sid, "chapter");
  };
  const anchorOf = (sid: string): string => {
    const all = allExcerpts();
    const at = all.findIndex((excerpt) => excerpt.sid === sid);
    return at > 0 ? (all[at - 1]?.sid ?? sid) : sid;
  };
  const activate = (sid: string, from: "card" | "sidebar"): void => {
    const was = activeSid();
    if (was !== sid) collapse(was);
    setPicked({ term: props.selected, sid });
    if (from === "sidebar") {
      const anchor = anchorOf(sid);
      queueMicrotask(() => goTo?.(anchor));
    }
  };

  const [room, setRoom] = createSignal<number | undefined>(undefined, { name: "stetCardRoom" });
  const measure = (element: HTMLElement): void => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setRoom(entry.contentRect.height);
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  };
  const CHROME = 164;
  const NEIGHBOUR = 100;

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

  const nowBySid = createMemo(
    (): ReadonlyMap<string, string> => {
      const out = new Map<string, string>();
      for (const group of props.groups)
        for (const excerpt of group.excerpts) out.set(excerpt.sid, ownText(excerpt));
      return out;
    },
    { name: "stetNowText" },
  );
  const stateAt = (sid: string): ApprovalState => {
    const now = nowBySid().get(sid);
    return now === undefined ? "unapproved" : props.approvals.state(props.selected, sid, now);
  };
  const isApproved = (sid: string): boolean => isStanding(stateAt(sid));
  const isChanged = (sid: string): boolean => {
    const state = stateAt(sid);
    return state === "changedSinceApproved" || state === "needsRecheck";
  };

  const approveLabel = (sid: string): string => {
    if (isChanged(sid)) return t("Text changed since last approved");
    if (isApproved(sid)) return isEdited(sid) ? t("Approved with edits") : t("Approved");
    return isEdited(sid) ? t("Approve with edits") : t("Approve");
  };

  const Status = (statusProps: { readonly sid: string; readonly size: number }) => (
    <Show
      when={!isChanged(statusProps.sid)}
      fallback={
        <CircleAlert
          size={statusProps.size}
          aria-label={t("Text changed since last approved")}
          class="shrink-0 text-on-surface-warning"
        />
      }
    >
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
            isApproved(statusProps.sid)
              ? "shrink-0 text-brand"
              : "shrink-0 text-on-surface-secondary"
          }
        />
      </Show>
    </Show>
  );
  const toggleApproved = (excerpt: Excerpt): void => {
    const sid = excerpt.sid;
    if (isApproved(sid)) {
      props.approvals.unapprove(props.selected, sid);
      return;
    }
    const now = ownText(excerpt);
    props.approvals.approve(props.selected, sid, baseline.get(sid) ?? now, now);
  };
  const curatedOf = createMemo(
    (): ReadonlyMap<string, ReadonlySet<string>> =>
      new Map(
        props.terms.map((term) => [
          term.id,
          new Set(term.occurrences.filter((each) => each.curated).map((each) => each.sid)),
        ]),
      ),
    { name: "stetCuratedSids" },
  );
  const coreDone = (termId: string): number => {
    const curated = curatedOf().get(termId);
    if (curated === undefined) return 0;
    let done = 0;
    for (const entry of props.approvals.held().byKey.values())
      if (entry.term === termId && curated.has(entry.verse)) done += 1;
    return done;
  };

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

  const paired = (excerpt: Excerpt): Paired => {
    const reading = props.sourceOf?.(excerpt);
    const name = reading?.origin === "library" ? t("Paired resource") : t("Guide");
    if (reading === undefined)
      return { kind: "none", name: t("Paired resource"), message: t("No paired resource bound") };
    return { kind: "static", name, text: reading.text, spans: reading.spans ?? [] };
  };

  const card = excerptCard(
    {
      kind: "chapter",
      from: props.initial,
      step: (sid, step) => {
        props.onExpand(sid, step);
      },
    },
    { kind: "none" },
    {
      edit: { kind: "direct" },
      policy: (mode) => cardPolicy(mode, "hide-notes"),
      condensed: (excerpt) => excerpt.sid !== activeSid(),
      after: (excerpt) => (
        <>
          {props.additionalCount > 0 && excerpt.sid === lastCore() ? <Accordion /> : undefined}
          {excerpt.sid === lastListed() ? <div aria-hidden="true" class="h-24" /> : undefined}
        </>
      ),
      onActivate: (excerpt) => activate(excerpt.sid, "card"),
      status: (excerpt) =>
        isApproved(excerpt.sid) || isEdited(excerpt.sid) || isChanged(excerpt.sid) ? (
          <Status sid={excerpt.sid} size={20} />
        ) : undefined,
      actions: (excerpt) => [
        {
          kind: "button",
          id: "approve",
          label: approveLabel(excerpt.sid),
          icon: isApproved(excerpt.sid) ? CheckIcon : ThumbsUpIcon,
          class: "w-72 justify-center",
          pressed: isApproved(excerpt.sid),
          emphasis: "primary",
          onPress: () => toggleApproved(excerpt),
        },
      ],
    },
  );

  const terms = () => (
    <>
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

  const [folded, setFolded] = createSignal(false, { name: "stetTermFolded" });

  function TermRow(rowProps: { readonly term: Term }) {
    const current = (): boolean => props.selected === rowProps.term.id;
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
            if (current()) setFolded(!folded());
            else {
              setFolded(false);
              props.onSelect(rowProps.term.id);
            }
          }}
        >
          <span class="min-w-0 flex-1 truncate">{rowProps.term.term}</span>

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

            <Show when={props.additionalCount > 0}>
              <Switch
                labelFirst
                class="h-12 w-full justify-between px-3"
                checked={props.additional}
                onChange={props.onAdditional}
                label={t("Show {count} more", { count: props.additionalCount })}
              />
            </Show>
          </div>
        </Show>
      </li>
    );
  }

  onCleanup(
    claimSidebar(
      () => (
        <div
          class="flex h-full flex-col border-e border-sidebar-border bg-sidebar-surface"
          data-testid="sidebar"
          data-sidebar="terms"
        >
          <ProjectControl />
          {terms()}
        </div>
      ),
      { show: t("Show key terms"), hide: t("Hide key terms") },
    ),
  );

  return (
    <div
      ref={measure}
      data-tour="terms-cards"
      class="flex min-h-0 flex-1 gap-4"
      style={
        room() === undefined
          ? undefined
          : { "--card-room": `${Math.max(160, (room() ?? 0) - CHROME - NEIGHBOUR)}px` }
      }
    >
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
