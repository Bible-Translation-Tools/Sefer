/**
 * The command registry: one list of the things the application can be asked
 * to do, and the one way to ask.
 *
 * Why a registry at all, when the brief says "no abstraction with one caller":
 * every command here has at least three callers — a button, a keystroke, and
 * the palette — and without a registry each would grow its own copy of "is
 * this possible right now?". `when()` is that question asked once.
 *
 * Commands are registered against a `ShellBridge`, which is the honest list of
 * what a command actually needs: the services, what is focused, and how to
 * navigate. It is supplied by `ProjectContext`, so this module holds no
 * application state — only the list.
 *
 * Nothing here touches CodeMirror or the router. A command that needs the
 * editor asks the bridge for the focused Book (a `Book`, not a view) and calls
 * its port; a command that navigates calls `bridge.go`.
 */

import type { UseNavigateResult } from "@tanstack/solid-router";
import { Effect, Option, Result, type Scope } from "effect";
import { createSignal } from "solid-js";

import { applyFormat, applyOverlay, formatBook, overlayBook } from "#core/fixes/fixes";
import { Git } from "#core/git/git";
import { makeMultiBook } from "#core/multibook/multibook";
import { Observability, type ObservabilityService } from "#core/observability";
import type { Project } from "#core/project/project";
import { Remote } from "#core/remote/remote";
import { emptyBlocks, structureAt, withoutScrolling } from "#editor/index";
import type { EditorAction, EditorBook, ProjectionName } from "#editor/index";

import { contentHostFor } from "./endpoints";
import { t } from "./i18n";
import type { Domain, Services } from "./services";
import { shellKeys } from "./settings";
import type { ShellEvent } from "./shellEvent";

/** What a command's `run` may return; an Effect is run on the app runtime. */
export type CommandResult =
  | Effect.Effect<unknown, unknown, Domain | Scope.Scope>
  | Promise<unknown>
  | void;

export interface CommandSpec {
  readonly id: string;
  readonly title: string;
  /**
   * `argument` is whatever `runCommand(id, argument)` was given. Almost every
   * command ignores it; the two that do not (`project.rename`) would otherwise
   * need a surface of their own to ask one question.
   */
  readonly run: (argument?: unknown) => CommandResult;
  /** False hides the command from the palette and makes `runCommand` a no-op. */
  readonly when?: () => boolean;
  /** CodeMirror's key notation, e.g. `Mod-s`, `Mod-Shift-f`. */
  readonly keys?: string;
}

export interface Command extends CommandSpec {
  readonly available: () => boolean;
}

/**
 * Everything a command may reach. Deliberately concrete: a command that needs
 * something not on this list is telling us the shell owns state it has not
 * admitted to owning yet.
 */
export interface ShellBridge {
  readonly services: Services;
  readonly project: () => Project | undefined;
  /**
   * The book the editor route currently shows, if any.
   *
   * An `EditorBook` and not a bare `Book`, because the shell's already is:
   * a command that just wrote needs the book's CANONICAL STATE to ask what it
   * did — and reading that state is the difference between a result computed
   * over the new text and one guessed from the offsets of the old.
   */
  readonly focused: () => EditorBook | undefined;
  readonly mode: () => ProjectionName;
  readonly setMode: (mode: ProjectionName) => void;
  /** The clipped chapter ordinal, or null for the whole book. */
  readonly chapter: () => number | null;
  readonly setChapter: (ordinal: number | null) => void;
  readonly chapterCount: () => number;
  /** The focused book's undo and redo depth, from the shell's `books` store. */
  readonly historyDepth: () => { readonly undo: number; readonly redo: number };
  /** Moves the findings cursor and navigates to what it points at. */
  readonly stepFinding: (delta: 1 | -1) => void;
  /** Applies the fix offered by the finding under the cursor, if any. */
  readonly applyFix: () => void;
  /**
   * The router's typed navigate. NOT a `go(path: string)`: a built path has to
   * be cast past the route union, and that cast is what let nine screens move
   * under `/project/$slug` without a single compile error.
   */
  readonly navigate: UseNavigateResult<string>;
  /** The open project's slug, for the `params` of an in-project route. */
  readonly slug: () => string;
  readonly openProject: (root: string) => Promise<void>;
  readonly setPaletteOpen: (open: boolean) => void;
  readonly sidebarOpen: () => boolean;
  readonly setSidebarOpen: (open: boolean) => void;
  /** Shown in the status bar; the shell's one place for a transient message. */
  /**
   * Scroll the editor to an offset and flash it — the door `shell.aim`
   * already opens for search hits and findings. On the bridge because a
   * command that changed the document is often the only thing that knows
   * WHERE the interesting part of its own result is.
   */
  readonly aim: (bookId: string, from: number, to?: number) => void;
  readonly report: (message: string) => void;
  /**
   * Tells the shell that a module's derived state moved for a reason the
   * editor did not publish — a save that reset a baseline, a commit. Every
   * dirty marker is derived, so without this one call they stay stale.
   *
   * It names the books it is about, so a command touching one book does not
   * wake every book's readers.
   */
  readonly changed: (event: ShellEvent) => void;
}

// A signal rather than a plain array so the palette re-renders when the set
// changes. The registry is module-level because there is exactly one
// application; `registerCommand` returns the unregister so a route may add a
// command for as long as it is mounted.
//
// `ownedWrite` is required, not decorative: the shell registers its commands
// while it is being built inside a reactive owner, and Solid 2 THROWS on an
// unmarked write there (REACTIVE_WRITE_IN_OWNED_SCOPE in a dev build). This is
// deliberate initialization of module-internal state, which is what the option
// is for.
const [registry, setRegistry] = createSignal<readonly Command[]>([], {
  name: "commands",
  ownedWrite: true,
});

/** The registered commands whose `when` currently allows them. */
export const availableCommands = (): readonly Command[] =>
  registry().filter((command) => command.available());

let runner: ((effect: Effect.Effect<unknown, unknown, Domain | Scope.Scope>) => void) | undefined;

let narrator: ObservabilityService | undefined;

/**
 * Where a command's own record goes. Set beside the runner, for the same
 * reason: a command registered before there is a composition has nowhere to
 * narrate to, and silently dropping it would be worse than not trying.
 */
const setCommandObservability = (observability: ObservabilityService): void => {
  narrator = observability;
};

/**
 * How an Effect-returning command reaches a runtime. Set once by
 * `registerShellCommands`; a command registered before there is a runtime and
 * then invoked fails loudly rather than silently doing nothing.
 */
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

/**
 * Runs a command by id. An unknown id, or one whose `when` refuses, is a
 * no-op: the palette and the keymap both offer commands that may have become
 * impossible between render and press, and that is not an error.
 */
export const runCommand = (id: string, argument?: unknown): void => {
  const command = findCommand(id);
  if (command === undefined || !command.available()) return;
  // EVERY command opens one, and the level decides whether it is recorded.
  // The alternative is judging once per command whether it is interesting,
  // which is a judgement made at the wrong time by the wrong person: a command
  // that toggles a boolean is dull until the day it is the one that is slow.
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
    // The gesture is PROVIDED to the work, so everything the command reaches —
    // core services asking the context for Observability — lands inside it.
    // And it ends when the Effect does, not when this function returns: a
    // command that opens a project is not over because it was dispatched.
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

// ---------------------------------------------------------------------------
// Keystrokes
// ---------------------------------------------------------------------------

const MOD = (event: KeyboardEvent): boolean => (event.metaKey ? true : event.ctrlKey);

/**
 * Does `event` match a `Mod-Shift-k`-style binding? CodeMirror's notation,
 * because the editor's own keymap uses it and two notations in one app is one
 * too many. Only the modifiers named are allowed to be held.
 */
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

/** Is the keystroke being typed INTO something — a box, or the editor itself? */
const editing = (target: EventTarget | null): boolean => {
  if (target === null || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // `.cm-content` is a contenteditable, so the editor is covered by the same
  // question and needs no name of its own here.
  return target.isContentEditable;
};

/**
 * Installs the shell's global keymap; returns the uninstall.
 *
 * Keystrokes inside the editor are CodeMirror's business and reach it first —
 * this listener runs on the document and only claims a chord no editor
 * extension consumed, which is why `Mod-z` is NOT registered with keys here.
 */
export const installCommandKeys = (target: Document): (() => void) => {
  const onKeyDown = (event: KeyboardEvent): void => {
    // A chord the editor already consumed is not the shell's. CodeMirror
    // preventDefaults a binding it ran, and the event still bubbles to the
    // document — so without this line `Mod-Shift-n` would insert a footnote
    // AND fire the shell's registration of the same command on one press.
    if (event.defaultPrevented) return;
    // A binding with no modifier is a plain keystroke, and a plain keystroke
    // belongs to whatever the reader is typing into. Escape closing a panel is
    // worth having; Escape closing a panel while someone is mid-word in the
    // scripture, or in the palette's own search box, is not. Every other
    // binding holds Mod, so this rule costs them nothing.
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

// ---------------------------------------------------------------------------
// The core set
// ---------------------------------------------------------------------------

/**
 * Registers the commands the shell always offers, and returns the unregister
 * for all of them at once.
 *
 * The one place a reader can see the whole vocabulary of the application. Note
 * what each one does NOT do: nothing here parses, writes a file, or touches a
 * view — every command is two lines of "ask a module".
 */
export const registerShellCommands = (bridge: ShellBridge): (() => void) => {
  const { services } = bridge;
  setCommandObservability(services.composition.observability);
  setCommandRunner((effect) => {
    void services.run(effect).catch((cause: unknown) => {
      bridge.report(t("failed: {cause}", { cause: String(cause) }));
    });
  });

  const hasProject = (): boolean => bridge.project() !== undefined;
  const hasBook = (): boolean => bridge.focused() !== undefined;

  /**
   * The focused Book as the editor-backed one the seat made for it.
   *
   * `perform` is what an editor-backed Book adds over a plain one — a named
   * gesture run against the caret — and `services.seated` is how the shell
   * reaches one from a `Book` port with no assertion. A book with no seat has
   * no caret, so an insert command is simply unavailable, which is what `when`
   * reports.
   */
  const seated = (): EditorBook | undefined => {
    const book = bridge.focused();
    return book === undefined ? undefined : services.seated(book.id);
  };

  /** One structured insertion, registered the same way four times. */
  const insertion = (id: string, title: string, keys: string, action: EditorAction) =>
    registerCommand({
      id,
      title,
      keys,
      when: () => seated() !== undefined,
      run: () => {
        seated()?.perform(action);
      },
    });

  /**
   * The Undo offer for a cross-book operation lives on ONE MultiBook, so there
   * is one here rather than one per invocation. `books` is a thunk, which is
   * what `makeMultiBook` wants: Project instantiates and releases books as the
   * reader opens and closes them, and MultiBook must never hold one alive.
   */
  const multibook = makeMultiBook(() => bridge.project()?.books ?? []);

  /**
   * Pull and push differ by one word, so they share this. The project's
   * repository is opened rather than initialised: transferring into a folder
   * that is not a repository yet is a publish, not a pull.
   */
  const runTransfer = (direction: "pull" | "push") => {
    const project = bridge.project();
    if (project === undefined) return;
    return Effect.gen(function* () {
      const git = yield* Git;
      const remote = yield* Remote;
      const repo = yield* git.open(project.root);
      const progress = yield* direction === "pull" ? remote.pull(repo) : remote.push(repo);
      bridge.report(
        t("{direction}: {phase} ({loaded})", {
          direction,
          phase: progress.phase,
          loaded: progress.loaded,
        }),
      );
      // No book list: a transfer moves the repository under the whole
      // project, and which books it touched is git's answer, not one we ask.
      bridge.changed({ kind: "remote.transfer" });
    });
  };

  const registrations = [
    registerCommand({
      id: "palette.open",
      title: t("Command palette…"),
      keys: "Mod-k",
      run: () => {
        bridge.setPaletteOpen(true);
      },
    }),

    // The project panel's show/hide. The rail's panel tile went in the
    // designer's pass and has no new home yet, and `workspace.sidebarOpen`
    // persists — so without this a panel once hidden could never come back,
    // and with it the panel's project button, the way back to all projects.
    registerCommand({
      id: "workspace.togglePanel",
      title: t("Show or hide the project panel"),
      keys: "Mod-b",
      run: () => bridge.setSidebarOpen(!bridge.sidebarOpen()),
    }),

    registerCommand({
      id: "project.open",
      title: t("Open project…"),
      keys: "Mod-o",
      run: () =>
        Effect.gen(function* () {
          const picked = yield* services.dialogs.pickFolder(t("Open project"));
          if (Option.isNone(picked)) {
            // The Web picker returns a handle NAME, not a path (see
            // services.ts), so there is nothing honest to open from it yet;
            // the projects list is the working route.
            bridge.report(t("no folder chosen"));
            void bridge.navigate({ to: "/projects" });
            return;
          }
          yield* Effect.promise(() => bridge.openProject(picked.value));
        }),
    }),

    registerCommand({
      id: "project.settings",
      title: t("Settings"),
      keys: "Mod-,",
      run: () => {
        void bridge.navigate({ to: "/settings" });
      },
    }),

    registerCommand({
      id: "settings.showAdvanced",
      title: t("Show advanced settings"),
      when: () =>
        !bridge.services.settings.get(shellKeys(bridge.services.settings).showAdvancedSettings),
      run: () => {
        const key = shellKeys(bridge.services.settings).showAdvancedSettings;
        return Effect.gen(function* () {
          yield* bridge.services.settings.set(key, true);
          yield* Effect.sync(() => void bridge.navigate({ to: "/settings" }));
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

    registerCommand({
      id: "book.save",
      title: t("Save & Review…"),
      keys: "Mod-s",
      when: hasProject,
      /**
       * Mod-S no longer writes anything. The file is written when a version is
       * recorded, so the save key opens the one screen that does both, with
       * the message field focused and Enter on it recording — the same two
       * keystrokes the old shortcut cost, with a diff in between.
       */
      run: () => {
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
      // One door to disk: the file is written when a version is recorded, so
      // this opens the review like Mod-S rather than writing on its own.
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

    registerCommand({
      id: "search.open",
      title: t("Find in project"),
      keys: "Mod-Shift-f",
      when: hasProject,
      run: () => {
        void bridge.navigate({
          to: "/project/$slug/find",
          params: { slug: bridge.slug() },
          search: {},
        });
      },
    }),

    /**
     * The projection, by NAME rather than as a toggle.
     *
     * A palette is searched by typing what you want, and "Toggle USFM /
     * visual" answers to neither word a reader would reach for: somebody who
     * wants USFM types "usfm" and somebody who wants the reading types
     * "revision". So each mode is its own command, titled as the mode, and
     * offered only when the editor is not already in it — a command that would
     * do nothing is one more line to read past.
     *
     * The chord stays on the toggle, because a keystroke is a flip and not a
     * choice from a list.
     */
    registerCommand({
      id: "view.mode.revision",
      title: t("Revision mode"),
      when: () => hasBook() && bridge.mode() === "usfm",
      run: () => {
        bridge.setMode("default");
      },
    }),

    registerCommand({
      id: "view.mode.usfm",
      title: t("USFM mode"),
      when: () => hasBook() && bridge.mode() !== "usfm",
      run: () => {
        bridge.setMode("usfm");
      },
    }),

    /**
     * The dev playground, reachable without typing a URL.
     *
     * `import.meta.env.DEV` is a build-time constant, so `when` folds to
     * `false` in a production build and the command is never offered — the same
     * gate the route itself carries. Untranslated on purpose: it is not a
     * feature of the product.
     */
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
      title: t("Toggle USFM / visual"),
      keys: "Mod-Shift-m",
      when: hasBook,
      run: () => {
        bridge.setMode(bridge.mode() === "usfm" ? "default" : "usfm");
      },
    }),

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
      // Same door as Mod-S: writing and recording are one action on the
      // review screen, never a palette side-effect.
      run: () => {
        void bridge.navigate({
          to: "/project/$slug/history",
          params: { slug: bridge.slug() },
          search: { review: true },
        });
      },
    }),

    // ---------------------------------------------------------------------
    // Remote sync. Three commands, because remote work is three separate
    // approvals: prove who you are, take what arrived, publish what you did.
    // None of them ever runs by itself (documentation/architecture/git.md).
    // ---------------------------------------------------------------------

    registerCommand({
      id: "remote.login",
      title: t("Sign in to the cloud…"),
      run: () => {
        // The sign-in form needs a password and an OTP field, which is a
        // surface, not a command; this takes the user to it. A build with no
        // Gitea host configured says so rather than opening an empty form.
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
        bridge.report(t("sign in to {host} in the Cloud panel", { host }));
      },
    }),

    registerCommand({
      id: "remote.pull",
      title: t("Pull from the cloud"),
      when: hasProject,
      run: () => runTransfer("pull"),
    }),

    registerCommand({
      id: "remote.push",
      title: t("Push to the cloud"),
      when: hasProject,
      run: () => runTransfer("push"),
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

    // ---------------------------------------------------------------------
    // Structured entry. Each of these builds a TransactionSpec against the
    // caret in the focused book and dispatches it through the editor's own
    // kernel — the phases judge it like a keystroke, and it is one Undo step.
    // The same four chords are ALSO bound inside CodeMirror (`usfmKeys`), so
    // a press with the editor focused never makes the round trip; these
    // registrations are what the palette lists and what fires when focus is
    // somewhere else on the page.
    // ---------------------------------------------------------------------

    insertion("editor.insert.verse", t("Insert verse"), "Mod-Shift-v", "insert.verse"),
    insertion("editor.insert.paragraph", t("Insert paragraph"), "Mod-Shift-p", "insert.paragraph"),
    insertion("editor.insert.poetry", t("Insert poetry line"), "Mod-Shift-l", "insert.poetry"),
    insertion("editor.insert.footnote", t("Insert footnote"), "Mod-Shift-n", "insert.footnote"),

    registerCommand({
      id: "editor.frontmatter.edit",
      title: t("Edit front matter"),
      when: () => seated() !== undefined && bridge.mode() !== "usfm",
      run: () => {
        seated()?.perform("frontmatter.edit");
      },
    }),

    // ---------------------------------------------------------------------
    // Format. One `book.apply(…, 'format')` per book, so a formatted book is
    // one Undo step and a formatted project is one per book. The edits are
    // the engine's own (`Fixes.formatBook`); Sefer has no formatter.
    // ---------------------------------------------------------------------

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
        // `operation.books` lists only the books that actually changed.
        bridge.changed({ kind: "book.apply", books: operation.books });
      },
    }),

    // ---------------------------------------------------------------------
    // Overlay — "Match formatting from source" in the UI. The bound SOURCE's
    // paragraphing carried onto this project's text (glossary, "Overlay"; not
    // Format, which consults no other text). One `book.apply(…, 'overlay')`
    // per book, so each book is one Undo step and Undo is the preview: there is
    // no confirm dialog, because what a translator needs to judge is the result
    // in their own editor, not a list of block addresses in a modal.
    //
    // Scoped, because an overlay inserts inside-verse blocks EMPTY on purpose
    // (the engine cannot know where a verse's text splits across languages):
    // the chapter at the cursor is a sitting, the book an afternoon, the
    // project a decision. ASYNC, unlike its neighbours: the source is a Library
    // resource read off disk, so the command says what it is doing.
    // ---------------------------------------------------------------------

    ...(() => {
      /** The `\c` number the caret is inside, or `undefined` in front matter. */
      const chapterAtCaret = (book: EditorBook): number | undefined => {
        const at = book.state.selection.main.head;
        const row = structureAt(book.state).chapters.find(
          (chapter: { readonly from: number; readonly to: number }) =>
            at >= chapter.from && at < chapter.to,
        );
        const number = row === undefined ? Number.NaN : Number.parseInt(row.label, 10);
        return Number.isFinite(number) ? number : undefined;
      };

      /**
       * The project's source: the FIRST resource bound under the `source` role.
       * The role holds many and an overlay has to mean one text; a project
       * with two sources is a picker this command does not have yet, and the
       * first is the order the reference column shows them in. Deliberately
       * the source role only — a `reference` is something read beside the
       * text, never something its shape is taken from.
       */
      const boundSource = (projectId: string) =>
        Effect.map(bridge.services.library.resolve(projectId, "source"), (bound) => bound[0]);

      /**
       * What an overlay LEFT for a human, and taking the reader to it.
       *
       * The empty blocks are the whole visible result, so they are counted off
       * the book's OWN state after the write (the write moved every offset
       * after the first edit). The reader is sent to the first one at or after
       * where they are, not the first in the book — an overlay of the whole
       * book very often has its first hole in chapter 2 while they work in
       * chapter 40. The blocks are invisible without
       * `editor.annotateEmptyParagraphs`, so that is turned on when it is off
       * AND there is something to see, and the report says so: the setting is
       * theirs to put back.
       */
      const showWhatNeedsText = (
        book: EditorBook,
        done: string,
        within?: { readonly from: number; readonly to: number },
      ) =>
        Effect.gen(function* () {
          const holes = emptyBlocks(book.state).filter(
            (hole) => within === undefined || (hole.from >= within.from && hole.from < within.to),
          );
          if (holes.length === 0) {
            bridge.report(done);
            return;
          }
          const caret = book.state.selection.main.head;
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

      /** The chapter at the cursor, or the whole focused book. */
      const overlayFocused = (scope: "chapter" | "book") =>
        Effect.gen(function* () {
          const book = bridge.focused();
          const project = bridge.project();
          if (book === undefined || project === undefined) return;
          const chapter = scope === "chapter" ? chapterAtCaret(book) : undefined;
          if (scope === "chapter" && chapter === undefined) {
            bridge.report(t("put the cursor in a chapter first"));
            return;
          }
          const source = yield* boundSource(project.id);
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
          // The write must not move the page: an overlay rewrites markers, so
          // every offset after the first edit shifts and CodeMirror's pixel
          // scroll would no longer point at the words the reader was on.
          // `core/scroll.ts` is what keeps Undo from throwing you out of a
          // footnote, and this has the same claim.
          const applied = withoutScrolling(() => applyOverlay(previewed.success, book));
          if (Result.isFailure(applied)) {
            bridge.report(
              t("match formatting refused: {reason}", { reason: applied.failure.description }),
            );
            return;
          }
          bridge.changed({ kind: "book.apply", books: [book.id] });
          const extent =
            chapter === undefined
              ? undefined
              : structureAt(book.state).chapters.find(
                  (row: { readonly label: string }) => Number.parseInt(row.label, 10) === chapter,
                );
          yield* showWhatNeedsText(
            book,
            chapter === undefined
              ? t("matched {book} to {source}", { book: book.id, source: source.title })
              : t("matched chapter {chapter} to {source}", { chapter, source: source.title }),
            extent,
          );
        });

      /**
       * Every book the source also has, one `apply` per book through
       * `runAcrossBooks('overlay', …)` — origin `project.overlay`, one Undo
       * step per book, exactly as `format.project` does for Format.
       */
      const overlayProject = () =>
        Effect.gen(function* () {
          const project = bridge.project();
          if (project === undefined) return;
          const source = yield* boundSource(project.id);
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
            yield* showWhatNeedsText(focused, done);
          else bridge.report(done);
        });

      return [
        registerCommand({
          id: "overlay.chapter",
          title: t("Match formatting from source: this chapter"),
          when: hasBook,
          run: () => overlayFocused("chapter"),
        }),
        registerCommand({
          id: "overlay.book",
          title: t("Match formatting from source: this book"),
          when: hasBook,
          run: () => overlayFocused("book"),
        }),
        registerCommand({
          id: "overlay.project",
          title: t("Match formatting from source: every book"),
          when: hasProject,
          run: () => overlayProject(),
        }),
      ];
    })(),
  ];

  return () => {
    for (const unregister of registrations) unregister();
  };
};
