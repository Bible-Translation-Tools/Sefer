import type { BookId } from "@sefer/text/book";
import { Option } from "effect";
import { For, Show, createMemo, createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";
import {
  chapterLabelsOf,
  keptAsWritten,
  wordsOf,
  type ChapterLabel,
} from "#core/rules/chapterLabels";

import { runCommand } from "../../commands";
import { useShell } from "../../ProjectContext";
import { Button, Dialog, Input, Select } from "../primitives";
import { bookName } from "../workspace/books";
import { metadataOf } from "../workspace/project";

/** One book with chapter labels: the words it puts beside its numbers, and the labels it writes its own way. */
interface Row {
  readonly id: BookId;
  readonly name: string;
  readonly words: readonly (readonly [string, number])[];
  readonly kept: readonly ChapterLabel[];
}

/** The select's two values that are not a word. */
const LEAVE = "";
const OTHER = "\u0000other";

/**
 * Chapter labels, per book: opened from a chapter's title. Each book with
 * labels is a row: leave it, or pick the word its chapters should read (its
 * own words, most used first, or another), and Standardize makes each chosen
 * book one book label with that word (`chapterLabels.standardize`). Labels a
 * book writes its own way ("Psalm One") are listed under it and never changed.
 */
export function ChapterLabelsDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const shell = useShell();
  const rows = createMemo((): readonly Row[] => {
    if (!props.open) return [];
    const project = shell.project();
    if (project === undefined) return [];
    const metadata = metadataOf(project);
    return project.books.flatMap((book) => {
      const held = shell.services.projectAnalysis.analysis(book.id);
      if (Option.isNone(held)) return [];
      const labels = chapterLabelsOf(held.value.analysis);
      if (labels.labels.every((label) => label.text === "")) return [];
      return [
        {
          id: book.id,
          name: bookName(book.id, metadata),
          words: [...wordsOf(labels)],
          kept: keptAsWritten(labels),
        },
      ];
    });
  });

  const [choices, setChoices] = createSignal<ReadonlyMap<BookId, string>>(new Map());
  const [typed, setTyped] = createSignal<ReadonlyMap<BookId, string>>(new Map());
  const [everyWord, setEveryWord] = createSignal("");

  /** What a row's select shows: what was picked, else its most used word, else leave it. */
  const choiceOf = (row: Row): string => choices().get(row.id) ?? row.words[0]?.[0] ?? LEAVE;
  const choose = (id: BookId, value: string): void => {
    setChoices(new Map(choices()).set(id, value));
  };
  const type = (id: BookId, value: string): void => {
    setTyped(new Map(typed()).set(id, value));
  };

  const wordFor = (row: Row): string | undefined => {
    const choice = choiceOf(row);
    if (choice === LEAVE) return undefined;
    const word = choice === OTHER ? (typed().get(row.id) ?? "").trim() : choice;
    return word === "" ? undefined : word;
  };

  const useEverywhere = (): void => {
    const word = everyWord().trim();
    if (word === "") return;
    for (const row of rows()) {
      const own = row.words.some(([candidate]) => candidate === word);
      choose(row.id, own ? word : OTHER);
      if (!own) type(row.id, word);
    }
  };

  const standardize = (): void => {
    const chosen = new Map<BookId, string>();
    for (const row of rows()) {
      const word = wordFor(row);
      if (word !== undefined) chosen.set(row.id, word);
    }
    props.onOpenChange(false);
    if (chosen.size > 0) runCommand("chapterLabels.standardize", chosen);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={m.chapter_labels_title()}
      description={m.chapter_labels_description()}
      class="w-[min(40rem,92vw)]"
      footer={
        <>
          <Button variant="tertiary" onClick={() => props.onOpenChange(false)}>
            {m.chapter_labels_cancel()}
          </Button>
          <Button
            variant="primary"
            disabled={rows().every((row) => wordFor(row) === undefined)}
            data-testid="chapter-labels-standardize"
            onClick={standardize}
          >
            {m.chapter_labels_standardize()}
          </Button>
        </>
      }
    >
      <Show
        when={rows().length > 0}
        fallback={<p class="text-on-surface-secondary">{m.chapter_labels_none()}</p>}
      >
        <div class="flex items-center gap-controls pb-3">
          <Input
            aria-label={m.chapter_labels_every_book()}
            placeholder={m.chapter_labels_every_book_placeholder()}
            wrapperClass="flex-1"
            value={everyWord()}
            onInput={(event) => setEveryWord(event.currentTarget.value)}
          />
          <Button variant="secondary" disabled={everyWord().trim() === ""} onClick={useEverywhere}>
            {m.chapter_labels_use_everywhere()}
          </Button>
        </div>
        <div class="max-h-[60vh] overflow-y-auto" data-testid="chapter-labels-books">
          <For each={rows()}>
            {(row) => (
              <div
                class="flex flex-col gap-2 border-t border-surface-border py-3"
                data-chapter-labels-book={row.id}
              >
                <div class="flex items-center justify-between gap-controls">
                  <span class="font-semibold">{row.name}</span>
                  <Select
                    aria-label={row.name}
                    value={choiceOf(row)}
                    onChange={(event) => choose(row.id, event.currentTarget.value)}
                  >
                    <option value={LEAVE}>{m.chapter_labels_leave()}</option>
                    <For each={row.words}>
                      {([word, count]) => (
                        <option value={word}>
                          {count === 0
                            ? m.chapter_labels_book_label({ word })
                            : m.chapter_labels_word_count({ word, count })}
                        </option>
                      )}
                    </For>
                    <option value={OTHER}>{m.chapter_labels_other()}</option>
                  </Select>
                </div>
                <Show when={choiceOf(row) === OTHER}>
                  <Input
                    aria-label={m.chapter_labels_other()}
                    value={typed().get(row.id) ?? ""}
                    onInput={(event) => type(row.id, event.currentTarget.value)}
                  />
                </Show>
                <Show when={row.kept.length > 0}>
                  <details class="text-on-surface-secondary">
                    <summary class="cursor-pointer">
                      {m.chapter_labels_kept({ count: row.kept.length })}
                    </summary>
                    <ul class="mt-1 flex flex-col gap-1 ps-4">
                      <For each={row.kept}>
                        {(label) => (
                          <li>
                            {label.mismatched
                              ? m.chapter_labels_number_differs({
                                  chapter: String(label.chapter),
                                  text: label.text,
                                })
                              : m.chapter_labels_kept_row({
                                  chapter: String(label.chapter),
                                  text: label.text,
                                })}
                          </li>
                        )}
                      </For>
                    </ul>
                  </details>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Dialog>
  );
}
