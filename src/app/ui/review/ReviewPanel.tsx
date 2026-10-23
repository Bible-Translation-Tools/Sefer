import type { BookId } from "@sefer/text/book";
import { useNavigate } from "@tanstack/solid-router";
import { Option } from "effect";
import Scale from "lucide-solid/icons/scale";
import { Show, createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js";

import type { BookComparison } from "#core/compare";
import type { Restorable } from "#core/recovery/recovery";

import { t } from "../../i18n";
import { m } from "../../paraglide/messages";
import { useShell, type Navigate, type Shell } from "../../ProjectContext";
import type { Services } from "../../services";
import { EmptyState } from "../primitives";
import { bookName } from "../workspace/books";
import { ChangesHistorySidebar } from "../workspace/ChangesHistorySidebar";
import { metadataOf } from "../workspace/project";
import { claimSidebar } from "../workspace/sidebarSlot";
import { createCompare, type Compare } from "./panel/createCompare";
import { createDecisions, type Decisions } from "./panel/createDecisions";
import { createReceipt, type Receipt } from "./panel/createReceipt";
import { createRecordAction, type RecordAction } from "./panel/createRecordAction";
import { createReviewRoute, type ReviewRoute } from "./panel/createReviewRoute";
import { createSaveForm, type SaveForm } from "./panel/createSaveForm";
import { createSides, type Sides } from "./panel/createSides";
import { createUnits, type Units } from "./panel/createUnits";
import { createWrites, type Writes } from "./panel/createWrites";
import { ReviewBody } from "./panel/ReviewBody";
import { ReviewHeader } from "./panel/ReviewHeader";
import { SaveDialog } from "./panel/SaveDialog";

interface PanelModel {
  readonly shell: Shell;
  readonly navigate: Navigate;
  readonly route: ReviewRoute;
  readonly sides: Sides;
  readonly compare: Compare;
  readonly units: Units;
  readonly decisions: Decisions;
  readonly form: SaveForm;
  readonly writes: Writes;
  readonly receipt: Receipt;
  readonly record: RecordAction;
  readonly sourcesOpen: Accessor<boolean>;
  readonly setSourcesOpen: (open: boolean) => void;
  readonly busy: Accessor<string>;
  readonly note: Accessor<string>;
  readonly cardEditing: Accessor<boolean>;
  readonly setCardEditing: (editing: boolean) => void;
  readonly settled: () => boolean;
  readonly emptySide: () => string | undefined;
  readonly bookLabel: (book: BookComparison) => string;
  readonly lastBackup: () => number | undefined;
}

interface PanelBase {
  readonly shell: Shell;
  readonly services: Services;
  readonly navigate: Navigate;
  readonly route: ReviewRoute;
  readonly sides: Sides;
  readonly decisions: Decisions;
  readonly setNote: (note: string) => void;
  readonly nameOf: (bookId: BookId) => string;
}

function createPanelParts(base: PanelBase) {
  const { shell, services, navigate, route, sides, decisions, setNote, nameOf } = base;
  const compare = createCompare({ shell, services, sides, decisions, setNote });
  const units = createUnits({ services, route, sides, decisions, compare, nameOf });
  const writes = createWrites({ shell, services, sides, decisions, units, setNote });
  const form = createSaveForm({ shell, services, route, sides });
  const receipt = createReceipt({ shell, services, navigate, sides, form });
  const record = createRecordAction({
    shell,
    services,
    navigate,
    route,
    sides,
    decisions,
    units,
    writes,
    form,
    receipt,
  });
  return { compare, units, writes, form, receipt, record };
}

function watchRoute(route: ReviewRoute, decisions: Decisions, sides: Sides): void {
  const { search } = route;
  const { leftId, rightId, pick, seeShared } = sides;
  let wasCopy = untrack(route.fromCopy);
  createEffect(
    () => `${String(search().against)}:${String(search().copy)}`,
    () => {
      const nowCopy = untrack(route.fromCopy);
      if (nowCopy !== wasCopy) untrack(decisions.startOver);
      wasCopy = nowCopy;
      const against = untrack(() => search().against);
      if (against === "shared") untrack(seeShared);
      if (against === "writer" && untrack(rightId) !== "writer" && untrack(leftId) !== "writer")
        untrack(() => pick("right", "writer"));
    },
  );
}

function createLastBackup(
  shell: Shell,
  services: Services,
  compare: Compare,
  journals: Accessor<readonly Restorable[]>,
  setJournals: (found: readonly Restorable[]) => void,
): () => number | undefined {
  const reload = (): void => {
    const project = shell.project();
    if (project === undefined) return;
    void services
      .run(
        services.recovery.pending((bookId: BookId) => {
          const book = project.book(bookId);
          return book === undefined ? Option.none() : services.save.baseline(book);
        }),
      )
      .then((found) => {
        setJournals(found.filter((entry) => entry.projectId === project.id));
      });
  };

  createEffect(compare.revisions, () => {
    untrack(reload);
  });

  return (): number | undefined => {
    let latest: number | undefined;
    for (const journal of journals())
      for (const entry of journal.entries)
        if (latest === undefined || entry.at > latest) latest = entry.at;
    return latest;
  };
}

function ReviewHeaderView(props: { readonly panel: PanelModel }) {
  return (
    <ReviewHeader
      sides={props.panel.sides}
      compare={props.panel.compare}
      decisions={props.panel.decisions}
      form={props.panel.form}
      sourcesOpen={props.panel.sourcesOpen()}
      onSourcesOpenChange={props.panel.setSourcesOpen}
      sourcesLabel={`${props.panel.sides.rightLabel()} → ${props.panel.sides.leftLabel()}`}
      busy={props.panel.busy()}
      note={props.panel.note()}
      lastBackup={props.panel.lastBackup()}
    />
  );
}

function ReviewBodyView(props: { readonly panel: PanelModel }) {
  return (
    <ReviewBody
      shell={props.panel.shell}
      route={props.panel.route}
      sides={props.panel.sides}
      compare={props.panel.compare}
      units={props.panel.units}
      decisions={props.panel.decisions}
      form={props.panel.form}
      writes={props.panel.writes}
      settled={props.panel.settled()}
      cardEditing={props.panel.cardEditing()}
      emptySide={props.panel.emptySide()}
      bookLabel={props.panel.bookLabel}
      usfm={props.panel.shell.mode() === "usfm"}
      onUsfm={(on) => props.panel.shell.setMode(on ? "usfm" : "default")}
      onEditing={props.panel.setCardEditing}
    />
  );
}

function SaveDialogView(props: { readonly panel: PanelModel }) {
  return (
    <SaveDialog
      form={props.panel.form}
      receipt={props.panel.receipt}
      record={props.panel.record}
      route={props.panel.route}
      sides={props.panel.sides}
      units={props.panel.units}
      onDone={() => {
        props.panel.receipt.closeRecord();
        if (props.panel.form.broughtIn()) {
          props.panel.form.setBroughtIn(false);
          void props.panel.navigate({
            to: "/project/$slug/suggestions",
            params: { slug: props.panel.shell.slug() },
          });
        }
      }}
    />
  );
}

export function ReviewPanel() {
  const shell = useShell();
  const navigate = useNavigate();
  const { services } = shell;
  const route = createReviewRoute(shell);
  onCleanup(
    claimSidebar(
      () => (
        <ChangesHistorySidebar active="changes" changes={0}>
          <p class="px-6 pt-3 text-small text-on-surface-tertiary">{t("Nothing differs.")}</p>
        </ChangesHistorySidebar>
      ),
      { show: m.sidebar_show_changes(), hide: m.sidebar_hide_changes() },
    ),
  );
  const [note, setNote] = createSignal("", { name: "reviewNote" });
  const [busy, setBusy] = createSignal("", { name: "reviewBusy" });
  const decisions = createDecisions();
  const sides = createSides({ shell, services, navigate, route, decisions, setNote, setBusy });
  const { leftShort, rightShort, leftLabel, rightLabel } = sides;
  const [sourcesOpen, setSourcesOpen] = createSignal(false, { name: "reviewSourcesOpen" });
  const [journals, setJournals] = createSignal<readonly Restorable[]>([], {
    name: "reviewJournals",
  });
  const [cardEditing, setCardEditing] = createSignal(false, { name: "reviewCardEditing" });
  const nameOf = (bookId: BookId): string => bookName(bookId, metadataOf(shell.project()));

  const parts = createPanelParts({
    shell,
    services,
    navigate,
    route,
    sides,
    decisions,
    setNote,
    nameOf,
  });
  const { compare, units } = parts;

  const settled = (): boolean => {
    const found = compare.result();
    return (
      found !== undefined &&
      found.changedBooks === 0 &&
      decisions.decisions().size > 0 &&
      !cardEditing() &&
      units.undecidedBoth() === 0
    );
  };

  watchRoute(route, decisions, sides);
  const lastBackup = createLastBackup(shell, services, compare, journals, setJournals);

  const emptySide = (): string | undefined => {
    const books = compare.result()?.books ?? [];
    if (books.length === 0) return undefined;
    if (books.every((book) => book.presence === "left")) return rightLabel();
    if (books.every((book) => book.presence === "right")) return leftLabel();
    return undefined;
  };

  const bookLabel = (book: BookComparison): string => {
    if (book.presence === "left")
      return t("{book} — only in {source}", { book: nameOf(book.bookId), source: leftShort() });
    if (book.presence === "right")
      return t("{book} — only in {source}", { book: nameOf(book.bookId), source: rightShort() });
    return nameOf(book.bookId);
  };

  const panel: PanelModel = {
    shell,
    navigate,
    route,
    sides,
    decisions,
    ...parts,
    sourcesOpen,
    setSourcesOpen,
    busy,
    note,
    cardEditing,
    setCardEditing,
    settled,
    emptySide,
    bookLabel,
    lastBackup,
  };

  return (
    <main class="flex h-full min-w-0 flex-col gap-2 px-4 pt-3 pb-2" data-review>
      <Show
        when={shell.project()}
        fallback={<EmptyState icon={<Scale size={22} />} title={t("Open a project first.")} />}
      >
        <ReviewHeaderView panel={panel} />

        <ReviewBodyView panel={panel} />

        <SaveDialogView panel={panel} />
      </Show>
    </main>
  );
}
