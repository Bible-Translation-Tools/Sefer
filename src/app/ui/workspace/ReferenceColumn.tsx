/**
 * The reference column: the texts this project is being translated FROM and
 * ALONGSIDE, at the passage the editor is showing — and the one place a
 * reader binds one.
 *
 * It shows ONE READ-ONLY EDITOR (`ReferencePane`) at a time over the book
 * the reader has open, painted by the same projection as the editor beside
 * it — a read-only editor in the same mode. With more than one text, the
 * pane's title is a select between them: a split stack of panes was noise in
 * a workspace meant to stay quiet (Will, 2026-10-08). Not a card holding a
 * regex-sliced passage: that could not show markup, could not be scrolled,
 * and would disagree with the editor about what a verse looks like. A pane is
 * the same `decoField` over the same `DocStructure`, so the two sides cannot
 * drift. The whole column can be shut from the editor's crumb strip
 * (`shell.referenceOpen`).
 *
 * What stays from the card round: `source` and `reference` are two SLOTS and
 * not one list, because the distinction is the project's — a source is the
 * text this translation is made from and there is one of it, references are
 * everything else you keep open beside it. The source slot is shown first for
 * the same reason. The picker offers the Library's own copies first — source
 * texts, then reference material, the PO's two words — and then every other
 * project on this device, registered with the Library if it is not already,
 * then bound.
 *
 * With nothing picked, the source slot shows what the project DECLARES
 * (`Library.resolve` falls back to it; Will, 2026-10-06). Such a pane has no
 * remove button, because nothing was picked to remove; choosing another text
 * replaces it. A declared text that is not on this device is offered for
 * download instead.
 *
 * The pane is remounted, not reconciled, for a different text or book: it
 * is an editor over one book's text, and a new text is a new document.
 */

import { Effect, Option, Result } from "effect";
import BookMarked from "lucide-solid/icons/book-marked";
import Plus from "lucide-solid/icons/plus";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { lastSegment } from "#core/fileSystem/path";
import { answers, type Resource, type Role } from "#core/resources/library";
import { highestVersions, type RelatedResource } from "#core/resources/relationships";

import { announceSourceTexts, libraryRevision } from "../../arrival";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { listProjects, type ProjectSummary } from "../landing/summaries";
import { Button, EmptyState, MultiSelect, Select } from "../primitives";
import { ReferencePane } from "./ReferencePane";

/** The roles the column shows, in the order it shows them. */
const ROLES: readonly Role[] = ["source", "reference"];

interface Entry {
  readonly resource: Resource;
  readonly role: Role;
  /** Shown because the project declares it, not because anyone picked it. */
  readonly declared: boolean;
}

/**
 * One row of the picker: a copy the Library holds, or another project. The
 * PO's words: a Bible is a source text, helps such as TN are reference
 * material (2026-10-06).
 */
type Choice =
  | { readonly kind: "library"; readonly resource: Resource }
  | { readonly kind: "project"; readonly row: ProjectSummary };

/** `textTranslation` (Burrito) and `Bible` (RC) are scripture; anything else is helps. */
const isBible = (resource: Resource): boolean =>
  resource.subject === undefined ||
  /^(bible|textTranslation|aligned bible)$/i.test(resource.subject);

const choiceKey = (choice: Choice): string =>
  choice.kind === "library" ? choice.resource.root : choice.row.root;

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
  const [choices, setChoices] = createSignal<readonly Choice[] | undefined>(undefined, {
    name: "referenceChoices",
  });
  /** Declared source texts with no copy on this device. */
  const [missing, setMissing] = createSignal<readonly RelatedResource[]>([], {
    name: "referenceMissing",
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
   * It does not re-run on scroll: a pane holds the whole book, so the only
   * things that can change what is on screen here are the project, the open
   * book and a bind or unbind — and each of those is a reason to rebuild the
   * panes rather than to update them.
   */
  createEffect(
    () => ({
      project: shell.project()?.root,
      book: shell.focused()?.id,
      tick: bound(),
      library: libraryRevision(),
      declared: Option.match(shell.project()?.metadata() ?? Option.none(), {
        onNone: (): readonly RelatedResource[] => [],
        onSome: (metadata) => highestVersions(metadata.related),
      }),
    }),
    ({ project, declared }) => {
      if (project === undefined) {
        setEntries([]);
        setMissing([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      void services
        .run(
          Effect.gen(function* () {
            const picked = new Set(
              (yield* services.library.picked(project)).map((each) => each.resource.id),
            );
            const found: Entry[] = [];
            for (const role of ROLES)
              for (const resource of yield* services.library.resolve(project, role))
                found.push({ resource, role, declared: !picked.has(resource.id) });
            const held = yield* services.library.resources();
            const absent = declared.filter(
              (ref) => !held.some((resource) => answers(resource, ref)),
            );
            return { found, absent };
          }),
        )
        // oxlint-disable-next-line solid/reactivity -- a promise continuation: runs once, when the bindings resolve
        .then(({ found, absent }) => {
          setEntries(found);
          setMissing(absent);
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
      .run(
        Effect.gen(function* () {
          const held = yield* services.library.resources();
          const copies = held.filter((resource) =>
            resource.root.startsWith(`${services.libraryRoot}/`),
          );
          const projects = yield* listProjects(
            services.projectsRoot,
            services.fixtureProject,
            recent,
          );
          return [
            ...copies.filter(isBible).map((resource): Choice => ({ kind: "library", resource })),
            ...copies
              .filter((resource) => !isBible(resource))
              .map((resource): Choice => ({ kind: "library", resource })),
            ...projects.map((row): Choice => ({ kind: "project", row })),
          ];
        }),
      )
      .then(setChoices);
  };

  /** Pulls the declared source texts that are not here, then shows them. */
  const download = (): void => {
    const project = shell.project();
    if (project === undefined) return;
    setBusy(true);
    void announceSourceTexts(services, project.root).finally(() => {
      setBusy(false);
      setBound((held) => held + 1);
    });
  };

  /** A text already shown here is not on offer; nor is the open project. */
  const candidates = (): readonly Choice[] => {
    const open = shell.project()?.root;
    return (choices() ?? []).filter((choice) => {
      const root = choiceKey(choice);
      return root !== open && !entries().some((entry) => entry.resource.root === root);
    });
  };

  /**
   * Registers the chosen folder if the Library has not seen it, then binds it
   * to this project under `role`.
   *
   * `add` is idempotent — it re-reads the metadata and replaces the entry — so
   * it is called unconditionally rather than after a lookup, which would be
   * one more question with the same answer.
   */
  const choose = (role: Role, choice: Choice): void => {
    const project = shell.project();
    if (project === undefined) return;
    setBusy(true);
    const root = choiceKey(choice);
    const name = choice.kind === "library" ? choice.resource.title : choice.row.name;
    void services
      .run(
        Effect.result(
          Effect.gen(function* () {
            const resource = yield* services.library.add(root);
            yield* services.library.pick(project.root, role, resource.id);
            return resource;
          }),
        ),
      )
      .then((outcome) => {
        setBusy(false);
        if (Result.isFailure(outcome)) {
          shell.report(
            t("could not add {name}: {reason}", {
              name,
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
      .run(services.library.unpick(project.root, entry.role, entry.resource.id))
      .then(() => {
        setBound((held) => held + 1);
      });
  };

  /**
   * The picker for one slot: the same searchable pick-one combobox Find's
   * source text uses, behind this column's own "Add source…" button.
   */
  const Picker = (pickerProps: { readonly role: Role; readonly replacing: boolean }) => (
    <MultiSelect
      single
      label={t("Choose a text")}
      summary=""
      narrowed={false}
      items={candidates()}
      key={choiceKey}
      match={(choice, query) =>
        (choice.kind === "library"
          ? `${choice.resource.title} ${choice.resource.language ?? ""}`
          : `${choice.row.name} ${choice.row.language}`
        )
          .toLowerCase()
          .includes(query.toLowerCase())
      }
      placeholder={t("Search texts…")}
      empty={choices() === undefined ? t("Looking…") : t("No other text on this device.")}
      selected={() => false}
      onToggle={(choice) => choose(pickerProps.role, choice)}
      onOpen={offer}
      trigger={
        <Button
          variant="secondary"
          size="sm"
          class="w-full"
          data-testid={`add-${pickerProps.role}`}
          disabled={busy()}
          icon={<Plus aria-hidden="true" />}
        >
          {pickerProps.replacing
            ? t("Choose another text…")
            : pickerProps.role === "source"
              ? t("Add source…")
              : t("Add reference…")}
        </Button>
      }
    >
      {(choice) => (
        <span
          data-testid={`pick-${choice.kind === "library" ? lastSegment(choice.resource.root) : choice.row.folder}`}
          class="flex min-w-0 flex-1 flex-col"
        >
          <span class="truncate font-medium">
            {choice.kind === "library" ? choice.resource.title : choice.row.name}
          </span>
          <span class="text-smallest text-on-surface-tertiary">
            {choice.kind === "library"
              ? [
                  isBible(choice.resource) ? t("Source text") : t("Reference material"),
                  choice.resource.language,
                  choice.resource.version,
                ]
                  .filter((part) => part !== undefined && part !== "")
                  .join(" · ")
              : choice.row.language === ""
                ? t("Your project · {count} books", { count: choice.row.books })
                : t("Your project · {language} · {count} books", {
                    language: choice.row.language,
                    count: choice.row.books,
                  })}
          </span>
        </span>
      )}
    </MultiSelect>
  );

  /** Which text the column shows, by resource id; the first when none was chosen. */
  const [chosen, setChosen] = createSignal<string | undefined>(undefined, {
    name: "referenceShown",
  });

  /**
   * The ONE pane, and the book it reads: a different text, or a different
   * book, is a new pane. Compared by ids so a re-resolve that finds the same
   * text does not rebuild the editor inside it.
   */
  type Shown = { readonly entry: Entry; readonly book: string } | undefined;
  const shown = createMemo(
    (): Shown => {
      const list = entries();
      const book = shell.focused()?.id;
      const entry = list.find((each) => each.resource.id === chosen()) ?? list[0];
      return entry === undefined || book === undefined ? undefined : { entry, book };
    },
    {
      name: "referenceShownPane",
      equals: (a: Shown, b: Shown) =>
        a?.entry.resource.id === b?.entry.resource.id &&
        a?.entry.declared === b?.entry.declared &&
        a?.book === b?.book,
    },
  );

  /** With more than one text, the pane's title is the choice between them. */
  const switcher = (current: Entry) =>
    entries().length > 1 ? (
      <Select
        size="sm"
        aria-label={t("Reference text")}
        data-testid="reference-switch"
        class="max-w-full font-bold"
        value={current.resource.id}
        onChange={(event) => setChosen(event.currentTarget.value)}
      >
        <For each={entries()}>
          {(entry) => <option value={entry.resource.id}>{entry.resource.title}</option>}
        </For>
      </Select>
    ) : undefined;

  return (
    <aside
      aria-label={t("Reference texts")}
      class="flex h-full min-w-0 flex-col gap-2 py-4 ps-1"
      data-references={entries().length}
    >
      <Show
        when={shown()}
        keyed
        fallback={
          <Show when={!loading()}>
            <EmptyState
              class="bg-surface-primary"
              icon={<BookMarked size={22} />}
              title={t("No reference texts yet")}
              description={t(
                "Choose a source text, or another project on this device, to read beside this one at the passage you are in.",
              )}
            />
          </Show>
        }
      >
        {(held) => (
          <div class="flex min-h-0 flex-1 flex-col">
            <ReferencePane
              resource={held.entry.resource}
              role={held.entry.role}
              bookId={held.book}
              clip={clip}
              title={switcher(held.entry)}
              {...(held.entry.declared ? {} : { onUnbind: () => drop(held.entry) })}
            />
          </div>
        )}
      </Show>

      {/* One text for now: a source, and only while there is none. The
          source/reference distinction was not clear to people, so the
          reference picker is gone until it is; references bound before still
          show. The picker lives under the pane rather than above it: a pane
          is a page of scripture, and a button above it is a button in the
          reading. */}
      {/* Only while nothing is picked: a person who chose a text has answered
          the question this row asks. */}
      <Show when={!loading() && missing().length > 0 && entries().every((entry) => entry.declared)}>
        <div
          data-testid="declared-missing"
          class="flex shrink-0 flex-col gap-1.5 rounded-md bg-surface-secondary px-3 py-2 text-small"
        >
          <p class="text-on-surface-secondary">
            {t("This project's source text is not on this device: {texts}.", {
              texts: missing()
                .map((ref) =>
                  ref.version === undefined
                    ? `${ref.language}_${ref.resource}`
                    : `${ref.language}_${ref.resource} ${ref.version}`,
                )
                .join(", "),
            })}
          </p>
          <Button variant="secondary" size="sm" disabled={busy()} onClick={download}>
            {t("Download")}
          </Button>
        </div>
      </Show>

      <Show when={!loading() && entries().every((entry) => entry.declared)}>
        <div class="flex shrink-0 flex-col gap-1.5">
          <Picker role="source" replacing={entries().length > 0} />
        </div>
      </Show>
    </aside>
  );
}
