/**
 * The reference column: the texts this project is being translated FROM and
 * ALONGSIDE, at the passage the editor is showing — and the one place a
 * reader binds one.
 *
 * It used to be a stack of cards holding a regex-sliced passage. It is now a
 * stack of READ-ONLY EDITORS (`ReferencePane`), one per bound resource, over
 * the same book the reader has open, painted by the same projection as the
 * editor beside them. That is the whole of Will's ask — "find reference text
 * should basically be a readonly editor in same facet/mode with a splitter
 * between it" — and it is a better answer than a card for a concrete reason: a
 * card showed a passage with the markers stripped by a regex, so it could not
 * show markup, could not be scrolled, and disagreed with the editor about what
 * a verse looks like. A pane is the same `decoField` over the same
 * `DocStructure`, so the two sides cannot drift.
 *
 * What stays from the card round: `source` and `reference` are two SLOTS and
 * not one list, because the distinction is the project's — a source is the
 * text this translation is made from and there is one of it, references are
 * everything else you keep open beside it. The source slot is shown first for
 * the same reason. The picker is unchanged: every project on this device that
 * is not the open one, registered with the Library if it is not already, then
 * bound. A reference Bible on this device IS another project, so there is no
 * second importer here and no second idea of what a resource is.
 *
 * Why the stack is remounted rather than reconciled: `Resizable` registers its
 * panels DURING render, in document order, and has no unregister — so a panel
 * list that changes length has to be a new split. `<Show keyed>` over the
 * entries array gives exactly that, and the only things that change it are
 * binding, unbinding and opening a different book, each of which is already a
 * reason to rebuild every pane.
 */

import { Effect, Result } from "effect";
import BookMarked from "lucide-solid/icons/book-marked";
import Plus from "lucide-solid/icons/plus";
import { For, Show, createEffect, createSignal } from "solid-js";

import type { Resource, Role } from "#core/resources/library";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { listProjects, type ProjectSummary } from "../landing/summaries";
import { Button, EmptyState, Popover, Resizable } from "../primitives";
import { ReferencePane } from "./ReferencePane";

/** The roles the column shows, in the order it shows them. */
const ROLES: readonly Role[] = ["source", "reference"];

interface Entry {
  readonly resource: Resource;
  readonly role: Role;
}

export interface ReferenceColumnProps {
  /**
   * How many resources are bound, reported as it changes. The ROUTE owns the
   * split, and a split with nothing to show in it collapses to the picker —
   * which is a layout decision about the row, so the row is told rather than
   * asking the Library a second time.
   */
  readonly onBound?: (count: number) => void;
}

export function ReferenceColumn(props: ReferenceColumnProps) {
  const shell = useShell();
  const { services } = shell;
  const [entries, setEntries] = createSignal<readonly Entry[]>([], { name: "referenceEntries" });
  const [loading, setLoading] = createSignal(true, { name: "referenceLoading" });
  /** Which slot's picker is open, if any. */
  const [picking, setPicking] = createSignal<Role | undefined>(undefined, {
    name: "referencePicking",
  });
  const [choices, setChoices] = createSignal<readonly ProjectSummary[] | undefined>(undefined, {
    name: "referenceChoices",
  });
  const [busy, setBusy] = createSignal(false, { name: "referenceBusy" });
  /** Raised by a bind or an unbind, so the bindings re-resolve. */
  const [bound, setBound] = createSignal(0, { name: "referenceBound" });

  // Named here rather than called from inside the resolve's `.then`, where a
  // bare `props.onBound` is a reactive read the Solid lint flags — correctly,
  // since a promise callback is not a tracked scope. The prop is a setter that
  // never changes; this is the one-line way to say so.
  const report = (count: number): void => props.onBound?.(count);

  /**
   * The BINDINGS, and nothing about the passage.
   *
   * This effect used to re-run on every scroll, because the cards it fed held
   * one passage each and the passage followed the reader. A pane holds the
   * whole book, so the only things that can change what is on screen here are
   * the project, the open book and a bind or unbind — and each of those is a
   * reason to rebuild the panes rather than to update them.
   */
  createEffect(
    () => ({ project: shell.project()?.id, book: shell.focused()?.id, tick: bound() }),
    ({ project }) => {
      if (project === undefined) {
        setEntries([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      void services
        .run(
          Effect.gen(function* () {
            const found: Entry[] = [];
            for (const role of ROLES)
              for (const resource of yield* services.library.resolve(project, role))
                found.push({ resource, role });
            return found;
          }),
        )
        .then((found: readonly Entry[]) => {
          setEntries(found);
          setLoading(false);
          report(found.length);
        });
    },
  );

  /**
   * Where the reader is, as a chapter NUMBER rather than an ordinal.
   *
   * The ordinal is an index into the OPEN book's chapter table, whose row 0 is
   * the front matter; the reference is a different file of the same book and
   * may count its rows differently. `\c`'s own label is the one thing the two
   * texts are guaranteed to agree about, so it is what crosses the gap.
   */
  const numberAt = (ordinal: number | null | undefined): number | undefined => {
    const book = shell.focused();
    if (book === undefined || ordinal === undefined || ordinal === null) return undefined;
    const label = book.structure().chapters[ordinal]?.label ?? "";
    const numbered = Number.parseInt(label, 10);
    return Number.isNaN(numbered) ? undefined : numbered;
  };

  /** The chapter at the top of the editor's viewport — the location watcher's reading. */
  const at = (): number | undefined => {
    const project = shell.project();
    return project === undefined ? undefined : numberAt(shell.lastLocation(project.root)?.at);
  };

  /** The chapter the editor is CLIPPED to, if it is clipped at all. */
  const clip = (): number | null => numberAt(shell.chapter()) ?? null;

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

  const hasSource = (): boolean => entries().some((entry) => entry.role === "source");

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
          class="w-full"
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

  /**
   * The panes, as one vertical split.
   *
   * Built from a plain `.map` and not a `<For>`: this component is remounted
   * whenever the list changes (see the header), so the array is fixed for its
   * whole life, and `Resizable.Panel` registers during render — which a `<For>`
   * would re-run without a way to unregister what it replaced.
   */
  const Stack = (stackProps: { readonly list: readonly Entry[]; readonly book: string }) => (
    <Resizable.Root orientation="vertical" class="min-h-0 flex-1">
      <For each={stackProps.list}>
        {(entry, index) => (
          <>
            <Show when={index() > 0}>
              <Resizable.Handle label={t("Resize {title}", { title: entry.resource.title })} />
            </Show>
            <Resizable.Panel class="flex min-h-0 flex-col">
              <ReferencePane
                resource={entry.resource}
                role={entry.role}
                bookId={stackProps.book}
                at={at}
                clip={clip}
                onUnbind={() => drop(entry)}
              />
            </Resizable.Panel>
          </>
        )}
      </For>
    </Resizable.Root>
  );

  /** The split's identity: a new list, or a new book, is a new split. */
  const stack = (): { readonly list: readonly Entry[]; readonly book: string } | undefined => {
    const list = entries();
    const book = shell.focused()?.id;
    return list.length === 0 || book === undefined ? undefined : { list, book };
  };

  return (
    <aside
      aria-label={t("Reference texts")}
      class="flex h-full min-w-0 flex-col gap-2 py-4 ps-1"
      data-references={entries().length}
    >
      <Show
        when={stack()}
        keyed
        fallback={
          <Show when={!loading()}>
            <EmptyState
              class="bg-surface-primary"
              icon={<BookMarked size={22} />}
              title={t("No reference texts yet")}
              description={t(
                "Choose another project on this device to read beside this one, at the passage you are in.",
              )}
            />
          </Show>
        }
      >
        {(held) => <Stack list={held.list} book={held.book} />}
      </Show>

      {/* One source, as many references as you like. The pickers live under
          the panes rather than between them: a pane is a page of scripture,
          and a button between two pages is a button in the reading. */}
      <div class="flex shrink-0 flex-col gap-1.5">
        <Show when={!hasSource()}>
          <Picker role="source" />
        </Show>
        <Picker role="reference" />
      </div>
    </aside>
  );
}
