import type { BookId } from "@wycliffeassociates/sefer-text/book";
import { Option } from "effect";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Trash2 from "lucide-solid/icons/trash-2";
import { For, Show, createMemo, createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";
import {
  headerOf,
  manifestNameOf,
  missingKeys,
  shortNameOf,
  type AddableKey,
  type BookHeader,
  type HeaderEdit,
  type HeaderLine,
  type ManifestName,
} from "#core/rules/bookNames";

import { runCommand } from "../../commands";
import { useShell } from "../../ProjectContext";
import { Button, Dialog, IconButton, Input, Select } from "../primitives";
import { bookName } from "../workspace/books";
import { metadataOf } from "../workspace/project";

/** One book in the dialog: its header as the parse read it when the dialog opened. */
interface Entry {
  readonly id: BookId;
  readonly name: string;
  readonly header: BookHeader;
  readonly listed: ManifestName;
}

/** What has been typed for one book: lines by id (an empty one is taken out), missing keys by key. */
interface Draft {
  readonly set: ReadonlyMap<string, string>;
  readonly add: ReadonlyMap<AddableKey, string>;
}

const EMPTY: Draft = { set: new Map(), add: new Map() };

/** A header line's label in the interface language; a marker with none is named by its spelling. */
const labelOf = (key: string, spelling: string): string => {
  const numbered = /^([a-z]+)(\d)$/.exec(key);
  const name = numbered?.[1] ?? key;
  const level = numbered?.[2] ?? "";
  switch (key) {
    case "h":
      return m.book_names_label_h();
    case "toc1":
      return m.book_names_label_toc1();
    case "toc2":
      return m.book_names_label_toc2();
    case "toc3":
      return m.book_names_label_toc3();
    case "toca1":
      return m.book_names_label_toca1();
    case "toca2":
      return m.book_names_label_toca2();
    case "toca3":
      return m.book_names_label_toca3();
    case "mt1":
      return m.book_names_label_mt1();
    case "id":
      return m.book_names_label_id();
    case "usfm":
      return m.book_names_label_usfm();
    case "ide":
      return m.book_names_label_ide();
    case "rem":
      return m.book_names_label_rem();
    case "sts":
      return m.book_names_label_sts();
    default:
      break;
  }
  if (name === "h") return m.book_names_label_h_other({ level });
  if (name === "mt") return m.book_names_label_mt({ level });
  if (name === "mte") return m.book_names_label_mte({ level });
  return m.book_names_label_marker({ marker: spelling });
};

/** What an addable key is written as, for a missing row's label. */
const SPELLED: Record<AddableKey, string> = {
  h: "h",
  toc1: "toc1",
  toc2: "toc2",
  toc3: "toc3",
  mt1: "mt",
};

/**
 * Book names: every book's names in one dialog, a book at a time (the
 * select and the arrows flick through them), opened from the main menu and
 * from a book's names mark. Each book shows the lines before its first `\c`
 * that name it (`headerOf`, core/rules/bookNames.ts): edit any, take any out
 * but `\id \usfm \ide`, and fill a missing `\h \toc1-3 \mt`. Save names is
 * one cross-book edit (`bookNames.save`), undone book by book. Writing the
 * project list from each book's short name on Record waits on bento's handle.
 */
export function BookNamesDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const shell = useShell();

  const entries = createMemo((): readonly Entry[] => {
    if (!props.open) return [];
    const project = shell.project();
    if (project === undefined) return [];
    const metadata = metadataOf(project);
    return project.books.flatMap((book) => {
      const held = shell.services.projectAnalysis.analysis(book.id);
      if (Option.isNone(held)) return [];
      const header = headerOf(held.value.analysis);
      return [
        {
          id: book.id,
          name: shortNameOf(header) ?? bookName(book.id, metadata),
          header,
          listed: manifestNameOf(metadata, book.id),
        },
      ];
    });
  });

  const [drafts, setDrafts] = createSignal<ReadonlyMap<BookId, Draft>>(new Map());
  const [chosen, setChosen] = createSignal<BookId | undefined>(shell.focused()?.id);

  const current = createMemo((): Entry | undefined => {
    const list = entries();
    const id = chosen();
    return list.find((entry) => entry.id === id) ?? list[0];
  });
  const position = (): number => {
    const at = current();
    return at === undefined ? -1 : entries().indexOf(at);
  };
  const step = (delta: 1 | -1): void => {
    const list = entries();
    const next = list[position() + delta];
    if (next !== undefined) setChosen(next.id);
  };

  const draftOf = (id: BookId): Draft => drafts().get(id) ?? EMPTY;
  const update = (id: BookId, change: (draft: Draft) => Draft): void => {
    setDrafts(new Map(drafts()).set(id, change(draftOf(id))));
  };
  const setLine = (id: BookId, line: HeaderLine, value: string): void => {
    update(id, (draft) => ({ ...draft, set: new Map(draft.set).set(line.id, value) }));
  };
  const setMissing = (id: BookId, key: AddableKey, value: string): void => {
    update(id, (draft) => ({ ...draft, add: new Map(draft.add).set(key, value) }));
  };

  /** The book's short name as it will read: its `\toc2`, else its `\h`, drafts included. */
  const shortAfter = (entry: Entry): string | undefined => {
    const valueFor = (key: "toc2" | "h"): string | undefined => {
      const draft = draftOf(entry.id);
      const line = entry.header.lines.find((each) => each.key === key);
      const typed = line === undefined ? draft.add.get(key) : draft.set.get(line.id);
      const value = (typed === undefined ? line?.value : typed)?.trim();
      return value === undefined || value === "" ? undefined : value;
    };
    return valueFor("toc2") ?? valueFor("h");
  };

  const changed = (draft: Draft, entry: Entry): boolean => {
    for (const line of entry.header.lines) {
      if (line.fixed || !draft.set.has(line.id)) continue;
      const value = draft.set.get(line.id);
      if (value?.trim() !== line.value) return true;
    }
    for (const value of draft.add.values()) if (value.trim() !== "") return true;
    return false;
  };
  const edits = createMemo((): ReadonlyMap<BookId, HeaderEdit> => {
    const out = new Map<BookId, HeaderEdit>();
    for (const entry of entries()) {
      const draft = drafts().get(entry.id);
      if (draft !== undefined && changed(draft, entry)) out.set(entry.id, draft);
    }
    return out;
  });

  const save = (): void => {
    const chosenEdits = edits();
    props.onOpenChange(false);
    if (chosenEdits.size > 0) runCommand("bookNames.save", chosenEdits);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={m.book_names_title()}
      description={m.book_names_description()}
      class="w-[min(40rem,92vw)]"
      footer={
        <>
          <Button variant="tertiary" onClick={() => props.onOpenChange(false)}>
            {m.common_cancel()}
          </Button>
          <Button
            variant="primary"
            disabled={edits().size === 0}
            data-testid="book-names-save"
            onClick={save}
          >
            {m.book_names_save()}
          </Button>
        </>
      }
    >
      <Show
        when={current()}
        fallback={<p class="text-on-surface-secondary">{m.book_names_none()}</p>}
      >
        {(entry) => (
          <div class="flex flex-col gap-3" data-book-names-book={entry().id}>
            <div class="flex items-center gap-controls">
              <IconButton
                size="sm"
                label={m.book_names_previous()}
                icon={<ChevronLeft />}
                disabled={position() <= 0}
                onClick={() => step(-1)}
              />
              <Select
                aria-label={m.book_names_position({
                  at: position() + 1,
                  count: entries().length,
                })}
                wrapperClass="flex-1"
                value={entry().id}
                onChange={(event) => setChosen(event.currentTarget.value)}
              >
                <For each={entries()}>
                  {(each) => (
                    <option value={each.id}>
                      {edits().has(each.id) ? `${each.name} •` : each.name}
                    </option>
                  )}
                </For>
              </Select>
              <IconButton
                size="sm"
                label={m.book_names_next()}
                icon={<ChevronRight />}
                disabled={position() >= entries().length - 1}
                onClick={() => step(1)}
              />
            </div>

            <Show when={entry().listed.listed && entry().listed.name !== shortAfter(entry())}>
              <p class="text-on-surface-secondary" data-testid="book-names-listed">
                {entry().listed.name === undefined
                  ? m.book_names_listed_none()
                  : m.book_names_listed_as({ name: entry().listed.name ?? "" })}
              </p>
            </Show>

            <div class="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
              <For each={entry().header.lines}>
                {(line) => {
                  const label = (): string => labelOf(line.key, line.spelling);
                  const value = (): string => {
                    const typed = draftOf(entry().id).set.get(line.id);
                    return typed === undefined ? line.value : (typed ?? "");
                  };
                  return (
                    <div class="grid grid-cols-[10rem_1fr_auto] items-center gap-controls">
                      <span class="text-on-surface-secondary">{label()}</span>
                      <Show
                        when={!line.fixed}
                        fallback={<span class="px-3 py-2">{line.value}</span>}
                      >
                        <Input
                          aria-label={label()}
                          data-book-names-line={line.id}
                          placeholder={m.book_names_empty()}
                          value={value()}
                          onInput={(event) => setLine(entry().id, line, event.currentTarget.value)}
                        />
                      </Show>
                      <Show when={!line.fixed && value() !== ""} fallback={<span />}>
                        <IconButton
                          size="sm"
                          label={m.book_names_remove({ label: label() })}
                          icon={<Trash2 />}
                          onClick={() => setLine(entry().id, line, "")}
                        />
                      </Show>
                    </div>
                  );
                }}
              </For>
              <For each={missingKeys(entry().header)}>
                {(key) => (
                  <div class="grid grid-cols-[10rem_1fr_auto] items-center gap-controls">
                    <span class="text-on-surface-secondary">{labelOf(key, SPELLED[key])}</span>
                    <Input
                      aria-label={labelOf(key, SPELLED[key])}
                      data-book-names-missing={key}
                      placeholder={m.book_names_empty()}
                      value={draftOf(entry().id).add.get(key) ?? ""}
                      onInput={(event) => setMissing(entry().id, key, event.currentTarget.value)}
                    />
                    <span />
                  </div>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
    </Dialog>
  );
}
