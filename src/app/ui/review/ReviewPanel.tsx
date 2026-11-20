import type { JSX } from "@solidjs/web";
import { useNavigate } from "@tanstack/solid-router";
import type { BookId } from "@wycliffeassociates/sefer-text/book";
import Scale from "lucide-solid/icons/scale";
import { Show, createEffect, createSignal, untrack, type Accessor } from "solid-js";

import type { BookComparison } from "#core/compare";

import { m } from "../../paraglide/messages";
import { useShell, type Navigate, type Shell } from "../../ProjectContext";
import type { Services } from "../../services";
import { EmptyState, cx } from "../primitives";
import { bookName } from "../workspace/books";
import { metadataOf } from "../workspace/project";
import { createCompare, type Compare } from "./panel/createCompare";
import { createDecisions, type Decisions } from "./panel/createDecisions";
import { createReceipt, type Receipt } from "./panel/createReceipt";
import { createRecordAction, type RecordAction } from "./panel/createRecordAction";
import { createReviewRoute, type ReviewRoute } from "./panel/createReviewRoute";
import { createSaveForm, type SaveForm } from "./panel/createSaveForm";
import { createSides, type Sides } from "./panel/createSides";
import { createUnits, type Units } from "./panel/createUnits";
import { createWrites, type Writes } from "./panel/createWrites";
import { designReviewStates, type ReviewLayout } from "./panel/designStates";
import { ReviewBody } from "./panel/ReviewBody";
import { ReviewHeader, type ReviewReason } from "./panel/ReviewHeader";
import { SaveDialog } from "./panel/SaveDialog";

type InlineView = (props: { readonly panel: PanelModel }) => JSX.Element;

export interface PanelModel {
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
  readonly busy: Accessor<string>;
  readonly note: Accessor<string>;
  readonly cardEditing: Accessor<boolean>;
  readonly setCardEditing: (editing: boolean) => void;
  readonly settled: () => boolean;
  readonly emptySide: () => string | undefined;
  readonly bookLabel: (book: BookComparison) => string;
  /** DESIGN SCAFFOLDING: the header's title or actions, for a layout that places them itself. */
  readonly header: (part: "title" | "actions", saveReady?: () => boolean) => JSX.Element;
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
  const writes = createWrites({
    shell,
    services,
    sides,
    decisions,
    units,
    setNote,
    onWritten: compare.patchLive,
  });
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

function reasonOf(panel: PanelModel): ReviewReason {
  if (panel.route.pull() !== undefined) return "suggestion";
  if (panel.route.fromCopy()) return "copy";
  if (panel.sides.againstShared()) return "incoming";
  if (panel.sides.againstWriter()) return "writer";
  const ids = new Set([panel.sides.leftId(), panel.sides.rightId()]);
  return ids.has("project") && ids.has("disk") ? "unsaved" : "other";
}

function ReviewHeaderView(props: {
  readonly panel: PanelModel;
  readonly part?: "title" | "actions";
  readonly saveReady?: () => boolean;
}) {
  return (
    <ReviewHeader
      sides={props.panel.sides}
      compare={props.panel.compare}
      decisions={props.panel.decisions}
      form={props.panel.form}
      busy={props.panel.busy()}
      note={props.panel.note()}
      reason={reasonOf(props.panel)}
      changes={props.panel.compare.result() === undefined ? 0 : props.panel.units.totals().total}
      books={props.panel.compare.result()?.changedBooks ?? 0}
      part={props.part}
      saveReady={props.saveReady?.()}
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
  const [note, setNote] = createSignal("", { name: "reviewNote" });
  const [busy, setBusy] = createSignal("", { name: "reviewBusy" });
  const decisions = createDecisions();
  const sides = createSides({ shell, services, navigate, route, decisions, setNote, setBusy });
  const { leftShort, rightShort, leftLabel, rightLabel } = sides;
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
  // DESIGN SCAFFOLDING: the inline layout under trial, loaded only into a design build.
  const [layout, setLayout] = createSignal<ReviewLayout>("cards", {
    name: "reviewLayout",
    ownedWrite: true,
  });
  const [inline, setInline] = createSignal<InlineView | undefined>(undefined, {
    name: "reviewInlineView",
    ownedWrite: true,
  });
  if (__SEFER_DESIGN__) {
    designReviewStates({ shell, route, sides, compare, units, decisions, setLayout });
    void import("#dev/review/InlineReview").then((module) => setInline(() => module.InlineReview));
  }

  const emptySide = (): string | undefined => {
    const books = compare.result()?.books ?? [];
    if (books.length === 0) return undefined;
    if (books.every((book) => book.presence === "left")) return rightLabel();
    if (books.every((book) => book.presence === "right")) return leftLabel();
    return undefined;
  };

  const bookLabel = (book: BookComparison): string => {
    if (book.presence === "left")
      return m.review_book_only_in_source({ book: nameOf(book.bookId), source: leftShort() });
    if (book.presence === "right")
      return m.review_book_only_in_source({ book: nameOf(book.bookId), source: rightShort() });
    return nameOf(book.bookId);
  };

  const panel: PanelModel = {
    shell,
    navigate,
    route,
    sides,
    decisions,
    ...parts,
    busy,
    note,
    cardEditing,
    setCardEditing,
    settled,
    emptySide,
    bookLabel,
    header: (part, saveReady) => (
      <ReviewHeaderView panel={panel} part={part} saveReady={saveReady} />
    ),
  };

  return (
    <main
      class={cx(
        "flex h-full min-w-0 flex-col gap-2 px-4 pt-3 pb-2",
        // DESIGN SCAFFOLDING: the inline layout sits on the canvas, the text and cards on it.
        layout() === "inline" && "bg-surface-canvas",
      )}
      data-review
    >
      <Show
        when={shell.project()}
        fallback={<EmptyState icon={<Scale size={22} />} title={m.common_open_a_project_first()} />}
      >
        <Show when={layout() !== "inline" || inline() === undefined}>
          <ReviewHeaderView panel={panel} />
        </Show>

        <Show
          when={layout() === "inline" ? inline() : undefined}
          fallback={<ReviewBodyView panel={panel} />}
          keyed
        >
          {(View) => untrack(() => View({ panel }))}
        </Show>

        <SaveDialogView panel={panel} />
      </Show>
    </main>
  );
}
