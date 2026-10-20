import type { JSX } from "@solidjs/web";
import CloudIcon from "lucide-solid/icons/cloud";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import { Show } from "solid-js";

import type { IncomingPlan, Sync } from "#core/sync";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { syncWatch } from "../../syncWatch";
import { writerWatch } from "../../writerWatch";
import { ago } from "../panels/format";
import { Button, IconButton, cx } from "../primitives";
import { attentionOf, createQuickSync, quickActionOf, quickLabel } from "./quick";

export interface ComparisonCount {
  readonly changes: number;
  readonly books: number;
  readonly decided: number;
}

const plural = (count: number, one: string, many: string): string =>
  t(count === 1 ? one : many, { count });

const comparisonWords = (count: ComparisonCount): string => {
  if (count.changes === 0) return t("No differences");
  const changes = plural(count.changes, "{count} change", "{count} changes");
  const books = plural(count.books, "{count} book", "{count} books");
  const said = t("{changes} in {books}", { changes, books });
  return count.decided === 0
    ? said
    : t("{said} · {decided} decided", { said, decided: count.decided });
};

const toReceiveWords = (books: number, verses: number): string => {
  if (books === 0) return t("has changes you don't have yet");
  if (verses === 0)
    return t("{books} to receive", { books: plural(books, "{count} book", "{count} books") });
  return t("{verses} in {books} to receive", {
    verses: plural(verses, "{count} verse", "{count} verses"),
    books: plural(books, "{count} book", "{count} books"),
  });
};

const sharedWords = (sync: Sync, plan: IncomingPlan | undefined): string => {
  switch (sync.state) {
    case "offline":
      return t("offline — your saved changes stay here until you're back");
    case "unauthorized":
      return t("sign in to send your changes");
    case "checking":
      return t("checking…");
    case "conflicted":
      return t("a transfer did not finish");
    default:
      break;
  }
  const parts: string[] = [];
  if (sync.clocks.shared.unshared > 0) {
    const books = plan === undefined ? 0 : plan.books.length;
    const verses = plan?.verseCount ?? 0;
    parts.push(toReceiveWords(books, verses));
  }
  if (sync.clocks.local.unshared > 0) parts.push(t("your saved changes aren't sent yet"));
  return parts.length === 0 ? t("up to date") : parts.join(" · ");
};

const Zone = (props: {
  readonly label: string;
  readonly icon?: JSX.Element;
  readonly attention?: boolean;
  readonly children: JSX.Element;
  readonly data?: string;
}) => (
  <span
    class="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
    data-review-zone={props.data}
  >
    <span class="inline-flex items-center gap-1.5 text-on-surface-tertiary">
      {props.icon}
      {props.label}
      <Show when={props.attention}>
        <span aria-hidden="true" class="size-1.5 rounded-full bg-on-surface-warning" />
      </Show>
    </span>
    {props.children}
  </span>
);

export function SyncLine(props: {
  readonly comparison: ComparisonCount | undefined;
  readonly onSee: () => void;
  readonly seeing: boolean;
  readonly onSeeWriter: () => void;
  readonly seeingWriter: boolean;
}) {
  const shell = useShell();
  const quick = createQuickSync(shell, () => props.onSee());
  const root = (): string | undefined => shell.project()?.root;
  const sync = (): Sync | undefined => {
    const held = quick.sync();
    return held !== undefined && held.reading.origin !== undefined ? held : undefined;
  };
  const checkedAt = (): number | undefined => {
    const at = root();
    return at === undefined ? undefined : syncWatch.fetchedAt(at);
  };
  const writer = () => writerWatch.facts(root());
  const move = (held: Sync) => {
    const action = quickActionOf(held);
    if (action === "check") return undefined;
    if (action === "see" && props.seeing) return undefined;
    return action;
  };

  return (
    <div
      class="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1 text-smallest text-on-surface-secondary"
      data-review-status
    >
      <Show when={props.comparison}>
        {(count) => (
          <span class="tabular-nums" data-review-decided data-review-changed={count().books}>
            {comparisonWords(count())}
          </span>
        )}
      </Show>

      <Show when={sync()}>
        {(held) => (
          <Zone
            label={t("Shared project")}
            icon={<CloudIcon size={14} aria-hidden="true" />}
            attention={attentionOf(held()) === "alert"}
            data="shared"
          >
            <span data-sync-line={held().state}>
              {sharedWords(held(), syncWatch.facts(root())?.plan)}
            </span>
            <span class="inline-flex items-center gap-0.5 text-on-surface-tertiary">
              <Show when={checkedAt()}>
                {(at) => <span>{t("checked {when}", { when: ago(at()) })}</span>}
              </Show>
              <IconButton
                size="sm"
                label={t("Check for changes")}
                disabled={quick.busy() !== ""}
                icon={<RefreshCw class={cx(quick.busy() === "check" && "animate-spin")} />}
                onClick={() => quick.run("check")}
              />
            </span>
            <Show when={move(held())}>
              {(action) => (
                <Button
                  size="sm"
                  variant="link"
                  loading={quick.busy() !== "" && quick.busy() !== "check"}
                  data-sync-line-action={action()}
                  onClick={() => quick.run(action())}
                >
                  {quickLabel(action())}
                </Button>
              )}
            </Show>
          </Zone>
        )}
      </Show>

      <Show when={writer().work.length > 0}>
        <Zone label={t("Writer")} attention={!props.seeingWriter} data="writer">
          <span>
            {t("new work in {books}", {
              books: plural(writer().work.length, "{count} book", "{count} books"),
            })}
          </span>
          <Show when={!props.seeingWriter}>
            <Button size="sm" variant="link" onClick={() => props.onSeeWriter()}>
              {t("See it")}
            </Button>
          </Show>
        </Zone>
      </Show>
    </div>
  );
}
