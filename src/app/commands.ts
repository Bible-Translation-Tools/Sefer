import { withoutScrolling } from "@sefer/editor";
import type { EditorAction, EditorBook, ProjectionName } from "@sefer/editor";
import type { UseNavigateResult } from "@tanstack/solid-router";
import { Effect, Option, Result, type Scope } from "effect";
import { createSignal } from "solid-js";

import { applyFormat, applyOverlay, formatBook, overlayBook } from "#core/fixes/fixes";
import { makeMultiBook } from "#core/multibook/multibook";
import { Observability, type ObservabilityService } from "#core/observability";
import type { Project } from "#core/project/project";

import { personAuthor } from "./author";
import { contentHostFor } from "./endpoints";
import { t } from "./i18n";
import { recordVersion } from "./recordVersion";
import type { Domain, Services } from "./services";
import { shellKeys } from "./settings";
import { copyPlaceLink } from "./shareLinks";
import type { ShellEvent } from "./shellEvent";
import { sendAfterSave, sendNow } from "./syncActions";
import { syncPreferences } from "./syncSettings";
import { sendOutcomeCopy } from "./ui/cloud/copy";
import { bookName } from "./ui/workspace/books";

export type CommandResult =
  | Effect.Effect<unknown, unknown, Domain | Scope.Scope>
  | Promise<unknown>
  | void;

export interface CommandSpec {
  readonly id: string;
  readonly title: string;
  readonly run: (argument?: unknown) => CommandResult;
  readonly when?: () => boolean;
  readonly keys?: string;
}

export interface Command extends CommandSpec {
  readonly available: () => boolean;
}

export interface ShellBridge {
  readonly services: Services;
  readonly project: () => Project | undefined;
  readonly focused: () => EditorBook | undefined;
  readonly mode: () => ProjectionName;
  readonly setMode: (mode: ProjectionName) => void;
  readonly chapter: () => number | null;
  readonly setChapter: (ordinal: number | null) => void;
  readonly chapterCount: () => number;
  readonly historyDepth: () => { readonly undo: number; readonly redo: number };
  readonly stepFinding: (delta: 1 | -1) => void;
  readonly applyFix: () => void;
  readonly navigate: UseNavigateResult<string>;
  readonly slug: () => string;
  readonly openProject: (root: string) => Promise<void>;
  readonly setPaletteOpen: (open: boolean) => void;
  readonly sidebarOpen: () => boolean;
  readonly setSidebarOpen: (open: boolean) => void;
  readonly aim: (bookId: string, from: number, to?: number) => void;
  readonly report: (message: string) => void;
  readonly changed: (event: ShellEvent) => void;
}

// ownedWrite: commands register while the shell is built inside an owner, where Solid 2 throws on an unmarked write.
const [registry, setRegistry] = createSignal<readonly Command[]>([], {
  name: "commands",
  ownedWrite: true,
});

export const availableCommands = (): readonly Command[] =>
  registry().filter((command) => command.available());

let runner: ((effect: Effect.Effect<unknown, unknown, Domain | Scope.Scope>) => void) | undefined;

let narrator: ObservabilityService | undefined;

const setCommandObservability = (observability: ObservabilityService): void => {
  narrator = observability;
};

const setCommandRunner = (
  run: (effect: Effect.Effect<unknown, unknown, Domain | Scope.Scope>) => void,
): void => {
  runner = run;
};

export const registerCommand = (spec: CommandSpec): (() => void) => {
  const command: Command = { ...spec, available: () => spec.when?.() ?? true };
  setRegistry((held) => [...held.filter((other) => other.id !== spec.id), command]);
  return () => {
    setRegistry((held) => held.filter((other) => other !== command));
  };
};

export const findCommand = (id: string): Command | undefined =>
  registry().find((command) => command.id === id);

export const runCommand = (id: string, argument?: unknown): void => {
  const command = findCommand(id);
  if (command === undefined || !command.available()) return;
  const gesture = narrator?.operation(`command.${id}`);
  const outcome = command.run(argument);
  if (outcome === undefined) {
    gesture?.end("ready");
    return;
  }
  if (Effect.isEffect(outcome)) {
    if (runner === undefined) {
      gesture?.end("failed");
      throw new Error(`command ${id} returned an Effect before a command runner was installed`);
    }
    runner(
      Effect.onExit(
        gesture === undefined ? outcome : Effect.provideService(outcome, Observability, gesture),
        (exit) =>
          Effect.sync(() => {
            gesture?.end(exit._tag === "Success" ? "ready" : "failed");
          }),
      ),
    );
    return;
  }
  gesture?.end("ready");
  void outcome;
};

const MOD = (event: KeyboardEvent): boolean => (event.metaKey ? true : event.ctrlKey);

const matches = (keys: string, event: KeyboardEvent): boolean => {
  const parts = keys.split("-");
  const key = parts[parts.length - 1] ?? "";
  const wantMod = parts.includes("Mod");
  const wantShift = parts.includes("Shift");
  const wantAlt = parts.includes("Alt");
  if (MOD(event) !== wantMod || event.shiftKey !== wantShift || event.altKey !== wantAlt)
    return false;
  return event.key.toLowerCase() === key.toLowerCase();
};

const editing = (target: EventTarget | null): boolean => {
  if (target === null || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
};

export const installCommandKeys = (target: Document): (() => void) => {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const bare = !(event.metaKey || event.ctrlKey || event.altKey);
    if (bare && editing(event.target)) return;
    for (const command of registry()) {
      if (command.keys === undefined || !matches(command.keys, event)) continue;
      if (!command.available()) continue;
      event.preventDefault();
      runCommand(command.id);
      return;
    }
  };
  target.addEventListener("keydown", onKeyDown);
  return () => {
    target.removeEventListener("keydown", onKeyDown);
  };
};

type Helpers = {
  readonly hasProject: () => boolean;
  readonly hasBook: () => boolean;
  readonly seated: () => EditorBook | undefined;
  readonly insertion: (
    id: string,
    title: string,
    keys: string | undefined,
    action: EditorAction,
  ) => ReturnType<typeof registerCommand>;
  readonly multibook: ReturnType<typeof makeMultiBook>;
};

const seeIncoming = (bridge: ShellBridge): void => {
  if (bridge.project() === undefined) return;
  void bridge.navigate({
    to: "/project/$slug/review",
    params: { slug: bridge.slug() },
    search: { against: "shared" },
  });
};

const sendMine = (bridge: ShellBridge): void => {
  const { services } = bridge;
  const project = bridge.project();
  if (project === undefined) return;
  void sendNow(services, project).then((outcome) => bridge.report(sendOutcomeCopy(outcome).title));
};

const saveWithoutReview = async (bridge: ShellBridge, project: Project): Promise<void> => {
  const services = bridge.services;
  const books = project.books.filter((book) => services.save.dirty(book));
  const openReview = () =>
    void bridge.navigate({
      to: "/project/$slug/history",
      params: { slug: bridge.slug() },
      search: { review: true },
    });
  if (books.length === 0) {
    bridge.report(t("nothing to save"));
    return;
  }
  const author = Option.getOrUndefined(await services.run(personAuthor()));
  if (author === undefined) {
    openReview();
    return;
  }
  const metadata = Option.getOrUndefined(project.metadata());
  const message = t("Edited {books}", {
    books: books.map((book) => bookName(book.id, metadata)).join(", "),
  });
  const outcome = await recordVersion(services, project, books, message, author);
  if (outcome.kind === "recorded") {
    bridge.changed({ kind: "book.write", books: outcome.books, recorded: true });
    bridge.report(t("saved {count} book(s)", { count: outcome.books.length }));
    void sendAfterSave(services, project);
    return;
  }
  if (outcome.kind === "not-recorded")
    bridge.changed({ kind: "book.write", books: outcome.books, recorded: false });
  openReview();
};

const shellHelpers = (bridge: ShellBridge): Helpers => {
  const { services } = bridge;
  const hasProject = (): boolean => bridge.project() !== undefined;
  const hasBook = (): boolean => bridge.focused() !== undefined;

  const seated = (): EditorBook | undefined => {
    const book = bridge.focused();
    return book === undefined ? undefined : services.seated(book.id);
  };

  const insertion = (id: string, title: string, keys: string | undefined, action: EditorAction) =>
    registerCommand({
      id,
      title,
      ...(keys === undefined ? {} : { keys }),
      when: () => seated() !== undefined,
      run: () => {
        seated()?.perform(action);
      },
    });

  const multibook = makeMultiBook(() => bridge.project()?.books ?? []);
  return { hasProject, hasBook, seated, insertion, multibook };
};

const paletteCommands = (bridge: ShellBridge) => {
  return [
    registerCommand({
      id: "palette.open",
      title: t("Command palette…"),
      keys: "Mod-k",
      run: () => {
        bridge.setPaletteOpen(true);
      },
    }),

    registerCommand({
      id: "workspace.togglePanel",
      title: t("Show or hide the project panel"),
      keys: "Mod-b",
      run: () => bridge.setSidebarOpen(!bridge.sidebarOpen()),
    }),

    registerCommand({
      id: "project.settings",
      title: t("Settings"),
      keys: "Mod-,",
      run: () => {
        void bridge.navigate({ to: "/project/$slug/settings", params: { slug: bridge.slug() } });
      },
    }),

    registerCommand({
      id: "project.copyLink",
      title: t("Copy a link to this place"),
      when: () => bridge.project() !== undefined,
      run: () => {
        const root = bridge.project()?.root;
        return root === undefined ? undefined : copyPlaceLink(bridge.services, root);
      },
    }),
  ];
};

const advancedCommands = (bridge: ShellBridge) => {
  return [
    registerCommand({
      id: "settings.showAdvanced",
      title: t("Show advanced settings"),
      when: () =>
        !bridge.services.settings.get(shellKeys(bridge.services.settings).showAdvancedSettings),
      run: () => {
        const key = shellKeys(bridge.services.settings).showAdvancedSettings;
        return Effect.gen(function* () {
          yield* bridge.services.settings.set(key, true);
          yield* Effect.sync(
            () =>
              void bridge.navigate({
                to: "/project/$slug/settings",
                params: { slug: bridge.slug() },
              }),
          );
        });
      },
    }),

    registerCommand({
      id: "settings.hideAdvanced",
      title: t("Hide advanced settings"),
      when: () =>
        bridge.services.settings.get(shellKeys(bridge.services.settings).showAdvancedSettings),
      run: () => {
        const key = shellKeys(bridge.services.settings).showAdvancedSettings;
        return bridge.services.settings.set(key, false);
      },
    }),
  ];
};

const saveCommands = (bridge: ShellBridge, h: Helpers) => {
  const { hasProject } = h;
  return [
    registerCommand({
      id: "book.save",
      title: t("Save & Review…"),
      keys: "Mod-s",
      when: hasProject,
      run: () => {
        const project = bridge.project();
        if (
          project !== undefined &&
          syncPreferences(bridge.services.settings, project.root).skipReviewMine
        ) {
          void saveWithoutReview(bridge, project);
          return;
        }
        void bridge.navigate({
          to: "/project/$slug/history",
          params: { slug: bridge.slug() },
          search: { review: true },
        });
      },
    }),

    registerCommand({
      id: "project.saveAll",
      title: t("Record a version…"),
      keys: "Mod-Shift-s",
      when: hasProject,
      run: () => {
        void bridge.navigate({
          to: "/project/$slug/history",
          params: { slug: bridge.slug() },
          search: { review: true },
        });
      },
    }),

    registerCommand({
      id: "book.undo",
      title: t("Undo"),
      when: () => bridge.historyDepth().undo > 0,
      run: () => {
        bridge.focused()?.history()?.undo();
      },
    }),

    registerCommand({
      id: "book.redo",
      title: t("Redo"),
      when: () => bridge.historyDepth().redo > 0,
      run: () => {
        bridge.focused()?.history()?.redo();
      },
    }),
  ];
};

const searchCommands = (bridge: ShellBridge, h: Helpers) => {
  const { hasProject } = h;
  return [
    registerCommand({
      id: "search.open",
      title: t("Find in project"),
      keys: "Mod-Shift-f",
      when: hasProject,
      run: () => {
        const book = bridge.focused();
        const range = book?.selection();
        const picked =
          book === undefined || range === undefined || range.from === range.to
            ? ""
            : book.source().text.slice(range.from, range.to).trim();
        const usable = picked !== "" && picked.length <= 200 && !/[\n\\]/.test(picked);
        void bridge.navigate({
          to: "/project/$slug/find",
          params: { slug: bridge.slug() },
          search: usable ? { q: picked } : {},
        });
      },
    }),

    registerCommand({
      id: "dev.playground",
      title: "Playground (dev)",
      when: () => import.meta.env.DEV && hasProject(),
      run: () => {
        void bridge.navigate({
          to: "/project/$slug/playground",
          params: { slug: bridge.slug() },
        });
      },
    }),

    registerCommand({
      id: "editor.toggleMode",
      title: t("Toggle USFM"),
      keys: "Mod-Shift-m",
      when: hasProject,
      run: () => {
        bridge.setMode(bridge.mode() === "usfm" ? "default" : "usfm");
      },
    }),
  ];
};

const chapterCommands = (bridge: ShellBridge, h: Helpers) => {
  const { hasBook } = h;
  return [
    registerCommand({
      id: "editor.chapter.next",
      title: t("Clip to next chapter"),
      when: () => hasBook() && bridge.chapterCount() > 0,
      run: () => {
        const count = bridge.chapterCount();
        if (count === 0) return;
        const held = bridge.chapter();
        bridge.setChapter(held === null ? 0 : (held + 1) % count);
      },
    }),

    registerCommand({
      id: "editor.chapter.previous",
      title: t("Clip to previous chapter"),
      when: () => hasBook() && bridge.chapterCount() > 0,
      run: () => {
        const count = bridge.chapterCount();
        if (count === 0) return;
        const held = bridge.chapter();
        bridge.setChapter(held === null ? count - 1 : (held + count - 1) % count);
      },
    }),

    registerCommand({
      id: "editor.chapter.whole",
      title: t("Show the whole book"),
      when: () => hasBook() && bridge.chapter() !== null,
      run: () => {
        bridge.setChapter(null);
      },
    }),
  ];
};

const findingCommands = (bridge: ShellBridge, h: Helpers) => {
  const { hasProject } = h;
  return [
    registerCommand({
      id: "findings.next",
      title: t("Next finding"),
      keys: "Alt-F8",
      when: hasProject,
      run: () => {
        bridge.stepFinding(1);
      },
    }),

    registerCommand({
      id: "findings.previous",
      title: t("Previous finding"),
      keys: "Alt-Shift-F8",
      when: hasProject,
      run: () => {
        bridge.stepFinding(-1);
      },
    }),

    registerCommand({
      id: "findings.applyFix",
      title: t("Apply the offered fix"),
      when: hasProject,
      run: () => {
        bridge.applyFix();
      },
    }),

    registerCommand({
      id: "git.commit",
      title: t("Record a version…"),
      when: hasProject,
      run: () => {
        void bridge.navigate({
          to: "/project/$slug/history",
          params: { slug: bridge.slug() },
          search: { review: true },
        });
      },
    }),
  ];
};

const remoteCommands = (bridge: ShellBridge) => {
  const { services } = bridge;
  return [
    registerCommand({
      id: "remote.login",
      title: t("Sign in to the cloud…"),
      run: () => {
        const host = contentHostFor(services.settings);
        if (host === null) {
          bridge.report(t("no WACS server is set for this build: set one in Settings"));
          return;
        }
        const project = bridge.project();
        if (project === undefined) {
          void bridge.navigate({ to: "/projects" });
          return;
        }
        void bridge.navigate({ to: "/project/$slug", params: { slug: bridge.slug() } });
        bridge.report(t("sign in to {host} from the cloud menu or Settings", { host }));
      },
    }),
  ];
};

const syncCommands = (bridge: ShellBridge, h: Helpers) => {
  const { hasProject } = h;
  return [
    registerCommand({
      id: "remote.pull",
      title: t("Receive updates…"),
      when: hasProject,
      run: () => {
        seeIncoming(bridge);
      },
    }),

    registerCommand({
      id: "remote.push",
      title: t("Send my changes"),
      when: hasProject,
      run: () => {
        sendMine(bridge);
      },
    }),

    registerCommand({
      id: "findings.open",
      title: t("Findings"),
      when: hasProject,
      run: () => {
        void bridge.navigate({
          to: "/project/$slug/findings",
          params: { slug: bridge.slug() },
          search: {},
        });
      },
    }),

    registerCommand({
      id: "git.history",
      title: t("History"),
      when: hasProject,
      run: () => {
        void bridge.navigate({
          to: "/project/$slug/history",
          params: { slug: bridge.slug() },
          search: {},
        });
      },
    }),
  ];
};

const insertCommands = (bridge: ShellBridge, h: Helpers) => {
  const { insertion, seated } = h;
  return [
    insertion("editor.insert.verse", t("Insert verse"), "Mod-Shift-v", "insert.verse"),
    insertion("editor.insert.paragraph", t("Insert paragraph"), "Mod-Shift-p", "insert.paragraph"),
    insertion("editor.insert.poetry", t("Insert poetry line"), "Mod-Shift-l", "insert.poetry"),
    insertion("editor.insert.footnote", t("Insert footnote"), "Mod-Shift-n", "insert.footnote"),
    insertion("editor.table.rowAbove", t("Table: insert row above"), undefined, "table.rowAbove"),
    insertion("editor.table.rowBelow", t("Table: insert row below"), undefined, "table.rowBelow"),
    insertion("editor.table.deleteRow", t("Table: delete row"), undefined, "table.deleteRow"),
    insertion(
      "editor.table.columnBefore",
      t("Table: insert column before"),
      undefined,
      "table.columnBefore",
    ),
    insertion(
      "editor.table.columnAfter",
      t("Table: insert column after"),
      undefined,
      "table.columnAfter",
    ),
    insertion(
      "editor.table.deleteColumn",
      t("Table: delete column"),
      undefined,
      "table.deleteColumn",
    ),

    registerCommand({
      id: "editor.frontmatter.edit",
      title: t("Edit front matter"),
      when: () => seated() !== undefined && bridge.mode() !== "usfm",
      run: () => {
        seated()?.perform("frontmatter.edit");
      },
    }),
  ];
};

const formatCommands = (bridge: ShellBridge, h: Helpers) => {
  const { hasBook, hasProject, multibook } = h;
  return [
    registerCommand({
      id: "format.book",
      title: t("Format book"),
      when: hasBook,
      run: () => {
        const book = bridge.focused();
        if (book === undefined) return;
        const previewed = formatBook(bridge.services.galley, book);
        if (Result.isFailure(previewed)) {
          bridge.report(previewed.failure.description);
          return;
        }
        if (previewed.success.empty) {
          bridge.report(t("{book} is already formatted", { book: book.id }));
          return;
        }
        const applied = applyFormat(previewed.success, book);
        bridge.report(
          Result.isFailure(applied)
            ? t("format refused: {reason}", { reason: applied.failure.description })
            : t("formatted {book}", { book: book.id }),
        );
        bridge.changed({ kind: "book.apply", books: [book.id] });
      },
    }),

    registerCommand({
      id: "format.project",
      title: t("Format every book"),
      when: hasProject,
      run: () => {
        let refusal = "";
        const operation = multibook.runAcrossBooks("format", (book) => {
          const previewed = formatBook(bridge.services.galley, book);
          if (Result.isFailure(previewed)) {
            refusal = previewed.failure.description;
            return null;
          }
          return previewed.success.changes;
        });
        if (operation === null) {
          bridge.report(refusal === "" ? t("nothing to format") : refusal);
          return;
        }
        bridge.report(t("formatted {count} book(s)", { count: operation.books.length }));
        bridge.changed({ kind: "book.apply", books: operation.books });
      },
    }),
  ];
};

const chapterExtent = (book: EditorBook, chapter: number | undefined) =>
  chapter === undefined
    ? undefined
    : book
        .structure()
        .chapters.find(
          (row: { readonly label: string }) => Number.parseInt(row.label, 10) === chapter,
        );

const chapterAtCaret = (book: EditorBook): number | undefined => {
  const at = book.selection().head;
  const row = book
    .structure()
    .chapters.find(
      (chapter: { readonly from: number; readonly to: number }) =>
        at >= chapter.from && at < chapter.to,
    );
  const number = row === undefined ? Number.NaN : Number.parseInt(row.label, 10);
  return Number.isFinite(number) ? number : undefined;
};

const boundSource = (bridge: ShellBridge, projectRoot: string) =>
  Effect.map(bridge.services.library.resolve(projectRoot, "source"), (bound) => bound[0]);

const showWhatNeedsText = (
  bridge: ShellBridge,
  book: EditorBook,
  done: string,
  within?: { readonly from: number; readonly to: number },
) =>
  Effect.gen(function* () {
    const holes = book
      .emptyBlocks()
      .filter(
        (hole) => within === undefined || (hole.from >= within.from && hole.from < within.to),
      );
    if (holes.length === 0) {
      bridge.report(done);
      return;
    }
    const caret = book.selection().head;
    const next = holes.find((hole) => hole.from >= caret) ?? holes[0];
    bridge.aim(book.id, next.from);
    const ghostKey = shellKeys(bridge.services.settings).annotateEmptyParagraphs;
    const wasOff = !bridge.services.settings.get(ghostKey);
    if (wasOff) yield* bridge.services.settings.set(ghostKey, true);
    bridge.report(
      wasOff
        ? t("{done} — {count} block(s) need text; showing empty paragraphs", {
            done,
            count: holes.length,
          })
        : t("{done} — {count} block(s) need text", { done, count: holes.length }),
    );
  });

const overlayFocused = (bridge: ShellBridge, scope: "chapter" | "book") =>
  Effect.gen(function* () {
    const book = bridge.focused();
    const project = bridge.project();
    if (book === undefined || project === undefined) return;
    const chapter = scope === "chapter" ? chapterAtCaret(book) : undefined;
    if (scope === "chapter" && chapter === undefined) {
      bridge.report(t("put the cursor in a chapter first"));
      return;
    }
    const source = yield* boundSource(bridge, project.root);
    if (source === undefined) {
      bridge.report(t("no source text is bound to this project"));
      return;
    }
    const text = yield* bridge.services.library.readBook(source.id, book.id);
    if (Option.isNone(text)) {
      bridge.report(t("the source has no {book}", { book: book.id }));
      return;
    }
    const previewed = overlayBook(
      bridge.services.galley,
      book,
      text.value,
      chapter === undefined ? undefined : { scope: { chapter } },
    );
    if (Result.isFailure(previewed)) {
      bridge.report(previewed.failure.description);
      return;
    }
    if (previewed.success.empty) {
      bridge.report(
        chapter === undefined
          ? t("{book} already matches the source's formatting", { book: book.id })
          : t("chapter {chapter} already matches the source's formatting", { chapter }),
      );
      return;
    }
    const applied = withoutScrolling(() => applyOverlay(previewed.success, book));
    if (Result.isFailure(applied)) {
      bridge.report(
        t("match formatting refused: {reason}", { reason: applied.failure.description }),
      );
      return;
    }
    bridge.changed({ kind: "book.apply", books: [book.id] });
    const extent = chapterExtent(book, chapter);
    yield* showWhatNeedsText(
      bridge,
      book,
      chapter === undefined
        ? t("matched {book} to {source}", { book: book.id, source: source.title })
        : t("matched chapter {chapter} to {source}", { chapter, source: source.title }),
      extent,
    );
  });

const overlayProject = (bridge: ShellBridge, multibook: Helpers["multibook"]) =>
  Effect.gen(function* () {
    const project = bridge.project();
    if (project === undefined) return;
    const source = yield* boundSource(bridge, project.root);
    if (source === undefined) {
      bridge.report(t("no source text is bound to this project"));
      return;
    }
    bridge.report(t("reading {source}…", { source: source.title }));
    const texts = new Map<string, string>();
    for (const book of project.books) {
      const text = yield* bridge.services.library.readBook(source.id, book.id);
      if (Option.isSome(text)) texts.set(book.id, text.value);
    }
    if (texts.size === 0) {
      bridge.report(t("{source} has none of this project's books", { source: source.title }));
      return;
    }
    let refusal = "";
    const operation = withoutScrolling(() =>
      multibook.runAcrossBooks("overlay", (book) => {
        const text = texts.get(book.id);
        if (text === undefined) return null;
        const previewed = overlayBook(bridge.services.galley, book, text);
        if (Result.isFailure(previewed)) {
          refusal = previewed.failure.description;
          return null;
        }
        return previewed.success.empty ? null : previewed.success.changes;
      }),
    );
    if (operation === null) {
      bridge.report(
        refusal === ""
          ? t("every book already matches {source}", { source: source.title })
          : refusal,
      );
      return;
    }
    bridge.changed({ kind: "book.apply", books: operation.books });
    const done = t("matched {count} book(s) to {source}", {
      count: operation.books.length,
      source: source.title,
    });
    const focused = bridge.focused();
    if (focused !== undefined && operation.books.includes(focused.id))
      yield* showWhatNeedsText(bridge, focused, done);
    else bridge.report(done);
  });
const overlayCommands = (bridge: ShellBridge, h: Helpers) => {
  const { hasBook, hasProject } = h;
  return [
    registerCommand({
      id: "overlay.chapter",
      title: t("Match formatting from source: this chapter"),
      when: hasBook,
      run: () => overlayFocused(bridge, "chapter"),
    }),
    registerCommand({
      id: "overlay.book",
      title: t("Match formatting from source: this book"),
      when: hasBook,
      run: () => overlayFocused(bridge, "book"),
    }),
    registerCommand({
      id: "overlay.project",
      title: t("Match formatting from source: every book"),
      when: hasProject,
      run: () => overlayProject(bridge, h.multibook),
    }),
  ];
};

export const registerShellCommands = (bridge: ShellBridge): (() => void) => {
  const { services } = bridge;
  setCommandObservability(services.composition.observability);
  setCommandRunner((effect) => {
    void services.run(effect).catch((cause: unknown) => {
      bridge.report(t("failed: {cause}", { cause: String(cause) }));
    });
  });
  const h = shellHelpers(bridge);
  const registrations = [
    ...paletteCommands(bridge),
    ...advancedCommands(bridge),
    ...saveCommands(bridge, h),
    ...searchCommands(bridge, h),
    ...chapterCommands(bridge, h),
    ...findingCommands(bridge, h),
    ...remoteCommands(bridge),
    ...syncCommands(bridge, h),
    ...insertCommands(bridge, h),
    ...formatCommands(bridge, h),
    ...overlayCommands(bridge, h),
  ];

  return () => {
    for (const unregister of registrations) unregister();
  };
};
