import type { JSX } from "@solidjs/web";
import CloudIcon from "lucide-solid/icons/cloud";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import { Show } from "solid-js";

import { m } from "#app/paraglide/messages";
import type { IncomingPlan, Sync } from "#core/sync";

import { useShell } from "../../ProjectContext";
import { syncWatch } from "../../syncWatch";
import { writerWatch } from "../../writerWatch";
import { ago } from "../panels/format";
import { Button, IconButton, cx } from "../primitives";
import { attentionOf, createQuickSync, quickActionOf, type QuickSync, quickLabel } from "./quick";

export interface ComparisonCount {
  readonly changes: number;
  readonly books: number;
  readonly decided: number;
}

const comparisonWords = (count: ComparisonCount): string => {
  if (count.changes === 0) return m.cloud_no_differences();
  const changes = m.common_count_changes({ count: count.changes });
  const books = m.common_count_books({ count: count.books });
  const said = m.common_changes_in_books({ changes, books });
  return count.decided === 0
    ? said
    : m.cloud_said_decided_decided({ said, decided: count.decided });
};

const toReceiveWords = (books: number, verses: number): string => {
  if (books === 0) return m.cloud_has_changes_you_dont_have();
  if (verses === 0)
    return m.cloud_books_to_receive({ books: m.common_count_books({ count: books }) });
  return m.cloud_verses_in_books_to_receive({
    verses: m.common_count_verses({ count: verses }),
    books: m.common_count_books({ count: books }),
  });
};

const sharedWords = (sync: Sync, plan: IncomingPlan | undefined): string => {
  switch (sync.state) {
    case "offline":
      return m.cloud_offline_your_saved_changes_stay();
    case "unauthorized":
      return m.cloud_sign_in_to_send_your();
    case "checking":
      return m.cloud_checking();
    case "conflicted":
      return m.cloud_a_transfer_did_not_finish();
    default:
      break;
  }
  const parts: string[] = [];
  if (sync.clocks.shared.unshared > 0) {
    const books = plan === undefined ? 0 : plan.books.length;
    const verses = plan?.verseCount ?? 0;
    parts.push(toReceiveWords(books, verses));
  }
  if (sync.clocks.local.unshared > 0) parts.push(m.cloud_your_saved_changes_arent_sent());
  return parts.length === 0 ? m.cloud_up_to_date() : parts.join(" · ");
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

const moveOf = (held: Sync, seeing: boolean) => {
  const action = quickActionOf(held);
  if (action === "check") return undefined;
  if (action === "see" && seeing) return undefined;
  return action;
};

const SharedZone = (props: {
  readonly held: Sync;
  readonly plan: IncomingPlan | undefined;
  readonly checkedAt: number | undefined;
  readonly quick: QuickSync;
  readonly seeing: boolean;
}) => (
  <Zone
    label={m.cloud_shared_project()}
    icon={<CloudIcon size={14} aria-hidden="true" />}
    attention={attentionOf(props.held) === "alert"}
    data="shared"
  >
    <span data-sync-line={props.held.state}>{sharedWords(props.held, props.plan)}</span>
    <span class="inline-flex items-center gap-0.5 text-on-surface-tertiary">
      <Show when={props.checkedAt}>
        {(at) => <span>{m.cloud_checked_when({ when: ago(at()) })}</span>}
      </Show>
      <IconButton
        size="sm"
        label={m.cloud_check_for_changes()}
        disabled={props.quick.busy() !== ""}
        icon={<RefreshCw class={cx(props.quick.busy() === "check" && "animate-spin")} />}
        onClick={() => props.quick.run("check")}
      />
    </span>
    <Show when={moveOf(props.held, props.seeing)}>
      {(action) => (
        <Button
          size="sm"
          variant="link"
          loading={props.quick.busy() !== "" && props.quick.busy() !== "check"}
          data-sync-line-action={action()}
          onClick={() => props.quick.run(action())}
        >
          {quickLabel(action())}
        </Button>
      )}
    </Show>
  </Zone>
);

const WriterZone = (props: {
  readonly count: number;
  readonly seeing: boolean;
  readonly onSee: () => void;
}) => (
  <Zone label={m.common_writer()} attention={!props.seeing} data="writer">
    <span>
      {m.cloud_new_work_in_books({
        books: m.common_count_books({ count: props.count }),
      })}
    </span>
    <Show when={!props.seeing}>
      <Button size="sm" variant="link" onClick={props.onSee}>
        {m.cloud_see_it()}
      </Button>
    </Show>
  </Zone>
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
          <SharedZone
            held={held()}
            plan={syncWatch.facts(root())?.plan}
            checkedAt={checkedAt()}
            quick={quick}
            seeing={props.seeing}
          />
        )}
      </Show>

      <Show when={writer().work.length > 0}>
        <WriterZone
          count={writer().work.length}
          seeing={props.seeingWriter}
          onSee={() => props.onSeeWriter()}
        />
      </Show>
    </div>
  );
}
