/**
 * The reference column: the texts this project is being translated FROM and
 * ALONGSIDE, at the passage the editor is showing — and the one place a
 * reader binds one.
 *
 * It is a stack of READ-ONLY EDITORS (`ReferencePane`), one per bound
 * resource, over the same book the reader has open, painted by the same
 * projection as the editor beside them — a read-only editor in the same mode,
 * with a splitter between. Not a card holding a regex-sliced passage: that
 * could not show markup, could not be scrolled, and would disagree with the
 * editor about what a verse looks like. A pane is the same `decoField` over
 * the same `DocStructure`, so the two sides cannot drift.
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

import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  DEFAULT_SOURCE_LANGUAGE,
  gatewayTextFor,
  gatewayTexts,
  useGatewaySource,
  type GatewayText,
} from "../../workflows/gatewaySources";
import { Button, EmptyState, MultiSelect, Resizable } from "../primitives";
import { metadataOf } from "./project";
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
  /** The gateway languages on offer, once the catalogue has answered. */
  const [choices, setChoices] = createSignal<readonly GatewayText[] | undefined>(undefined, {
    name: "referenceChoices",
  });
  /** What is being fetched right now, said in the panel while it is. */
  const [fetching, setFetching] = createSignal("", { name: "referenceFetching" });
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
        // oxlint-disable-next-line solid/reactivity -- a promise continuation: runs once, when the bindings resolve
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

  /** The chapter the editor is CLIPPED to, if it is clipped at all. */
  const clip = (): number | null => numberAt(shell.chapter()) ?? null;

  /**
   * The gateway languages, read from the catalogue the first time anything
   * asks — the picker opening, or a project needing its default source.
   */
  const texts = async (): Promise<readonly GatewayText[]> => {
    const held = choices();
    if (held !== undefined) return held;
    const read = await gatewayTexts(services).catch((): readonly GatewayText[] => []);
    setChoices(read);
    return read;
  };
  const offer = (): void => {
    void texts();
  };

  /** A gateway text already bound here is not on offer again. */
  const candidates = (): readonly GatewayText[] =>
    (choices() ?? []).filter(
      (text) =>
        !entries().some(
          (entry) => entry.resource.root === `${services.sourcesRoot}/${text.entry.repo}`,
        ),
    );

  /**
   * Makes `text` a source of this project: downloaded into the Library's
   * folder if it is not on this device yet, then bound. A gateway text is
   * never a project of its own (`workflows/gatewaySources.ts`).
   */
  const choose = (text: GatewayText): Promise<boolean> => {
    const project = shell.project();
    if (project === undefined) return Promise.resolve(false);
    setBusy(true);
    setFetching(text.name);
    return services
      .run(Effect.result(useGatewaySource(services, project.id, text)))
      .then((outcome) => {
        setBusy(false);
        setFetching("");
        if (Result.isFailure(outcome)) {
          shell.report(
            t("could not add {name}: {reason}", {
              name: text.name,
              reason: describe(outcome.failure),
            }),
          );
          return false;
        }
        setBound((held) => held + 1);
        return true;
      });
  };

  /**
   * A project with nothing bound gets its default source: its own gateway
   * language when its manifest names one, else English. Once per project per
   * session, so removing it on purpose is not undone behind the reader's back.
   */
  const defaulted = new Set<string>();
  createEffect(
    () => ({ project: shell.project(), ready: !loading(), count: entries().length }),
    ({ project, ready, count }) => {
      if (project === undefined || !ready || count > 0 || defaulted.has(project.id)) return;
      defaulted.add(project.id);
      const language = metadataOf(project)?.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE;
      void texts().then((read) => {
        const text =
          gatewayTextFor(read, language) ?? gatewayTextFor(read, DEFAULT_SOURCE_LANGUAGE);
        if (text !== undefined) void choose(text);
      });
    },
  );

  const drop = (entry: Entry): void => {
    const project = shell.project();
    if (project === undefined) return;
    void services
      .run(services.library.unbind(project.id, entry.role, entry.resource.id))
      .then(() => {
        setBound((held) => held + 1);
      });
  };

  /**
   * The picker for one slot: the same searchable pick-one combobox Find's
   * source text uses, behind this column's own "Add source…" button.
   */
  const Picker = () => (
    <MultiSelect
      single
      label={t("Choose a gateway language")}
      summary=""
      narrowed={false}
      items={candidates()}
      key={(text: GatewayText) => text.entry.id}
      match={(text, query) =>
        `${text.name} ${text.code}`.toLowerCase().includes(query.toLowerCase())
      }
      placeholder={t("Search languages…")}
      empty={choices() === undefined ? t("Looking…") : t("No other gateway language to add.")}
      selected={() => false}
      onToggle={(text) => void choose(text)}
      onOpen={offer}
      trigger={
        <Button
          variant="secondary"
          class="w-full"
          data-testid="add-source"
          disabled={busy()}
          icon={<Plus aria-hidden="true" />}
        >
          {t("Add source…")}
        </Button>
      }
    >
      {(text) => (
        <span data-testid={`pick-${text.code}`} class="flex min-w-0 flex-1 flex-col">
          <span class="truncate font-medium">{text.name}</span>
          <span class="text-small text-on-surface-primary">{text.entry.repo}</span>
        </span>
      )}
    </MultiSelect>
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
                clip={clip}
                onUnbind={stackProps.list.length > 1 ? () => drop(entry) : undefined}
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
              title={
                fetching() === ""
                  ? t("No source text yet")
                  : t("Getting {language}…", { language: fetching() })
              }
              description={
                fetching() === ""
                  ? t("Add a gateway language to read beside this project.")
                  : t("Downloading it once, to read beside this project.")
              }
            />
          </Show>
        }
      >
        {(held) => <Stack list={held.list} book={held.book} />}
      </Show>

      {/* Always there: another gateway language can be added beside the
          ones bound. Under the panes rather than above them — a pane is a
          page of scripture, and a button above it is a button in the reading. */}
      <Show when={!loading()}>
        <div class="flex shrink-0 flex-col gap-1.5">
          <Show when={fetching() !== "" && stack() !== undefined}>
            <p class="text-small text-on-surface-primary">
              {t("Getting {language}…", { language: fetching() })}
            </p>
          </Show>
          <Picker />
        </div>
      </Show>
    </aside>
  );
}
