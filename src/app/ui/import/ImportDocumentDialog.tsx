import type { Reading, Rendered, Settings, VerseMode } from "@sefer/document-import";
import { editorPolicy } from "@sefer/editor";
import type { Book } from "@sefer/text/book";
import { chaptersAddress } from "@sefer/text/location/address";
import { Effect, Result } from "effect";
import FileUp from "lucide-solid/icons/file-up";
import Info from "lucide-solid/icons/info";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import { diffSkeleton } from "#core/diff/skeleton";
import {
  applyImport,
  chapterWordOf,
  previewImport,
  type ImportChapters,
} from "#core/documentImport/importPreview";

import { m } from "../../paraglide/messages";
import { useServices, useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { BookDiff, changed } from "../diff";
import { ExcerptReader } from "../excerpts/ExcerptReader";
import { Button, Dialog, Input, SegmentedControl, Select, Switch, Tooltip } from "../primitives";
import { toLayout } from "../review/reader/helpers";
import { createMeasure } from "../review/reader/measure";
import { ViewMenu } from "../review/reader/ReaderToolbar";
import { AUTO_SPLIT_PX, FILTERS, type Filter, type Layout } from "../review/reader/types";
import { BookChaptersRow, chaptersOf, type ChapterTile } from "../workspace/BookChapters";
import { bookName } from "../workspace/books";
import { metadataOf } from "../workspace/project";

type DocumentImport = typeof import("@sefer/document-import");

interface Loaded {
  readonly name: string;
  readonly reading: Reading;
  readonly lib: DocumentImport;
}

// One switch per kind of guess the document gave occasion for: on is the
// importer's default, off its quieter alternative.
const SWITCHES = [
  { key: "poetry", found: "poetry", off: "unwrap", label: m.import_document_poetry },
  { key: "headings", found: "headings", off: "rem", label: m.import_document_headings },
  { key: "front", found: "front", off: "drop", label: m.import_document_front },
  { key: "notes", found: "notes", off: "drop", label: m.import_document_notes },
  { key: "italic", found: "italic", off: "unwrap", label: m.import_document_italic },
  { key: "bold", found: "bold", off: "unwrap", label: m.import_document_bold },
  { key: "lists", found: "lists", off: "unwrap", label: m.import_document_lists },
  {
    key: "styleMarkers",
    found: "styleMarkers",
    off: "unwrap",
    label: m.import_document_style_markers,
  },
] as const;

type SwitchKey = (typeof SWITCHES)[number]["key"];

const VERSE_MODES: readonly VerseMode[] = ["superscript", "marked", "lineStart", "perLine", "any"];

/** The preview: the replaced chapters as they will read, or the whole book before against after. */
type View = "result" | "changes";

type Target =
  | { readonly ok: true; readonly book: Book; readonly chapters: ImportChapters }
  | { readonly ok: false; readonly message: string };

const escaped = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const modeLabel = (mode: VerseMode) =>
  ({
    superscript: m.import_document_mode_superscript(),
    marked: m.import_document_mode_marked(),
    lineStart: m.import_document_mode_line_start(),
    perLine: m.import_document_mode_per_line(),
    any: m.import_document_mode_any(),
  })[mode];

export function ImportDocumentDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const shell = useShell();
  return (
    <Show when={props.open && shell.project() !== undefined}>
      <ImportInto onClose={props.onClose} />
    </Show>
  );
}

function ImportInto(props: { readonly onClose: () => void }) {
  const shell = useShell();
  const services = useServices();
  const [loaded, setLoaded] = createSignal<Loaded | undefined>(undefined, { name: "importLoaded" });
  const [problem, setProblem] = createSignal("", { name: "importProblem" });
  // Typed ("TIT 2-3") or picked from the books: the one source of where the import goes.
  const [scope, setScope] = createSignal("", { name: "importScope" });
  const [keep, setKeep] = createSignal(true, { name: "importKeep" });
  const [keepFront, setKeepFront] = createSignal(true, { name: "importKeepFront" });
  const [view, setView] = createSignal<View>("result", { name: "importView" });
  const [usfm, setUsfm] = createSignal(shell.mode() === "usfm", { name: "importUsfm" });
  const [filter, setFilter] = createSignal<Filter>("all", { name: "importFilter" });
  // Review's layout setting: side by side or one text is the reader's habit, not the screen's.
  const layoutKey = shellKeys(services.settings).reviewLayout;
  const [layout, setLayoutSignal] = createSignal<Layout>(
    toLayout(services.settings.get(layoutKey)),
    { name: "importLayout" },
  );
  const setLayout = (value: Layout) => {
    setLayoutSignal(value);
    void services.run(Effect.result(services.settings.set(layoutKey, value)));
  };
  const [width, setWidth] = createSignal(0, { name: "importWidth" });
  const measure = createMeasure(setWidth);
  const split = () => layout() === "split" || (layout() === "auto" && width() >= AUTO_SPLIT_PX);
  // The book list follows what is typed in the Chapters box, not what a pick wrote there.
  const [typed, setTyped] = createSignal(false, { name: "importTyped" });
  const [off, setOff] = createSignal<ReadonlySet<SwitchKey>>(new Set(), { name: "importOff" });
  const [verses, setVerses] = createSignal<VerseMode | "auto">("auto", { name: "importVerses" });
  const [words, setWords] = createSignal("", { name: "importWords" });
  // Typing re-renders the document and re-runs the overlay; wait for a pause.
  const [scopeSettled, setScopeSettled] = createSignal("", { name: "importScopeSettled" });
  const [wordsSettled, setWordsSettled] = createSignal("", { name: "importWordsSettled" });
  createEffect(
    () => ({ scope: scope(), words: words() }),
    (typed) => {
      const timer = setTimeout(() => {
        setScopeSettled(typed.scope);
        setWordsSettled(typed.words);
      }, 250);
      return () => clearTimeout(timer);
    },
  );
  // The project went away with the dialog open: close it, so it does not
  // come back unasked with the next project.
  onCleanup(() => props.onClose());

  const books = createMemo(
    () => {
      const project = shell.project();
      const metadata = metadataOf(project);
      return (project?.books ?? []).map((book) => ({ book, name: bookName(book.id, metadata) }));
    },
    { name: "importBooks" },
  );

  // The one project book the document's opening lines name, as a whole word
  // ("MASTER Titus", "Psalms draft"); none, or more than one, is no guess.
  const named = createMemo(
    () => {
      const doc = loaded();
      if (doc === undefined) return undefined;
      const opening = doc.reading.paragraphs
        .slice(0, 3)
        .flatMap((p) => p.inlines.map((i) => (i.kind === "text" ? i.text : " ")))
        .join(" ");
      const found = books().filter(({ book, name }) =>
        [name, book.id].some((word) =>
          new RegExp(String.raw`(^|[^\p{L}\p{N}])${escaped(word)}($|[^\p{L}\p{N}])`, "iu").test(
            opening,
          ),
        ),
      );
      return found.length === 1 ? found[0].book : undefined;
    },
    { name: "importNamed" },
  );

  // Where the import goes and which chapters: the typed or picked scope, else
  // the book the document names, else the open book; whole. Any book in the
  // project; it need not be open.
  const target = createMemo(
    (): Target => {
      const text = scopeSettled().trim();
      if (text === "") {
        const open = shell.focused()?.id;
        const book = named() ?? books().find((row) => row.book.id === open)?.book;
        return book === undefined
          ? { ok: false, message: m.import_document_choose_book() }
          : { ok: true, book, chapters: undefined };
      }
      const citation = shell.location.read(text);
      if (!citation.ok) return { ok: false, message: m.import_document_scope_problem({ text }) };
      const address = citation.addresses[0];
      const book = books().find(
        (row) => row.book.id.toUpperCase() === address.book.toUpperCase(),
      )?.book;
      if (book === undefined) {
        return {
          ok: false,
          message: m.import_document_scope_not_in_project({ book: address.book }),
        };
      }
      if (address.kind === "chapters")
        return { ok: true, book, chapters: { from: address.from, to: address.to } };
      if (address.kind === "verses") {
        return {
          ok: true,
          book,
          chapters: { from: address.from.chapter, to: address.to.chapter },
        };
      }
      return { ok: true, book, chapters: undefined };
    },
    { name: "importTarget" },
  );
  const book = (): Book | undefined => {
    const chosen = target();
    return chosen.ok ? chosen.book : undefined;
  };

  const bookHasText = () => /\\c\s+\d/.test(book()?.source().text ?? "");
  const chapterWords = () => {
    const typed = wordsSettled()
      .split(",")
      .map((w) => w.trim())
      .filter((w) => w !== "");
    if (typed.length > 0) return typed;
    const own = chapterWordOf(book()?.source().text ?? "");
    return own === undefined ? ["chapter"] : ["chapter", own];
  };

  // A second file chosen while the first is still being read wins.
  let latest = 0;
  const choose = async (file: File) => {
    const ticket = ++latest;
    setProblem("");
    setLoaded(undefined);
    try {
      const lib = await import("@sefer/document-import");
      const reading = await lib.readDocument(new Uint8Array(await file.arrayBuffer()));
      if (ticket === latest) setLoaded({ name: file.name, reading, lib });
    } catch (error) {
      if (ticket !== latest) return;
      setProblem(
        m.import_document_unreadable({
          file: file.name,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  const base = (): Settings => ({
    book: book()?.id,
    verses: verses(),
    chapterWords: chapterWords(),
  });

  // What the document holds, rendered with every switch on, so a switch stays
  // offered after it is turned off.
  const found = createMemo(
    () => {
      const doc = loaded();
      return doc === undefined ? undefined : doc.lib.render(doc.reading, base()).report;
    },
    { name: "importFound" },
  );

  const rendered = createMemo(
    (): Rendered | undefined => {
      const doc = loaded();
      if (doc === undefined) return undefined;
      const settings: Settings = { ...base() };
      for (const s of SWITCHES) if (off().has(s.key)) Object.assign(settings, { [s.key]: s.off });
      return doc.lib.render(doc.reading, settings);
    },
    { name: "importRendered" },
  );

  const preview = createMemo(
    () => {
      const out = rendered();
      const chosen = target();
      if (out === undefined || !chosen.ok) return undefined;
      return previewImport(services.galley, chosen.book, out.usfm, chosen.chapters, {
        keepParagraphing: keep() && bookHasText(),
        keepFrontMatter: keepFront(),
      });
    },
    { name: "importPreview" },
  );

  const ready = () => {
    const p = preview();
    return p !== undefined && Result.isSuccess(p) && p.success.replaced.length > 0
      ? p.success
      : undefined;
  };

  // The replaced chapters, read in an editor view like every other excerpt.
  const shown = createMemo(
    () => {
      const p = ready();
      if (p === undefined || view() === "changes") return undefined;
      const first = Math.min(...p.replaced);
      const last = Math.max(...p.replaced);
      const from = p.text.search(new RegExp(String.raw`^\\c\s+${first}\b`, "m"));
      const next = [...p.text.matchAll(/^\\c\s+(\d+)/gm)].find((c) => Number(c[1]) > last);
      return {
        analysis: services.galley.analyzeText(p.text, "import-preview"),
        span: { from: Math.max(from, 0), to: next?.index ?? p.text.length },
      };
    },
    { name: "importShown" },
  );

  // The book now against the book after the import, as Review shows a book:
  // the whole of it, opened at the first change.
  const changes = createMemo(
    () => {
      const p = ready();
      const into = book();
      if (p === undefined || into === undefined || view() !== "changes") return undefined;
      const before = into.source().text;
      const skeleton = diffSkeleton(services.galley, into.id, before, p.text);
      if (Result.isFailure(skeleton)) return undefined;
      const shows = FILTERS[filter()];
      const units = skeleton.success.units.filter((unit) => !changed(unit) || shows(unit));
      return {
        sides: {
          bookId: into.id,
          baselineText: before,
          currentText: p.text,
          baseline: services.galley.analyzeText(before, "import-before"),
          current: services.galley.analyzeText(p.text, "import-preview"),
        },
        units,
        initial: units.find(changed),
      };
    },
    { name: "importChanges" },
  );

  const run = () => {
    const p = ready();
    const doc = loaded();
    const into = book();
    if (p === undefined || doc === undefined || into === undefined) return;
    const applied = applyImport(p, into);
    if (Result.isFailure(applied)) {
      shell.report(m.import_document_refused({ reason: applied.failure.description }));
      return;
    }
    shell.changed({ kind: "book.apply", books: [into.id] });
    shell.report(m.import_document_done({ chapters: p.replaced.join(", "), file: doc.name }));
    props.onClose();
    // Into a book that is not open: go there, so the result is what you see.
    if (shell.focused()?.id !== into.id)
      shell.showReference(chaptersAddress(into.id, Math.min(...p.replaced)));
  };

  // The books as the sidebar lists them: open one to pick its chapters.
  // Unset, the row open is the target's; null, the person closed them all.
  const [openPicked, setOpenRow] = createSignal<string | null | undefined>(undefined, {
    name: "importOpenRow",
  });
  const openRow = (): string | undefined => {
    const picked = openPicked();
    return picked === undefined ? book()?.id : (picked ?? undefined);
  };
  let anchor: number | undefined;
  const chosen = (id: string, tile: ChapterTile): boolean => {
    const t = target();
    if (!t.ok || t.book.id !== id) return false;
    return (
      t.chapters === undefined || (tile.index >= t.chapters.from && tile.index <= t.chapters.to)
    );
  };
  const pickBook = (id: string) => {
    setOpenRow(openRow() === id ? null : id);
    if (book()?.id !== id) {
      anchor = undefined;
      pick(id);
    }
  };
  const pick = (text: string) => {
    setTyped(false);
    setScope(text);
  };
  // The books the typed text could mean, as the sidebar's search finds them;
  // every book while nothing is typed, or after a pick.
  const listed = createMemo(
    () => {
      const text = scope().trim();
      if (!typed() || text === "") return books();
      const wanted = new Set(shell.location.books(text));
      return books().filter((row) => wanted.has(row.book.id));
    },
    { name: "importListed" },
  );
  // Enter takes the box now, not after the pause; a word that names no
  // chapters yet takes the first book it could mean.
  const enter = () => {
    const text = scope().trim();
    const first = listed()[0]?.book.id;
    if (text !== "" && !shell.location.read(text).ok && first !== undefined) pick(first);
    else setScopeSettled(scope());
  };
  // A chapter alone; with Shift and a chapter already picked, the range
  // between; the one picked chapter again, the whole book.
  const pickChapter = (id: string, tile: ChapterTile, event: MouseEvent) => {
    const t = target();
    const same = t.ok && t.book.id === id;
    if (event.shiftKey && same && anchor !== undefined) {
      const from = Math.min(anchor, tile.index);
      const to = Math.max(anchor, tile.index);
      pick(from === to ? `${id} ${from}` : `${id} ${from}-${to}`);
      return;
    }
    if (same && t.chapters?.from === tile.index && t.chapters.to === tile.index) {
      anchor = undefined;
      pick(id);
      return;
    }
    anchor = tile.index;
    pick(`${id} ${tile.index}`);
  };

  const summary = () => {
    const report = rendered()?.report;
    if (report === undefined) return "";
    const total = report.chapters.reduce((sum, c) => sum + c.verses, 0);
    return m.import_document_found({ verses: total, chapters: report.chapters.length });
  };

  const notes = (): readonly string[] => {
    const report = rendered()?.report;
    const p = preview();
    const out: string[] = [];
    const chosen = target();
    if (!chosen.ok) out.push(chosen.message);
    if (report === undefined) return out;
    if (report.found.trackedChanges > 0)
      out.push(m.import_document_tracked({ count: report.found.trackedChanges }));
    for (const c of report.chapters) {
      if (c.missing.length > 0) {
        out.push(m.import_document_missing({ chapter: c.chapter, verses: c.missing.join(", ") }));
      }
    }
    if (report.skipped.length > 0)
      out.push(m.import_document_skipped({ count: report.skipped.length }));
    if (p !== undefined && Result.isFailure(p))
      out.push(m.import_document_refused({ reason: p.failure.description }));
    if (p !== undefined && Result.isSuccess(p)) {
      const v = p.success;
      if (v.replaced.length === 0) out.push(m.import_document_nothing());
      if (v.lost.length > 0) out.push(m.import_document_lost({ verses: v.lost.join(", ") }));
      if (v.absent.length > 0)
        out.push(m.import_document_absent({ chapters: v.absent.join(", ") }));
      if (v.frontSkipped) out.push(m.import_document_front_skipped());
      if (v.labelsKept.length > 0)
        out.push(m.import_document_labels_kept({ chapters: v.labelsKept.join(", ") }));
      if (v.replaced.length > 0 && v.changes.length === 0) out.push(m.import_document_unchanged());
    }
    return out;
  };

  const [input, setInput] = createSignal<HTMLInputElement | undefined>(undefined, {
    name: "importFileInput",
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={m.import_document_title()}
      class="w-[96vw]! max-w-[110rem]"
      footer={
        <>
          <Button variant="tertiary" onClick={props.onClose}>
            {m.import_document_cancel()}
          </Button>
          <Button
            variant="primary"
            disabled={(ready()?.changes.length ?? 0) === 0}
            data-import-document-confirm
            onClick={run}
          >
            {m.import_document_import()}
          </Button>
        </>
      }
    >
      <div class="grid h-[76vh] gap-4 md:grid-cols-[20rem_1fr]" data-import-document>
        <div class="flex min-h-0 flex-col gap-3 overflow-y-auto p-1">
          <input
            ref={setInput}
            type="file"
            accept=".docx,.odt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text"
            class="hidden"
            data-import-document-file
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              // Cleared, so choosing the same file again (fixed in Word) reads it again.
              event.currentTarget.value = "";
              if (file !== undefined) void choose(file);
            }}
          />
          <Button variant="secondary" icon={<FileUp />} onClick={() => input()?.click()}>
            {loaded()?.name ?? m.import_document_choose()}
          </Button>
          <Show when={problem() !== ""}>
            <p class="text-small text-on-surface-danger">{problem()}</p>
          </Show>
          <Show when={loaded()}>
            <p class="text-small text-on-surface-secondary" data-import-document-summary>
              {summary()}
            </p>
            <label class="flex flex-col gap-1">
              <span class="text-small font-medium">{m.import_document_scope()}</span>
              <Input
                value={scope()}
                placeholder={m.import_document_scope_hint({ book: book()?.id ?? "TIT" })}
                data-import-document-scope
                onInput={(event) => {
                  setTyped(true);
                  setScope(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    enter();
                  } else if (event.key === "Escape" && scope() !== "") {
                    // Escape clears the box first, and only then closes the dialog.
                    event.preventDefault();
                    event.stopPropagation();
                    pick("");
                  }
                }}
              />
            </label>
            <ul
              class="max-h-72 shrink-0 overflow-y-auto rounded-lg border border-surface-border"
              aria-label={m.import_document_books()}
              data-import-document-books
            >
              <For each={listed()}>
                {(row) => (
                  <BookChaptersRow
                    id={row.book.id}
                    name={row.name}
                    open={openRow() === row.book.id}
                    marked={book()?.id === row.book.id}
                    chapters={
                      openRow() === row.book.id
                        ? chaptersOf(shell, row.book.id).filter((tile) => !tile.intro)
                        : []
                    }
                    chosen={(tile) => chosen(row.book.id, tile)}
                    toggles
                    onToggle={() => pickBook(row.book.id)}
                    onChapter={(tile, event) => pickChapter(row.book.id, tile, event)}
                  />
                )}
              </For>
            </ul>
            <Show when={bookHasText()}>
              <div class="flex items-center gap-2">
                <Switch checked={keep()} onChange={setKeep} label={m.import_document_keep()} />
                <Tooltip label={m.import_document_keep_tip()}>
                  <Info
                    class="size-4 text-on-surface-tertiary"
                    aria-label={m.import_document_keep_tip()}
                  />
                </Tooltip>
              </div>
              <div class="flex items-center gap-2">
                <Switch
                  checked={keepFront()}
                  onChange={setKeepFront}
                  label={m.import_document_keep_front()}
                />
                <Tooltip label={m.import_document_keep_front_tip()}>
                  <Info
                    class="size-4 text-on-surface-tertiary"
                    aria-label={m.import_document_keep_front_tip()}
                  />
                </Tooltip>
              </div>
            </Show>
            <For each={SWITCHES.filter((s) => (found()?.found[s.found] ?? 0) > 0)}>
              {(s) => (
                <Switch
                  checked={!off().has(s.key)}
                  onChange={(on) => {
                    const next = new Set(off());
                    if (on) next.delete(s.key);
                    else next.add(s.key);
                    setOff(next);
                  }}
                  label={s.label({ count: found()?.found[s.found] ?? 0 })}
                />
              )}
            </For>
            <details class="text-small">
              <summary class="cursor-pointer">{m.import_document_advanced()}</summary>
              <div class="mt-2 flex flex-col gap-2">
                <label class="flex flex-col gap-1">
                  <span>{m.import_document_verses()}</span>
                  <Select
                    value={verses()}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setVerses(VERSE_MODES.find((mode) => mode === value) ?? "auto");
                    }}
                  >
                    <option value="auto">
                      {m.import_document_mode_detected({
                        mode: modeLabel(found()?.detected ?? "superscript"),
                      })}
                    </option>
                    <For each={VERSE_MODES}>
                      {(mode) => <option value={mode}>{modeLabel(mode)}</option>}
                    </For>
                  </Select>
                </label>
                <label class="flex flex-col gap-1">
                  <span>{m.import_document_chapter_words()}</span>
                  <Input
                    value={words()}
                    placeholder={chapterWords().join(", ")}
                    onInput={(event) => setWords(event.currentTarget.value)}
                  />
                  <span class="text-on-surface-tertiary">
                    {m.import_document_chapter_words_tip()}
                  </span>
                </label>
              </div>
            </details>
            <ul
              class="flex flex-col gap-1 text-small text-on-surface-secondary"
              data-import-document-notes
            >
              <For each={notes()}>{(note) => <li>{note}</li>}</For>
            </ul>
          </Show>
        </div>
        <div class="flex min-h-0 min-w-0 flex-col gap-2">
          <Show when={ready()}>
            <div class="flex items-center gap-2">
              <SegmentedControl<View>
                size="sm"
                label={m.import_document_view()}
                value={view()}
                onChange={setView}
                items={[
                  { value: "result", label: m.import_document_view_result() },
                  { value: "changes", label: m.import_document_view_changes() },
                ]}
              />
              <ViewMenu
                toolbar={
                  view() === "changes"
                    ? {
                        filter: filter(),
                        onFilter: setFilter,
                        layout: layout(),
                        onLayout: setLayout,
                        usfm: usfm(),
                        onUsfm: setUsfm,
                      }
                    : { usfm: usfm(), onUsfm: setUsfm }
                }
              />
            </div>
          </Show>
          <Show when={shown()}>
            {(shownView) => (
              <div
                class="min-h-0 flex-1 overflow-auto rounded-lg border border-surface-border"
                data-import-document-preview
              >
                <ExcerptReader
                  analysis={shownView().analysis}
                  span={shownView().span}
                  policy={editorPolicy(usfm() ? "usfm" : "regular")}
                  marks={[]}
                  label="import-preview"
                />
              </div>
            )}
          </Show>
          <Show when={changes()}>
            {(diff) => (
              <div class="flex min-h-0 flex-1 flex-col" ref={measure} data-import-document-changes>
                <BookDiff
                  class="min-h-0 flex-1"
                  sides={diff().sides}
                  units={diff().units}
                  split={split()}
                  usfm={usfm()}
                  controls={undefined}
                  currentLabel={m.import_document_changes_after()}
                  baselineLabel={m.import_document_changes_now()}
                  observability={services.composition.observability}
                  initial={diff().initial}
                />
              </div>
            )}
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
