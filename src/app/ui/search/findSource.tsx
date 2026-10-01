/**
 * Find's source text: the project's ONE source, read beside each result.
 *
 * Two axes, kept apart. WHICH text is shown beside your verse (this picker,
 * or none) and WHICH text is searched (Find's "Search the source text"
 * switch) are separate questions: you can read the source while searching
 * your own text, or search the source and hide it.
 *
 * The picker is the same binding Refine's reference column makes — every
 * other project on this device, registered with the Library and bound under
 * `source` — so choosing one here is choosing it there. "No source text" only
 * hides the column on this screen; it does not unbind anything.
 */

import { Effect, Option, Result } from "effect";
import { Show, createEffect, createSignal } from "solid-js";

import type { BookId } from "#core/book/book";
import type { BookText, Excerpt } from "#core/excerpts/excerpts";
import { bookHeading } from "#core/galley";
import type { Resource } from "#core/resources/library";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import type { Paired } from "../excerpts";
import { listProjects, type ProjectSummary } from "../landing/summaries";
import { MultiSelect } from "../primitives";

/** One source book: still being read, absent from the source, or read. */
type Held = { readonly kind: "loading" } | { readonly kind: "missing" } | BookText;

const NONE = "";

/** `onBound` is told after a new source is bound, so the caller can re-register it. */
export function createFindSource(onBound: () => void) {
  const shell = useShell();
  const { services } = shell;

  const [resource, setResource] = createSignal<Resource | undefined>(undefined, {
    name: "findSource",
  });
  const [show, setShow] = createSignal(true, { name: "findSourceShown" });
  const [choices, setChoices] = createSignal<readonly ProjectSummary[]>([], {
    name: "findSourceChoices",
  });
  /** Raised by a bind, so the source re-resolves. */
  const [tick, setTick] = createSignal(0, { name: "findSourceTick" });
  /** Raised whenever a source book finishes reading, so the cards ask again. */
  const [read, setRead] = createSignal(0, { name: "findSourceRead" });
  const books = new Map<BookId, Held>();
  /** Bumped whenever the source may have changed, so a late read is dropped. */
  let generation = 0;

  createEffect(
    () => ({ project: shell.project()?.id, tick: tick() }),
    ({ project }) => {
      books.clear();
      generation += 1;
      if (project === undefined) {
        setResource(undefined);
        return;
      }
      void services
        .run(services.library.resolve(project, "source"))
        .then((found) => setResource(found[0]));
    },
  );

  // Every other project on this device, once per screen: a directory listing
  // and a JSON parse, and it only changes when somebody imports elsewhere.
  createEffect(
    () => shell.project()?.root,
    (open) => {
      const recent = services.settings.get(shellKeys(services.settings).recentProjects);
      void services
        .run(listProjects(services.projectsRoot, services.fixtureProject, recent))
        .then((rows) => setChoices(rows.filter((row) => row.root !== open)));
    },
  );

  /** Bind the project at `root` as this project's source, replacing whatever source it had. */
  const choose = (root: string): void => {
    const project = shell.project();
    if (project === undefined) return;
    if (root === NONE) {
      setShow(false);
      return;
    }
    setShow(true);
    if (resource()?.id === root) return;
    const previous = resource();
    void services
      .run(
        Effect.result(
          Effect.gen(function* () {
            const added = yield* services.library.add(root);
            if (previous !== undefined)
              yield* services.library.unbind(project.id, "source", previous.id);
            yield* services.library.bind(project.id, "source", added.id);
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
        onBound();
      });
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
          const analysis = services.galley.analyze(text, "find.source");
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

  /** The source's verse beside `excerpt`, or nothing when no source is shown. */
  const pairedOf = (excerpt: Excerpt): Paired | undefined => {
    read();
    const source = resource();
    if (!show() || source === undefined) return undefined;
    const held = bookOf(source, excerpt.bookId);
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

  /** Is a source shown beside the results? */
  const shown = (): boolean => show() && resource() !== undefined;

  /** The picker's rows: "no source text", then every other project here. */
  type Row = { readonly root: string; readonly name: string; readonly language: string };
  const rows = (): readonly Row[] => [
    { root: NONE, name: t("No source text"), language: "" },
    ...choices().map((row) => ({ root: row.root, name: row.name, language: row.language })),
  ];
  const chosen = (): string => (shown() ? (resource()?.id ?? NONE) : NONE);

  const Picker = () => (
    <MultiSelect
      single
      id="find-source"
      label={t("Source text")}
      summary={shown() ? (resource()?.title ?? "") : t("none")}
      narrowed={shown()}
      items={rows()}
      key={(row: Row) => row.root}
      match={(row, query) =>
        `${row.name} ${row.language}`.toLowerCase().includes(query.toLowerCase())
      }
      placeholder={t("Search texts…")}
      selected={(row) => row.root === chosen()}
      onToggle={(row) => choose(row.root)}
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

  return { resource, shown, pairedOf, Picker };
}
