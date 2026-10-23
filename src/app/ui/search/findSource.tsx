import type { BookId } from "@sefer/text/book";
import { Effect, Option, Result } from "effect";
import { Show, createEffect, createSignal } from "solid-js";

import type { BookText, Excerpt } from "#core/excerpts/excerpts";
import { bookHeading } from "#core/galley";
import type { Resource } from "#core/resources/library";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import * as Workflows from "../../workflows/references";
import type { Paired } from "../excerpts";
import { listProjects, type ProjectSummary } from "../landing/summaries";
import { MultiSelect } from "../primitives";

type Held = { readonly kind: "loading" } | { readonly kind: "missing" } | BookText;

const NONE = "";

function createBookCache(shell: ReturnType<typeof useShell>) {
  const { services } = shell;
  const [read, setRead] = createSignal(0, { name: "findSourceRead" });
  const books = new Map<BookId, Held>();
  let generation = 0;

  const reset = (): void => {
    books.clear();
    generation += 1;
  };

  const bookOf = (source: Resource, bookId: BookId): Held => {
    const held = books.get(bookId);
    if (held !== undefined) return held;
    books.set(bookId, { kind: "loading" });
    const asked = generation;
    void services
      .run(Effect.result(services.library.readBook(source.id, bookId)))
      .then((outcome) => {
        if (asked !== generation) return;
        const text = Result.isFailure(outcome) ? undefined : Option.getOrUndefined(outcome.success);
        if (text === undefined) books.set(bookId, { kind: "missing" });
        else {
          const analysis = services.galley.analyzeText(text, "find.source");
          const heading = bookHeading(analysis);
          books.set(bookId, {
            bookId,
            text: analysis.text,
            analysis,
            label: (address) => shell.location.label(address, heading),
          });
        }
        setRead((held) => held + 1);
      });
    return { kind: "loading" };
  };

  return { read, reset, bookOf };
}

type SourceRow = { readonly root: string; readonly name: string; readonly language: string };

interface SourcePickerProps {
  readonly summary: string;
  readonly narrowed: boolean;
  readonly rows: readonly SourceRow[];
  readonly chosen: string;
  readonly onChoose: (root: string) => void;
}

function SourcePicker(props: SourcePickerProps) {
  return (
    <MultiSelect
      single
      id="find-source"
      label={t("Source text")}
      summary={props.summary}
      narrowed={props.narrowed}
      items={props.rows}
      key={(row: SourceRow) => row.root}
      match={(row, query) =>
        `${row.name} ${row.language}`.toLowerCase().includes(query.toLowerCase())
      }
      placeholder={t("Search texts…")}
      selected={(row) => row.root === props.chosen}
      onToggle={(row) => props.onChoose(row.root)}
    >
      {(row) => (
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate">{row.name}</span>
          <Show when={row.language !== ""}>
            <span class="text-smallest text-on-surface-tertiary">{row.language}</span>
          </Show>
        </span>
      )}
    </MultiSelect>
  );
}

export function createFindSource(onBound: () => void) {
  const shell = useShell();
  const { services } = shell;

  const [resource, setResource] = createSignal<Resource | undefined>(undefined, {
    name: "findSource",
  });
  const [choices, setChoices] = createSignal<readonly ProjectSummary[]>([], {
    name: "findSourceChoices",
  });
  const [tick, setTick] = createSignal(0, { name: "findSourceTick" });
  const cache = createBookCache(shell);

  createEffect(
    () => ({ project: shell.project()?.root, tick: tick() }),
    ({ project }) => {
      cache.reset();
      if (project === undefined) {
        setResource(undefined);
        return;
      }
      void services
        .run(services.library.resolve(project, "source"))
        .then((found) => setResource(found[0]));
    },
  );

  createEffect(
    () => shell.project()?.root,
    (open) => {
      const recent = services.settings.get(shellKeys(services.settings).recentProjects);
      void services
        .run(listProjects(services.projectsRoot, services.fixtureProject, recent))
        .then((rows) => setChoices(rows.filter((row) => row.root !== open)));
    },
  );

  const choose = (root: string): void => {
    const project = shell.project();
    if (project === undefined) return;
    const previous = resource();
    if ((previous?.id ?? NONE) === root) return;
    void services
      .run(
        Effect.result(
          Effect.gen(function* () {
            if (previous !== undefined)
              yield* services.library.unpick(project.root, "source", previous.id);
            if (root === NONE) return undefined;
            const added = yield* services.library.add(root);
            yield* services.library.pick(project.root, "source", added.id);
            return added;
          }),
        ),
      )
      .then((outcome) => {
        if (Result.isFailure(outcome)) {
          shell.report(
            t("could not add the source: {reason}", { reason: outcome.failure.description }),
          );
          return;
        }
        setTick((held) => held + 1);
        void services
          .run(Workflows.bindReferences(project.root))
          .then(() => services.projectAnalysis.rejudge());
        onBound();
      });
  };

  const pairedOf = (excerpt: Excerpt): Paired | undefined => {
    cache.read();
    const source = resource();
    if (source === undefined) return undefined;
    const held = cache.bookOf(source, excerpt.bookId);
    if ("analysis" in held) return { kind: "text", name: source.title, book: held, hits: [] };
    return {
      kind: "none",
      name: source.title,
      message:
        held.kind === "loading"
          ? t("Loading…")
          : t("{place} is not in {name}.", { place: excerpt.label, name: source.title }),
    };
  };

  const shown = (): boolean => resource() !== undefined;

  const rows = (): readonly SourceRow[] => [
    { root: NONE, name: t("No source text"), language: "" },
    ...choices().map((row) => ({ root: row.root, name: row.name, language: row.language })),
  ];
  const chosen = (): string => (shown() ? (resource()?.id ?? NONE) : NONE);

  const Picker = () => (
    <SourcePicker
      summary={shown() ? (resource()?.title ?? "") : t("none")}
      narrowed={shown()}
      rows={rows()}
      chosen={chosen()}
      onChoose={choose}
    />
  );

  return { resource, shown, pairedOf, Picker };
}
