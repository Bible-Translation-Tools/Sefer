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
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import Download from "lucide-solid/icons/download";
import PanelLeftClose from "lucide-solid/icons/panel-left-close";
import { For, Show, createEffect, createSignal } from "solid-js";

import type { Resource, Role } from "#core/resources/library";

import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import {
  DEFAULT_SOURCE_LANGUAGE,
  gatewayTextFor,
  gatewayTexts,
  useGatewaySource,
  type GatewayText,
} from "../../workflows/gatewaySources";
import { EmptyState, IconButton, Menu, MenuItem } from "../primitives";
import { metadataOf } from "./project";
import { ReferenceCard } from "./ReferenceCard";
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
  /**
   * Folded to its cards, or open: the ROUTE narrows the column for the cards,
   * as it does when nothing is bound.
   */
  readonly onFolded?: (folded: boolean) => void;
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
  /**
   * The one text on show. The reader's pick, while it is still bound; else
   * the first source bound.
   */
  const [picked, setPicked] = createSignal<string | undefined>(undefined, {
    name: "referencePicked",
  });
  /** Gateway texts already on this device, bound to this project or not. */
  const [onDevice, setOnDevice] = createSignal<readonly Resource[]>([], {
    name: "referenceOnDevice",
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
          void services.run(services.library.resources()).then((all) => {
            setOnDevice(
              all.filter((resource) => resource.root.startsWith(`${services.sourcesRoot}/`)),
            );
          });
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

  /** Installed: bound to this project, or downloaded to this device. One per text. */
  const installed = (): readonly Resource[] => {
    const seen = new Map<string, Resource>();
    for (const entry of entries()) seen.set(entry.resource.id, entry.resource);
    for (const resource of onDevice()) if (!seen.has(resource.id)) seen.set(resource.id, resource);
    return [...seen.values()];
  };
  /** The catalogue's gateway languages not on this device yet. */
  const downloadable = (): readonly GatewayText[] =>
    (choices() ?? []).filter(
      (text) =>
        !installed().some(
          (resource) => resource.root === `${services.sourcesRoot}/${text.entry.repo}`,
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
        setPicked(`${services.sourcesRoot}/${text.entry.repo}`);
        setBound((held) => held + 1);
        return true;
      });
  };

  /**
   * A project with nothing bound gets its default source: its own gateway
   * language when its manifest names one, else English. ONCE per project on
   * this device (`defaultedSources`): after that, nothing is fetched on the
   * reader's behalf, so a text they removed stays removed — "Add source…"
   * still offers it.
   */
  const defaultedKey = shellKeys(services.settings).defaultedSources;
  const defaulted = {
    has: (id: string): boolean => services.settings.get(defaultedKey).includes(id),
    add: (id: string): void => {
      const held = services.settings.get(defaultedKey);
      if (!held.includes(id)) void services.settings.set(defaultedKey, [...held, id]);
    },
  };
  createEffect(
    () => ({ project: shell.project(), ready: !loading(), count: entries().length }),
    ({ project, ready, count }) => {
      if (project === undefined || !ready || defaulted.has(project.id)) return;
      // A project that already has a source has made its own choice: noted,
      // so nothing is ever fetched for it automatically later either.
      defaulted.add(project.id);
      if (count > 0) return;
      const language = metadataOf(project)?.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE;
      void texts().then((read) => {
        const text =
          gatewayTextFor(read, language) ?? gatewayTextFor(read, DEFAULT_SOURCE_LANGUAGE);
        if (text !== undefined) void choose(text);
      });
    },
  );

  /** The entry on show: the reader's pick while it is bound, else the first source. */
  const shown = (): Entry | undefined => {
    const list = entries();
    const want = picked();
    return (
      list.find((entry) => entry.resource.id === want) ??
      list.find((entry) => entry.role === "source") ??
      list[0]
    );
  };

  /** The pane's identity: the text on show and the open book. Either new, a new pane. */
  const onShow = (): { readonly entry: Entry; readonly book: string } | undefined => {
    const entry = shown();
    const book = shell.focused()?.id;
    return entry === undefined || book === undefined ? undefined : { entry, book };
  };

  /** Shows an installed text, binding it to this project first if it is not yet. */
  const show = (resource: Resource): void => {
    const project = shell.project();
    if (project === undefined) return;
    setPicked(resource.id);
    if (entries().some((entry) => entry.resource.id === resource.id)) return;
    void services
      .run(services.library.bind(project.id, "source", resource.id))
      .then(() => setBound((held) => held + 1));
  };

  /** "English (en)": the language's name in English, then its tag. */
  const nameOf = (resource: Resource | undefined): string => {
    if (resource === undefined) return "";
    // The Library's language when it read one; else, for a gateway text, the
    // tag its repository is named for (`en_ulb`, `pt-br_ulb`).
    const repo = resource.root.startsWith(`${services.sourcesRoot}/`)
      ? (resource.root.split("/").at(-1) ?? "")
      : "";
    const code = resource.language ?? (repo.includes("_") ? (repo.split("_")[0] ?? "") : "");
    if (code === "") return resource.title;
    let name = code;
    try {
      name = new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
    } catch {
      name = code;
    }
    return `${name} (${code})`;
  };

  /** Folded to a stack of cards, one per installed text. */
  const [folded, setFolded] = createSignal(false, { name: "referenceFolded" });
  const fold = (next: boolean): void => {
    setFolded(next);
    props.onFolded?.(next);
  };
  /** "English": the language alone, for a card. */
  const languageOf = (resource: Resource): string => nameOf(resource).replace(/ \([^)]*\)$/u, "");

  const [showOthers, setShowOthers] = createSignal(false, { name: "referenceShowOthers" });
  /** Rows: 48px, 24px sides; the menu's own 8px plus 4px here is 12px above and below. */
  const ROW = "px-6";

  /**
   * The reference language: what is installed, and below it, folded away,
   * the other gateway languages to download. Replaces "Add source…".
   */
  const LanguagePicker = () => (
    <Menu
      label={t("Reference language")}
      // Folded again each time it opens: the installed texts come first.
      onOpenChange={(open) => {
        if (open) setShowOthers(false);
      }}
      side="bottom"
      align="start"
      class="w-80"
      fitViewport
      trigger={
        <button
          type="button"
          data-testid="reference-language"
          disabled={busy()}
          onClick={offer}
          class="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-2xl bg-surface-primary p-3 text-start transition-colors hover:bg-surface-secondary disabled:cursor-wait"
        >
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-small text-on-surface-secondary">{t("Reference language")}</span>
            <span class="truncate text-small font-semibold text-on-surface-primary">
              {fetching() === ""
                ? nameOf(shown()?.resource) || t("None yet")
                : t("Getting {language}…", { language: fetching() })}
            </span>
          </span>
          <ChevronDown aria-hidden="true" class="size-5 shrink-0 text-on-surface-primary" />
        </button>
      }
    >
      <div class="scrollbar-padded max-h-[min(60vh,25.5rem)] overflow-y-auto py-1">
        <For each={installed()}>
          {(resource) => (
            <MenuItem class={ROW} onSelect={() => show(resource)}>
              <span class="min-w-0 flex-1 truncate">{nameOf(resource)}</span>
              <Show when={shown()?.resource.id === resource.id}>
                <Check aria-label={t("Showing")} class="size-5 shrink-0 text-brand" />
              </Show>
            </MenuItem>
          )}
        </For>
        <Show when={downloadable().length > 0}>
          <button
            type="button"
            data-testid="reference-other-languages"
            aria-expanded={showOthers() ? "true" : "false"}
            class={`${ROW} flex h-12 w-full cursor-pointer items-center gap-3 text-start text-small font-semibold text-on-surface-primary outline-none hover:bg-surface-secondary focus-visible:bg-surface-secondary`}
            onClick={() => setShowOthers(!showOthers())}
          >
            <span class="min-w-0 flex-1">
              {t("Other languages ({count})", { count: downloadable().length })}
            </span>
            <Show when={showOthers()} fallback={<ChevronDown aria-hidden="true" class="size-5" />}>
              <ChevronUp aria-hidden="true" class="size-5" />
            </Show>
          </button>
          <Show when={showOthers()}>
            <For each={downloadable()}>
              {(text) => (
                <MenuItem
                  class={ROW}
                  data-testid={`pick-${text.code}`}
                  title={t("Download {language} to read beside this project", {
                    language: text.name,
                  })}
                  onSelect={() => void choose(text)}
                >
                  <span class="min-w-0 flex-1 truncate">{text.name}</span>
                  <Download aria-hidden="true" class="size-5 shrink-0" />
                </MenuItem>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </Menu>
  );

  return (
    <aside
      aria-label={t("Reference texts")}
      class="flex h-full min-w-0 flex-col gap-3 py-4 pe-[7.5px]"
      data-references={entries().length}
    >
      <Show
        when={!folded()}
        fallback={
          // Folded: one card per installed text; pressing one opens the
          // column on it.
          <div class="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <For each={installed()}>
              {(resource) => (
                <ReferenceCard
                  resource={resource}
                  bookId={shell.focused()?.id ?? ""}
                  language={languageOf(resource)}
                  onOpen={() => {
                    show(resource);
                    fold(false);
                  }}
                />
              )}
            </For>
          </div>
        }
      >
        <div class="flex items-center gap-controls">
          <div class="min-w-0 flex-1">
            <LanguagePicker />
          </div>
          <IconButton
            variant="subtle"
            data-testid="reference-fold"
            label={t("Collapse the reference text")}
            icon={<PanelLeftClose />}
            onClick={() => fold(true)}
          />
        </div>
        {/* One text, straight on the page: the picker above says whose it is. */}
        <Show
          when={onShow()}
          keyed
          fallback={
            <Show when={!loading()}>
              <EmptyState
                icon={<BookMarked size={22} />}
                title={
                  fetching() === ""
                    ? t("No source text yet")
                    : t("Getting {language}…", { language: fetching() })
                }
                description={
                  fetching() === ""
                    ? t("Choose a reference language above to read beside this project.")
                    : t("Downloading it once, to read beside this project.")
                }
              />
            </Show>
          }
        >
          {(held) => (
            <div class="flex min-h-0 flex-1 flex-col">
              <ReferencePane
                bare
                resource={held.entry.resource}
                role={held.entry.role}
                bookId={held.book}
                clip={clip}
              />
            </div>
          )}
        </Show>
      </Show>
    </aside>
  );
}
