/**
 * The reference column: the texts this project is being translated FROM and
 * ALONGSIDE, at the passage the editor is showing — and the one place a
 * reader binds one.
 *
 * Everything comes from `Library` (src/core/resources/library.ts): `resolve`
 * answers which resources a project binds to a role, `lookup` answers one
 * reference out of one of them, and `add`/`bind`/`unbind` are what the picker
 * below calls. All are Effects, so the column loads asynchronously and says
 * so — the editor never waits on a reference text.
 *
 * `source` and `reference` are two SLOTS and not one list, because the
 * distinction is the project's: a source is the text this translation is made
 * from and there is one of it, and references are everything else you keep
 * open beside it, of which there may be several. The source slot is shown
 * first for the same reason.
 *
 * Where the candidates come from: the project index the landing screen already
 * reads (`src/core/project/projectIndex.ts`, through `listProjects`), minus
 * the project that is open. A reference Bible on this device IS another
 * project — the same folder of USFM, imported the same way — so there is no
 * second importer here and no second idea of what a resource is. Choosing one
 * registers it with the Library if it is not registered already, then binds
 * it; the binding lives in `<appData>/library/library.json`, keyed by project.
 */

import { Effect, Option, Result } from "effect";
import BookMarked from "lucide-solid/icons/book-marked";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { For, Show, createEffect, createSignal } from "solid-js";

import type { Ref } from "../../../core/book/book";
import type { Resource, Role } from "../../../core/resources/library";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { listProjects, type ProjectSummary } from "../landing/summaries";
import { Button, Card, EmptyState, IconButton, Popover, cx } from "../primitives";

/** The roles the column shows, in the order it shows them. */
const ROLES: readonly Role[] = ["source", "reference"];

interface Entry {
  readonly resource: Resource;
  readonly role: Role;
  /** The passage at the editor's current place; empty when there is none. */
  readonly text: string;
}

/**
 * The passage as a person reads it.
 *
 * `Library.lookup` answers with the RAW USFM of the span — it slices on `\c`
 * and `\v` with a regex and says so, because the engine is not wired into it
 * yet (library.ts). A card is a place to read a verse, not to read markup, so
 * the markers are dropped here: a `\v 3` becomes a superscript-less "3 " and
 * every other marker goes. This is presentation and it belongs on this side of
 * the port; the day `lookup` returns spans the engine measured, this goes.
 */
const readable = (usfm: string): string =>
  usfm
    .replaceAll(/\\v[ \t]+(\d+(?:[-–]\d+)?)[ \t]*/gu, "$1 ")
    .replaceAll(/\\[a-z]+\d*\*?[ \t]*/giu, "")
    .replaceAll(/[ \t]*\n[ \t]*/gu, " ")
    .replaceAll(/[ \t]{2,}/gu, " ")
    .trim();

export function ReferenceColumn() {
  const shell = useShell();
  const { services } = shell;
  const [entries, setEntries] = createSignal<readonly Entry[]>([], { name: "referenceEntries" });
  const [loading, setLoading] = createSignal(true, { name: "referenceLoading" });
  const [expanded, setExpanded] = createSignal<string | undefined>(undefined, {
    name: "referenceExpanded",
  });
  /** Which slot's picker is open, if any. */
  const [picking, setPicking] = createSignal<Role | undefined>(undefined, {
    name: "referencePicking",
  });
  const [choices, setChoices] = createSignal<readonly ProjectSummary[] | undefined>(undefined, {
    name: "referenceChoices",
  });
  const [busy, setBusy] = createSignal(false, { name: "referenceBusy" });
  /** Raised by a bind or an unbind, so the cards re-resolve. */
  const [bound, setBound] = createSignal(0, { name: "referenceBound" });

  /**
   * What the column is showing: the focused book, and the chapter the reader
   * is actually looking at.
   *
   * The CHAPTER NUMBER, read off the chapter row's own label rather than
   * counted — the engine's first row is the front matter and carries no
   * number, so an ordinal is not a chapter. `lastLocation().at` is what the
   * editor measured for the location bar and wrote down (ProjectContext), so
   * the cards follow a free scroll and not only a clip.
   */
  const place = (): Ref | undefined => {
    const book = shell.focused();
    const project = shell.project();
    if (book === undefined || project === undefined) return undefined;
    const ordinal = shell.lastLocation(project.root)?.at ?? shell.chapter() ?? 0;
    const label = book.structure().chapters[ordinal]?.label ?? "";
    const numbered = Number.parseInt(label, 10);
    return { book: book.id, chapter: Number.isNaN(numbered) ? 1 : numbered };
  };

  // One pass per project/place/binding: resolve the bindings, then look up the
  // passage in each. Re-running on the place is the point — the cards follow
  // the editor.
  createEffect(
    () => ({ project: shell.project()?.id, at: place(), tick: bound() }),
    ({ project, at }) => {
      if (project === undefined) {
        setEntries([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      void services
        .run(
          Effect.gen(function* () {
            const library = services.library;
            const found: Entry[] = [];
            for (const role of ROLES) {
              for (const resource of yield* library.resolve(project, role)) {
                // `Effect.result` rather than a failure channel: a resource
                // with no file for this book is the ordinary case, and the
                // card for it says so instead of taking the column down.
                const looked =
                  at === undefined
                    ? undefined
                    : yield* Effect.result(library.lookup(resource.id, at));
                const passage =
                  looked !== undefined && Result.isSuccess(looked)
                    ? Option.getOrUndefined(looked.success)
                    : undefined;
                found.push({ resource, role, text: readable(passage?.text ?? "") });
              }
            }
            return found;
          }),
        )
        .then((found: readonly Entry[]) => {
          setEntries(found);
          setLoading(false);
        });
    },
  );

  /**
   * Every project on this device that is not the open one.
   *
   * Read once per opening of a picker, not once per render: it is a directory
   * listing and a JSON parse, and the answer only changes when someone imports
   * a project on another screen.
   */
  const offer = (): void => {
    if (choices() !== undefined) return;
    const recent = services.settings.get(shellKeys(services.settings).recentProjects);
    void services
      .run(listProjects(services.projectsRoot, services.fixtureProject, recent))
      .then(setChoices);
  };

  /** A project already bound here is not on offer; nor is the open one. */
  const candidates = (): readonly ProjectSummary[] => {
    const open = shell.project()?.root;
    return (choices() ?? []).filter(
      (row) => row.root !== open && !entries().some((entry) => entry.resource.id === row.root),
    );
  };

  /**
   * Registers the chosen folder if the Library has not seen it, then binds it
   * to this project under `role`.
   *
   * `add` is idempotent — it re-reads the metadata and replaces the entry — so
   * it is called unconditionally rather than after a lookup, which would be
   * one more question with the same answer.
   */
  const choose = (role: Role, row: ProjectSummary): void => {
    const project = shell.project();
    if (project === undefined) return;
    setPicking(undefined);
    setBusy(true);
    void services
      .run(
        Effect.result(
          Effect.gen(function* () {
            const resource = yield* services.library.add(row.root);
            yield* services.library.bind(project.id, role, resource.id);
            return resource;
          }),
        ),
      )
      .then((outcome) => {
        setBusy(false);
        if (Result.isFailure(outcome)) {
          shell.report(
            t("could not add {name}: {reason}", {
              name: row.name,
              reason: outcome.failure.description,
            }),
          );
          return;
        }
        shell.report(t("{name} is bound as {role}", { name: outcome.success.title, role }));
        setBound((held) => held + 1);
      });
  };

  const drop = (entry: Entry): void => {
    const project = shell.project();
    if (project === undefined) return;
    void services
      .run(services.library.unbind(project.id, entry.role, entry.resource.id))
      .then(() => {
        setBound((held) => held + 1);
      });
  };

  const slot = (role: Role): readonly Entry[] => entries().filter((entry) => entry.role === role);

  const label = (role: Role): string => (role === "source" ? t("Source") : t("Reference"));

  /** The picker for one slot. A source holds one; references hold many. */
  const Picker = (pickerProps: { readonly role: Role }) => (
    <Popover
      label={t("Choose a text")}
      side="bottom"
      align="start"
      class="max-h-[50vh] w-72 overflow-y-auto p-1"
      open={picking() === pickerProps.role}
      onOpenChange={(open) => {
        setPicking(open ? pickerProps.role : undefined);
        if (open) offer();
      }}
      trigger={
        <Button
          variant="secondary"
          size="sm"
          data-testid={`add-${pickerProps.role}`}
          disabled={busy()}
          icon={<Plus size={14} aria-hidden="true" />}
        >
          {pickerProps.role === "source" ? t("Add source…") : t("Add reference…")}
        </Button>
      }
    >
      <Show
        when={candidates().length > 0}
        fallback={
          <p class="px-2 py-3 text-small text-on-surface-tertiary">
            {choices() === undefined ? t("Looking…") : t("No other project on this device.")}
          </p>
        }
      >
        <For each={candidates()}>
          {(row) => (
            <button
              type="button"
              data-testid={`pick-${row.folder}`}
              class="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-start transition-colors hover:bg-surface-secondary"
              onClick={() => choose(pickerProps.role, row)}
            >
              <span class="text-small font-medium text-on-surface-primary">{row.name}</span>
              <span class="text-smallest text-on-surface-tertiary">
                {row.language === ""
                  ? t("{count} books", { count: row.books })
                  : t("{language} · {count} books", { language: row.language, count: row.books })}
              </span>
            </button>
          )}
        </For>
      </Show>
    </Popover>
  );

  return (
    <aside
      aria-label={t("Reference texts")}
      class="flex h-full min-w-0 flex-col gap-3 overflow-y-auto p-4"
      data-references={entries().length}
    >
      <For each={ROLES}>
        {(role) => (
          <>
            <For each={slot(role)}>
              {(entry) => (
                <Card
                  data-resource={entry.resource.id}
                  data-role={entry.role}
                  class="cursor-pointer transition-colors hover:border-brand/40"
                  onClick={() =>
                    setExpanded((held) =>
                      held === entry.resource.id ? undefined : entry.resource.id,
                    )
                  }
                >
                  <p
                    class={cx(
                      "font-scripture text-small text-on-surface-secondary",
                      expanded() === entry.resource.id ? undefined : "line-clamp-4",
                    )}
                  >
                    <Show when={entry.text !== ""} fallback={t("Nothing here for this passage.")}>
                      {entry.text}
                    </Show>
                  </p>
                  <hr class="my-3 border-surface-border" />
                  <div class="flex items-start gap-2">
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-small font-bold text-on-surface-primary">
                        {entry.resource.title}
                      </p>
                      <p class="text-smallest text-on-surface-tertiary">
                        {entry.resource.language === undefined
                          ? label(entry.role)
                          : t("{label} · {language}", {
                              label: label(entry.role),
                              language: entry.resource.language,
                            })}
                      </p>
                    </div>
                    {/* The × unbinds; it does not delete. The resource stays
                        registered and every other project's binding to it is
                        untouched — a role is a fact about THIS project. */}
                    <IconButton
                      size="sm"
                      data-testid={`unbind-${entry.resource.id}`}
                      label={t("Remove {title}", { title: entry.resource.title })}
                      tooltipSide="left"
                      icon={<X size={14} />}
                      onClick={(event) => {
                        event.stopPropagation();
                        drop(entry);
                      }}
                    />
                  </div>
                </Card>
              )}
            </For>
            {/* One source, as many references as you like. */}
            <Show when={role !== "source" || slot("source").length === 0}>
              <Picker role={role} />
            </Show>
          </>
        )}
      </For>

      <Show when={!loading() && entries().length === 0}>
        <EmptyState
          class="bg-surface-primary"
          icon={<BookMarked size={22} />}
          title={t("No reference texts yet")}
          description={t(
            "Choose another project on this device to read beside this one, at the passage you are in.",
          )}
        />
      </Show>
    </aside>
  );
}
