import type { Reading, Rendered, Settings, VerseMode } from "@sefer/document-import";
import { editorPolicy, type EditorBook } from "@sefer/editor";
import { Result } from "effect";
import FileUp from "lucide-solid/icons/file-up";
import Info from "lucide-solid/icons/info";
import { For, Show, createMemo, createSignal } from "solid-js";

import {
  applyImport,
  chapterWordOf,
  previewImport,
  type ImportChapters,
} from "#core/documentImport/importPreview";

import { m } from "../../paraglide/messages";
import { useServices, useShell } from "../../ProjectContext";
import { ExcerptReader } from "../excerpts/ExcerptReader";
import { Button, Dialog, Input, Select, Switch, Tooltip } from "../primitives";

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
    <Show when={props.open ? shell.focused() : undefined}>
      {(book) => <ImportInto book={book()} onClose={props.onClose} />}
    </Show>
  );
}

function ImportInto(props: { readonly book: EditorBook; readonly onClose: () => void }) {
  const shell = useShell();
  const services = useServices();
  const [loaded, setLoaded] = createSignal<Loaded | undefined>(undefined, { name: "importLoaded" });
  const [problem, setProblem] = createSignal("", { name: "importProblem" });
  const [scope, setScope] = createSignal("", { name: "importScope" });
  const [keep, setKeep] = createSignal(true, { name: "importKeep" });
  const [usfm, setUsfm] = createSignal(shell.mode() === "usfm", { name: "importUsfm" });
  const [off, setOff] = createSignal<ReadonlySet<SwitchKey>>(new Set(), { name: "importOff" });
  const [verses, setVerses] = createSignal<VerseMode | "auto">("auto", { name: "importVerses" });
  const [words, setWords] = createSignal("", { name: "importWords" });

  const bookHasText = () => /\\c\s+\d/.test(props.book.source().text);
  const chapterWords = () => {
    const typed = words()
      .split(",")
      .map((w) => w.trim())
      .filter((w) => w !== "");
    if (typed.length > 0) return typed;
    const own = chapterWordOf(props.book.source().text);
    return own === undefined ? ["chapter"] : ["chapter", own];
  };

  const choose = async (file: File) => {
    setProblem("");
    setLoaded(undefined);
    try {
      const lib = await import("@sefer/document-import");
      const reading = await lib.readDocument(new Uint8Array(await file.arrayBuffer()));
      setLoaded({ name: file.name, reading, lib });
    } catch (error) {
      setProblem(
        m.import_document_unreadable({
          file: file.name,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  const base = (): Settings => ({
    book: props.book.id,
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

  const chapters = createMemo(
    ():
      | { readonly ok: true; readonly chapters: ImportChapters }
      | { readonly ok: false; readonly message: string } => {
      const text = scope().trim();
      if (text === "") return { ok: true, chapters: undefined };
      const citation = shell.location.read(text);
      if (!citation.ok) return { ok: false, message: m.import_document_scope_problem({ text }) };
      const address = citation.addresses[0];
      if (address.book.toUpperCase() !== props.book.id.toUpperCase()) {
        return { ok: false, message: m.import_document_scope_other_book({ book: address.book }) };
      }
      if (address.kind === "chapters")
        return { ok: true, chapters: { from: address.from, to: address.to } };
      if (address.kind === "verses") {
        return { ok: true, chapters: { from: address.from.chapter, to: address.to.chapter } };
      }
      return { ok: true, chapters: undefined };
    },
    { name: "importChapters" },
  );

  const preview = createMemo(
    () => {
      const out = rendered();
      const range = chapters();
      if (out === undefined || !range.ok) return undefined;
      return previewImport(
        services.galley,
        props.book,
        out.usfm,
        range.chapters,
        keep() && bookHasText(),
      );
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
      if (p === undefined) return undefined;
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

  const run = () => {
    const p = ready();
    const doc = loaded();
    if (p === undefined || doc === undefined) return;
    const applied = applyImport(p, props.book);
    if (Result.isFailure(applied)) {
      shell.report(m.import_document_refused({ reason: applied.failure.description }));
      return;
    }
    shell.changed({ kind: "book.apply", books: [props.book.id] });
    shell.report(m.import_document_done({ chapters: p.replaced.join(", "), file: doc.name }));
    props.onClose();
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
    const range = chapters();
    if (!range.ok) out.push(range.message);
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
      class="w-[min(60rem,94vw)]"
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
      <div class="grid gap-4 md:grid-cols-[17rem_1fr]" data-import-document>
        <div class="flex flex-col gap-3">
          <input
            ref={setInput}
            type="file"
            accept=".docx,.odt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text"
            class="hidden"
            data-import-document-file
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
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
                placeholder={m.import_document_scope_hint({ book: props.book.id })}
                data-import-document-scope
                onInput={(event) => setScope(event.currentTarget.value)}
              />
            </label>
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
        <div class="flex min-w-0 flex-col gap-2">
          <Show when={shown()}>
            {(view) => (
              <>
                <Switch checked={usfm()} onChange={setUsfm} label={m.import_document_usfm()} />
                <div
                  class="max-h-[60vh] overflow-auto rounded-lg border border-surface-border"
                  data-import-document-preview
                >
                  <ExcerptReader
                    analysis={view().analysis}
                    span={view().span}
                    policy={editorPolicy(usfm() ? "usfm" : "regular")}
                    marks={[]}
                    label="import-preview"
                  />
                </div>
              </>
            )}
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
