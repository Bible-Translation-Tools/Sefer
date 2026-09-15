/**
 * `/compare` — two sources, a decision per difference, one Apply.
 *
 * The shape is the proto's DiffModal reduced to what our model supports: a
 * source picker, a book list with change counts and one-sided badges, and the
 * selected book's hunks with a side to choose. What it deliberately does NOT
 * have is a second idea of what a comparison is — every count, every merged
 * text and every refusal below is read from `src/core/compare`, so the screen
 * cannot disagree with what Apply will do.
 *
 * Two rules this file keeps:
 *
 *  - NEITHER SIDE IS SPECIAL. The left side happens to default to the open
 *    project because that is the only writable source, but it arrives through
 *    the same `SourceChoice` table (`sources.ts`) as the right, and Apply is
 *    offered because `result.left.canApply` says so — not because the code
 *    knows what is over there.
 *  - NOTHING IS WRITTEN UNTIL APPLY. Clicking a side edits a `Map`. Apply
 *    projects that map once, names the books it is about to write in a
 *    confirmation, and then writes them through `book.apply` — one apply per
 *    book, so Undo takes back a book at a time.
 */

import { createMemo, createSignal, For, Show } from "solid-js";

import type { BookId } from "../../../core/book/book";
import {
  applyPlan,
  bookCompleteness,
  bookComparison,
  compareBooks,
  completeness,
  decide,
  decideMany,
  decisionIds,
  plan,
  noDecisions,
  type BookComparison,
  type CompareResult,
  type CompareSource,
  type Decision,
  type Decisions,
} from "../../../core/compare";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  PanelHeader,
  Select,
  cx,
  toasts,
} from "../primitives";
import { BookReview } from "./BookReview";
import { describe, sourceChoices, type SourceChoice } from "./sources";

/** Adding or removing a whole book is refused by `applyPlan`; see compare.md. */
const CANNOT_ADD_OR_REMOVE = true;

/** The first book worth looking at: the first that differs. */
const firstChanged = (result: CompareResult): BookId | undefined =>
  result.books.find((book) => !book.identical)?.bookId;

export function ComparePanel() {
  const shell = useShell();
  const { services } = shell;

  const [rightKind, setRightKind] = createSignal("zip", { name: "compareRightKind" });
  const [right, setRight] = createSignal<CompareSource | undefined>(undefined, {
    name: "compareRight",
  });
  const [result, setResult] = createSignal<CompareResult | undefined>(undefined, {
    name: "compareResult",
  });
  const [decisions, setDecisions] = createSignal<Decisions>(noDecisions, {
    name: "compareDecisions",
  });
  const [selected, setSelected] = createSignal<BookId | undefined>(undefined, {
    name: "compareSelected",
  });
  const [busy, setBusy] = createSignal("", { name: "compareBusy" });
  const [note, setNote] = createSignal("", { name: "compareNote" });
  /**
   * What the last Apply did. Kept apart from `note` because the re-comparison
   * Apply triggers clears `note` — and the one line saying which books were
   * written is the receipt, the only lasting evidence on the screen that the
   * write happened at all.
   */
  const [receipt, setReceipt] = createSignal("", { name: "compareReceipt" });
  const [confirming, setConfirming] = createSignal(false, { name: "compareConfirming" });

  const choices = (): readonly SourceChoice[] => sourceChoices(services, shell.project());
  const rightChoices = (): readonly SourceChoice[] =>
    choices().filter((choice) => choice.sides.includes("right"));
  const leftChoices = (): readonly SourceChoice[] =>
    choices().filter((choice) => choice.sides.includes("left"));

  /**
   * The left side, from the same table the right side comes from. A memo, so
   * the comparison and the Apply target are the SAME source object for as long
   * as the project is: `currentProjectSource` reads through `project.book(id)`
   * on every call, so it stays correct across an instantiate, but there is no
   * reason to mint a new one per render.
   */
  const left = createMemo<CompareSource | undefined>(() => {
    void shell.project();
    return leftChoices()[0]?.immediate?.();
  });

  const chosenRight = (): SourceChoice | undefined =>
    rightChoices().find((choice) => choice.id === rightKind());

  const pickRight = (): void => {
    const choice = chosenRight();
    if (choice?.pick === undefined) return;
    setNote("");
    setBusy(t("Reading the other side…"));
    void choice
      .pick()
      .then((source) => {
        setBusy("");
        if (source === undefined) return;
        setRight(source);
        setResult(undefined);
        setDecisions(noDecisions);
        setReceipt("");
      })
      .catch((cause: unknown) => {
        setBusy("");
        setNote(describe(cause));
      });
  };

  const runCompare = (): void => {
    const leftSource = left();
    const rightSource = right();
    if (leftSource === undefined || rightSource === undefined) return;
    setNote("");
    setBusy(t("Comparing…"));
    void services
      .run(compareBooks(leftSource, rightSource))
      .then((found) => {
        setBusy("");
        setResult(found);
        setDecisions(noDecisions);
        setSelected(firstChanged(found));
      })
      .catch((cause: unknown) => {
        setBusy("");
        setNote(describe(cause));
      });
  };

  const current = (): BookComparison | undefined => {
    const found = result();
    const bookId = selected();
    return found === undefined || bookId === undefined ? undefined : bookComparison(found, bookId);
  };

  const totals = () => {
    const found = result();
    return found === undefined ? undefined : completeness(found, decisions());
  };

  const currentPlan = () => {
    const found = result();
    return found === undefined ? undefined : plan(found, decisions(), "left");
  };

  const writable = (): boolean => result()?.left.canApply === true;

  const decideOne = (id: string, decision: Decision): void => {
    setDecisions(decide(decisions(), id, decision));
  };

  /**
   * Bulk stamps address every HUNK in scope and never a one-sided book: a book
   * that exists on one side only is a structural change, and the proto's rule
   * — that a whole-book add or removal is always reviewed explicitly — is the
   * right one to keep.
   */
  const stampBook = (book: BookComparison, decision: Decision): void => {
    if (book.presence !== "both") return;
    setDecisions(decideMany(decisions(), decisionIds(book), decision));
  };

  const stampAll = (decision: Decision): void => {
    const found = result();
    if (found === undefined) return;
    const ids = found.books
      .filter((book) => !book.identical && book.presence === "both")
      .flatMap((book) => decisionIds(book));
    setDecisions(decideMany(decisions(), ids, decision));
  };

  const apply = (): void => {
    const target = left();
    const projected = currentPlan();
    const rightSource = right();
    if (target === undefined || projected === undefined || rightSource === undefined) return;
    setConfirming(false);
    setBusy(t("Applying…"));
    const toast = toasts.progress({ title: t("Applying to this project") });
    void services
      .run(applyPlan(projected, target))
      .then((report) => {
        shell.bump();
        toasts.update(toast, {
          title: t("Applied to this project"),
          message:
            report.written.length === 0
              ? t("Nothing needed writing")
              : t("Written: {books}", { books: report.written.join(", ") }),
          tone: "success",
        });
        setReceipt(
          report.written.length === 0
            ? t("Applied: nothing needed writing.")
            : t("Applied to {books}.", { books: report.written.join(", ") }),
        );
        // The left side just moved, so the frozen comparison is history. Take
        // a fresh one rather than leaving offsets on screen that now describe
        // the text before the write.
        runCompare();
      })
      .catch((cause: unknown) => {
        setBusy("");
        const message = describe(cause);
        setNote(message);
        toasts.update(toast, { title: t("Apply refused"), message, tone: "error" });
      });
  };

  return (
    <main class="min-w-0 space-y-4 p-6" data-compare>
      <PanelHeader
        title={t("Compare")}
        subtitle={t("Put this project beside another copy and choose what it keeps.")}
      />

      <Card class="space-y-3">
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1">
            <span class="text-smallest font-medium text-on-surface-tertiary">{t("Left")}</span>
            <p class="text-small font-semibold text-on-surface-primary" data-compare-left>
              {left()?.label ?? t("No project is open")}
            </p>
            <p class="text-smallest text-on-surface-tertiary">
              {t("The books as they are right now, including unsaved edits.")}
            </p>
          </div>

          <div class="space-y-1">
            <span class="text-smallest font-medium text-on-surface-tertiary">{t("Right")}</span>
            <div class="flex items-center gap-2">
              <Select
                size="sm"
                wrapperClass="min-w-0"
                aria-label={t("What to compare against")}
                value={rightKind()}
                onChange={(event) => setRightKind(event.currentTarget.value)}
              >
                <For each={rightChoices()}>
                  {(choice) => (
                    <option value={choice.id} disabled={!choice.available}>
                      {choice.label}
                    </option>
                  )}
                </For>
              </Select>
              <Button size="sm" onClick={pickRight} disabled={chosenRight()?.available !== true}>
                {right() === undefined ? t("Choose…") : t("Change…")}
              </Button>
            </div>
            <p class="text-smallest text-on-surface-tertiary" data-compare-right>
              {right()?.label ?? chosenRight()?.explainer ?? ""}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <Button
            variant="primary"
            onClick={runCompare}
            disabled={left() === undefined || right() === undefined || busy() !== ""}
            loading={busy() === t("Comparing…")}
          >
            {t("Compare")}
          </Button>
          <Show when={busy() !== ""}>
            <span class="text-smallest text-on-surface-tertiary">{busy()}</span>
          </Show>
          <Show when={note() !== ""}>
            <span class="text-smallest text-on-surface-secondary" data-compare-note>
              {note()}
            </span>
          </Show>
        </div>
      </Card>

      <Show
        when={result()}
        fallback={
          <Card>
            <EmptyState
              title={t("Nothing compared yet.")}
              description={t(
                "Choose a zip or a folder on the right, then press Compare. Nothing is written until you apply.",
              )}
            />
          </Card>
        }
      >
        {(found) => (
          <>
            <Card class="flex flex-wrap items-center gap-2" data-compare-summary>
              <Badge tone="brand">
                {t("{count} books differ", { count: found().changedBooks })}
              </Badge>
              <Badge tone="warning">{t("{count} only here", { count: found().leftOnly })}</Badge>
              <Badge tone="success">{t("{count} only there", { count: found().rightOnly })}</Badge>
              <span class="text-small text-on-surface-secondary" data-compare-decided>
                {t("{decided} decided of {total}", {
                  decided: totals()?.decided ?? 0,
                  total: totals()?.total ?? 0,
                })}
              </span>
              <div class="ms-auto flex items-center gap-1">
                <Button size="sm" variant="tertiary" onClick={() => stampAll("left")}>
                  {t("Keep all left")}
                </Button>
                <Button size="sm" variant="tertiary" onClick={() => stampAll("right")}>
                  {t("Take all right")}
                </Button>
                <Button size="sm" variant="tertiary" onClick={() => stampAll("undecided")}>
                  {t("Clear")}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  data-compare-apply
                  disabled={
                    !writable() ||
                    totals()?.complete !== true ||
                    (currentPlan()?.writes.length ?? 0) === 0 ||
                    busy() !== ""
                  }
                  onClick={() => setConfirming(true)}
                >
                  {t("Apply to this project")}
                </Button>
              </div>
            </Card>

            <div class="flex flex-wrap items-center gap-3">
              <Show when={receipt() !== ""}>
                <p class="text-small text-on-surface-success" data-compare-receipt>
                  {receipt()}
                </p>
              </Show>
              <p class="text-smallest text-on-surface-tertiary">
                {t("{label} is only read; Apply writes into this project.", {
                  label: found().right.label,
                })}
              </p>
            </div>

            <div class="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
              <Card padded={false} class="overflow-hidden">
                <h2 class="border-b border-surface-border px-3 py-2 text-smallest font-semibold uppercase tracking-wide text-on-surface-tertiary">
                  {t("Books")}
                </h2>
                <ul class="max-h-[32rem] overflow-y-auto">
                  <For each={found().books}>
                    {(book) => {
                      const done = () => bookCompleteness(book, decisions());
                      return (
                        <li>
                          <button
                            type="button"
                            data-compare-book={book.bookId}
                            data-presence={book.presence}
                            data-changes={book.identical ? 0 : book.decisions}
                            aria-current={selected() === book.bookId ? "true" : undefined}
                            class={cx(
                              "flex w-full items-center gap-2 border-b border-surface-border px-3 py-2 text-start text-small",
                              selected() === book.bookId
                                ? "bg-brand-light font-semibold text-brand"
                                : "text-on-surface-secondary hover:bg-surface-secondary",
                            )}
                            onClick={() => setSelected(book.bookId)}
                          >
                            <span class="min-w-0 flex-1 truncate">{book.bookId}</span>
                            <Show when={book.presence === "left"}>
                              <Badge tone="warning" size="sm">
                                {t("only here")}
                              </Badge>
                            </Show>
                            <Show when={book.presence === "right"}>
                              <Badge tone="success" size="sm">
                                {t("only there")}
                              </Badge>
                            </Show>
                            <Show when={book.presence === "both"}>
                              <span class="shrink-0 text-smallest tabular-nums text-on-surface-tertiary">
                                {book.identical
                                  ? t("same")
                                  : t("{decided}/{total}", {
                                      decided: done().decided,
                                      total: done().total,
                                    })}
                              </span>
                            </Show>
                          </button>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </Card>

              <div class="min-w-0 space-y-2" data-compare-hunks>
                <Show
                  when={current()}
                  fallback={
                    <Card>
                      <EmptyState title={t("Choose a book to review.")} />
                    </Card>
                  }
                >
                  {(book) => (
                    <>
                      <div class="flex flex-wrap items-center gap-2">
                        <h2 class="text-small font-semibold text-on-surface-primary">
                          {book().bookId}
                        </h2>
                        <span class="text-smallest text-on-surface-tertiary">
                          {t("{decided} decided of {total}", {
                            decided: bookCompleteness(book(), decisions()).decided,
                            total: bookCompleteness(book(), decisions()).total,
                          })}
                        </span>
                        <Show when={book().presence === "both" && !book().identical}>
                          <div class="ms-auto flex items-center gap-1">
                            <span class="text-smallest text-on-surface-tertiary">
                              {t("Whole book:")}
                            </span>
                            <Button
                              size="sm"
                              variant="tertiary"
                              onClick={() => stampBook(book(), "left")}
                            >
                              {t("Keep left")}
                            </Button>
                            <Button
                              size="sm"
                              variant="tertiary"
                              onClick={() => stampBook(book(), "right")}
                            >
                              {t("Take right")}
                            </Button>
                          </div>
                        </Show>
                      </div>
                      <BookReview
                        book={book()}
                        decisions={decisions()}
                        leftLabel={found().left.label}
                        rightLabel={found().right.label}
                        cannotAdd={CANNOT_ADD_OR_REMOVE}
                        onDecide={decideOne}
                      />
                    </>
                  )}
                </Show>
              </div>
            </div>

            <Dialog
              open={confirming()}
              onOpenChange={setConfirming}
              title={t("Apply to this project")}
              description={t("These books will be written. Each one is a single Undo step.")}
              footer={
                <>
                  <Button variant="tertiary" onClick={() => setConfirming(false)}>
                    {t("Cancel")}
                  </Button>
                  <Button variant="primary" onClick={apply} data-compare-confirm>
                    {t("Apply")}
                  </Button>
                </>
              }
            >
              <ul class="space-y-1">
                <For each={currentPlan()?.writes ?? []}>
                  {(book) => (
                    <li class="flex items-center gap-2 text-small">
                      <Badge tone={book.operation === "write" ? "warning" : "error"} size="sm">
                        {book.operation === "write"
                          ? t("rewritten")
                          : book.operation === "add"
                            ? t("added")
                            : t("removed")}
                      </Badge>
                      <span class="font-medium">{book.bookId}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Dialog>
          </>
        )}
      </Show>
    </main>
  );
}
