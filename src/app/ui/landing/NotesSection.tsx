/**
 * Reference material on the projects page: the notes (and, later, other
 * helps) on this device, and what can be downloaded, in one short list with
 * a search box. The same downloads the reference column's menu offers, from
 * the same place (`downloadHelp`, `HELP_TEXTS`), with the same toast.
 *
 * A row on this device can be removed: the Library forgets it and its folder
 * in the Library's own directory goes, which is a reference copy and nobody's
 * work. Projects that had picked it simply show nothing for it, as the
 * reference column does for a text that is gone.
 *
 * What counts as reference material is the kind table's answer
 * (`roleFor(resource) !== "source"`), never a subject string.
 */

import { Effect } from "effect";
import Download from "lucide-solid/icons/download";
import NotebookText from "lucide-solid/icons/notebook-text";
import SearchIcon from "lucide-solid/icons/search";
import Trash from "lucide-solid/icons/trash-2";
import { For, Show, createEffect, createSignal } from "solid-js";

import type { Resource } from "#core/resources/library";
import { normaliseRepoUrl } from "#core/resources/relationships";

import { libraryRevision, noteLibraryChanged } from "../../arrival";
import { HELP_TEXTS, type HelpText } from "../../catalogue";
import { describe } from "../../describe";
import { t } from "../../i18n";
import { downloadHelp, helpDownloads, helpUrl } from "../../kinds/download";
import { roleFor } from "../../kinds/table";
import { useShell } from "../../ProjectContext";
import { Button, Card, Input, PanelHeader, toasts } from "../primitives";

/** "English", from a tag; the tag itself when the browser does not know it. */
const languageName = (code: string | undefined): string => {
  if (code === undefined || code === "") return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** One row: a copy on this device, or a help to download. */
type Row =
  | { readonly kind: "held"; readonly resource: Resource }
  | { readonly kind: "offered"; readonly help: HelpText };

export function NotesSection() {
  const shell = useShell();
  const { services } = shell;
  const [held, setHeld] = createSignal<readonly Resource[]>([], { name: "notesHeld" });
  const [query, setQuery] = createSignal("", { name: "notesQuery" });

  // The Library's reference material, re-read whenever it gains or loses a copy.
  createEffect(
    () => libraryRevision(),
    () => {
      void services
        .run(services.library.resources())
        .then((all) => setHeld(all.filter((resource) => roleFor(resource) !== "source")));
    },
  );

  const rows = (): readonly Row[] => {
    const urls = new Set(
      held().flatMap((resource) =>
        resource.upstream === undefined ? [] : [normaliseRepoUrl(resource.upstream.url)],
      ),
    );
    const offered = HELP_TEXTS.filter((help) => {
      const url = helpUrl(services, help);
      return url !== undefined && !urls.has(normaliseRepoUrl(url));
    });
    const all: Row[] = [
      ...held().map((resource): Row => ({ kind: "held", resource })),
      ...offered.map((help): Row => ({ kind: "offered", help })),
    ];
    const words = query().trim().toLowerCase();
    if (words === "") return all;
    return all.filter((row) => {
      const title = row.kind === "held" ? row.resource.title : row.help.title;
      const code = row.kind === "held" ? (row.resource.language ?? "") : row.help.language;
      return `${title} ${code} ${languageName(code)}`.toLowerCase().includes(words);
    });
  };

  const download = (help: HelpText): void => {
    // The toast says how it went, either way.
    void downloadHelp(services, help).catch(() => undefined);
  };

  const remove = (resource: Resource): void => {
    void services
      .run(
        Effect.gen(function* () {
          yield* services.library.remove(resource.id);
          // Only a copy in the Library's own folder is ours to delete; a
          // folder someone picked stays where it is.
          if (resource.root.startsWith(`${services.libraryRoot}/`))
            yield* Effect.ignore(services.fileSystem.remove(resource.root, { recursive: true }));
        }),
      )
      .then(() => {
        noteLibraryChanged();
        toasts.success({ title: t("Removed {title}", { title: resource.title }) });
      })
      .catch((cause: unknown) =>
        toasts.error({
          title: t("Could not remove {title}", { title: resource.title }),
          message: describe(cause),
        }),
      );
  };

  return (
    <section class="shrink-0 space-y-3" data-tour="notes-section">
      <div class="flex flex-wrap items-center gap-3">
        <PanelHeader title={t("Translation Notes")} class="me-auto" />
        <Input
          type="search"
          wrapperClass="w-full sm:w-72"
          class="w-full"
          icon={<SearchIcon size={18} aria-hidden="true" />}
          aria-label={t("Search reference material")}
          placeholder={t("Search notes by language or title…")}
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          data-tour="notes-search"
        />
      </div>
      <Card padded={false}>
        <Show
          when={rows().length > 0}
          fallback={
            <p class="px-6 py-4 text-small text-on-surface-tertiary">
              {query().trim() === ""
                ? t("No reference material is available from this cloud.")
                : t("Nothing matches “{query}”.", { query: query().trim() })}
            </p>
          }
        >
          <ul data-notes-rows={rows().length}>
            <For each={rows()}>
              {(row) => (
                <li class="flex items-center gap-4 border-b border-surface-border px-6 py-3 last:border-b-0">
                  <NotebookText
                    size={20}
                    aria-hidden="true"
                    class="shrink-0 text-on-surface-tertiary"
                  />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <strong class="truncate font-medium text-on-surface-primary">
                      {row.kind === "held" ? row.resource.title : row.help.title}
                    </strong>
                    <span class="truncate text-smallest text-on-surface-tertiary">
                      {row.kind === "held"
                        ? t("{language} · on this device", {
                            language: languageName(row.resource.language),
                          })
                        : t("{language} · {repository}", {
                            language: languageName(row.help.language),
                            repository: row.help.repository,
                          })}
                    </span>
                  </span>
                  <Show
                    when={row.kind === "offered" ? row.help : undefined}
                    fallback={
                      <Button
                        variant="link"
                        size="flush"
                        data-tour="notes-remove"
                        icon={<Trash size={16} aria-hidden="true" />}
                        onClick={() => {
                          if (row.kind === "held") remove(row.resource);
                        }}
                      >
                        {t("Remove")}
                      </Button>
                    }
                  >
                    {(help) => (
                      <Button
                        variant="link"
                        size="flush"
                        data-tour="notes-download"
                        data-repository={help().repository}
                        loading={helpDownloads().has(help().repository)}
                        icon={<Download size={16} aria-hidden="true" />}
                        onClick={() => download(help())}
                      >
                        {t("Download")}
                      </Button>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Card>
    </section>
  );
}
