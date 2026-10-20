import type { BookId } from "@sefer/text/book";
import { useNavigate } from "@tanstack/solid-router";
import { Option } from "effect";
import Scale from "lucide-solid/icons/scale";
import { Show, createEffect, createSignal, onCleanup, untrack } from "solid-js";

import type { BookComparison } from "#core/compare";
import type { Restorable } from "#core/recovery/recovery";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { EmptyState, usePageLeading } from "../primitives";
import { bookName } from "../workspace/books";
import { ChangesHistorySidebar } from "../workspace/ChangesHistorySidebar";
import { metadataOf } from "../workspace/project";
import { claimSidebar } from "../workspace/sidebarSlot";
import { createCompare } from "./panel/createCompare";
import { createDecisions } from "./panel/createDecisions";
import { createReceipt } from "./panel/createReceipt";
import { createRecordAction } from "./panel/createRecordAction";
import { createReviewRoute } from "./panel/createReviewRoute";
import { createSaveForm } from "./panel/createSaveForm";
import { createSides } from "./panel/createSides";
import { createUnits } from "./panel/createUnits";
import { createWrites } from "./panel/createWrites";
import { ReviewBody } from "./panel/ReviewBody";
import { ReviewHeader } from "./panel/ReviewHeader";
import { SaveDialog } from "./panel/SaveDialog";

export function ReviewPanel() {
  const shell = useShell();
  const pageLeading = usePageLeading();
  const navigate = useNavigate();
  const { services } = shell;
  const route = createReviewRoute(shell);
  const { search } = route;
  onCleanup(
    claimSidebar(() => (
      <ChangesHistorySidebar active="changes" changes={0}>
        <p class="px-6 pt-3 text-small text-on-surface-tertiary">{t("Nothing differs.")}</p>
      </ChangesHistorySidebar>
    )),
  );
  const [note, setNote] = createSignal("", { name: "reviewNote" });
  const [busy, setBusy] = createSignal("", { name: "reviewBusy" });
  const decisions = createDecisions();
  const sides = createSides({ shell, services, navigate, route, decisions, setNote, setBusy });
  const { leftId, rightId, leftShort, rightShort, leftLabel, rightLabel, pick, seeShared } = sides;
  const [sourcesOpen, setSourcesOpen] = createSignal(false, { name: "reviewSourcesOpen" });
  const [journals, setJournals] = createSignal<readonly Restorable[]>([], {
    name: "reviewJournals",
  });
  const [cardEditing, setCardEditing] = createSignal(false, { name: "reviewCardEditing" });
  const nameOf = (bookId: BookId): string => bookName(bookId, metadataOf(shell.project()));

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

  const lastBackup = (): number | undefined => {
    let latest: number | undefined;
    for (const journal of journals())
      for (const entry of journal.entries)
        if (latest === undefined || entry.at > latest) latest = entry.at;
    return latest;
  };

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

  return (
    <main class="flex h-full min-w-0 flex-col gap-2 px-4 pt-3 pb-2" data-review>
      <Show
        when={shell.project()}
        fallback={<EmptyState icon={<Scale size={22} />} title={t("Open a project first.")} />}
      >
        <ReviewHeader
          pageLeading={pageLeading}
          sides={sides}
          compare={compare}
          decisions={decisions}
          form={form}
          sourcesOpen={sourcesOpen()}
          onSourcesOpenChange={setSourcesOpen}
          sourcesLabel={`${rightLabel()} → ${leftLabel()}`}
          busy={busy()}
          note={note()}
          lastBackup={lastBackup()}
        />

        <ReviewBody
          shell={shell}
          route={route}
          sides={sides}
          compare={compare}
          units={units}
          decisions={decisions}
          form={form}
          writes={writes}
          settled={settled()}
          cardEditing={cardEditing()}
          emptySide={emptySide()}
          bookLabel={bookLabel}
          usfm={shell.mode() === "usfm"}
          onUsfm={(on) => shell.setMode(on ? "usfm" : "default")}
          onEditing={setCardEditing}
        />

        <SaveDialog
          form={form}
          receipt={receipt}
          record={record}
          route={route}
          sides={sides}
          units={units}
          onDone={() => {
            receipt.closeRecord();
            if (form.broughtIn()) {
              form.setBroughtIn(false);
              void navigate({
                to: "/project/$slug/suggestions",
                params: { slug: shell.slug() },
              });
            }
          }}
        />
      </Show>
    </main>
  );
}
