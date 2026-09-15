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

import { Effect, Option, Result, type Scope } from "effect";
import { createSignal } from "solid-js";

import { trustedBy, type Book } from "../core/book/book";
import { FORMAT_DOOR, formatBook } from "../core/fixes/fixes";
import { Git } from "../core/git/git";
import { makeMultiBook } from "../core/multibook/multibook";
import type { Project } from "../core/project/project";
import { Remote } from "../core/remote/remote";
import { SaveCoordinator } from "../core/save/saveCoordinator";
import type { EditorAction, EditorBook, ProjectionName } from "../editor";
import { giteaHostFor } from "./env";
import { t } from "./i18n";
import type { Domain, Services } from "./services";

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
  /** The book the editor route currently shows, if any. */
  readonly focused: () => Book | undefined;
  readonly mode: () => ProjectionName;
  readonly setMode: (mode: ProjectionName) => void;
  /** The clipped chapter ordinal, or null for the whole book. */
  readonly chapter: () => number | null;
  readonly setChapter: (ordinal: number | null) => void;
  readonly chapterCount: () => number;
  /** Moves the findings cursor and navigates to what it points at. */
  readonly stepFinding: (delta: 1 | -1) => void;
  /** Applies the fix offered by the finding under the cursor, if any. */
  readonly applyFix: () => void;
  readonly go: (path: string) => void;
  readonly openProject: (root: string) => Promise<void>;
  readonly setPaletteOpen: (open: boolean) => void;
  /** Shown in the status bar; the shell's one place for a transient message. */
  readonly report: (message: string) => void;
  /**
   * Tells the shell that a module's derived state moved for a reason the
   * editor did not publish — a save that reset a baseline, a commit. Every
   * dirty marker is derived, so without this one call they stay stale.
   */
  readonly bump: () => void;
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

/** Every registered command, in registration order. */
export const commands = (): readonly Command[] => registry();

/** The registered commands whose `when` currently allows them. */
export const availableCommands = (): readonly Command[] =>
  registry().filter((command) => command.available());

let runner: ((effect: Effect.Effect<unknown, unknown, Domain | Scope.Scope>) => void) | undefined;

/**
 * How an Effect-returning command reaches a runtime. Set once by
 * `registerShellCommands`; a command registered before there is a runtime and
 * then invoked fails loudly rather than silently doing nothing.
 */
export const setCommandRunner = (
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
  const outcome = command.run(argument);
  if (outcome === undefined) return;
  if (Effect.isEffect(outcome)) {
    if (runner === undefined)
      throw new Error(`command ${id} returned an Effect before a command runner was installed`);
    runner(outcome);
    return;
  }
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
    // document — so without this line `Mod-Shift-f` would insert a footnote
    // AND open project search on one press.
    if (event.defaultPrevented) return;
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
      bridge.bump();
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
            bridge.go("/projects");
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
        bridge.go("/settings");
      },
    }),

    registerCommand({
      id: "book.save",
      title: t("Save book"),
      keys: "Mod-s",
      when: hasBook,
      run: () => {
        const book = bridge.focused();
        if (book === undefined) return;
        return Effect.gen(function* () {
          const coordinator = yield* SaveCoordinator;
          const receipt = yield* coordinator.save(book);
          bridge.report(
            t("saved {path} ({bytes} bytes)", { path: receipt.path, bytes: receipt.bytes }),
          );
          bridge.bump();
        });
      },
    }),

    registerCommand({
      id: "project.saveAll",
      title: t("Save all"),
      keys: "Mod-Shift-s",
      when: hasProject,
      run: () => {
        const project = bridge.project();
        if (project === undefined) return;
        return Effect.gen(function* () {
          const coordinator = yield* SaveCoordinator;
          const receipts = yield* coordinator.saveAll(project.books);
          bridge.report(t("saved {count} book(s)", { count: receipts.length }));
          bridge.bump();
        });
      },
    }),

    registerCommand({
      id: "book.undo",
      title: t("Undo"),
      when: () => (bridge.focused()?.history()?.depth().undo ?? 0) > 0,
      run: () => {
        bridge.focused()?.history()?.undo();
      },
    }),

    registerCommand({
      id: "book.redo",
      title: t("Redo"),
      when: () => (bridge.focused()?.history()?.depth().redo ?? 0) > 0,
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
        bridge.go("/find");
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
      title: t("Commit saved changes"),
      when: hasProject,
      run: () => {
        const project = bridge.project();
        if (project === undefined) return;
        return Effect.gen(function* () {
          const git = yield* Git;
          const coordinator = yield* SaveCoordinator;
          // Only what Save actually wrote is committed — Git stages receipt
          // paths and nothing else (see documentation/architecture/git.md).
          const receipts = yield* coordinator.saveAll(project.books);
          if (receipts.length === 0) {
            bridge.report(t("nothing to commit"));
            return;
          }
          const repo = yield* git.init(project.root);
          const id = yield* git.commit(
            repo,
            receipts,
            t("Edit {count} book(s)", {
              count: receipts.length,
            }),
            { name: "Sefer", email: "sefer@localhost" },
          );
          bridge.report(t("committed {id}", { id: id.slice(0, 8) }));
          bridge.bump();
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
        const host = giteaHostFor(services.hostInfo.kind());
        if (host === null) {
          bridge.report(t("no cloud host in this build: set VITE_SEFER_GITEA_WEB_HOST"));
          return;
        }
        const project = bridge.project();
        if (project === undefined) {
          bridge.go("/projects");
          return;
        }
        bridge.go(`/project/${encodeURIComponent(project.root)}`);
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
        bridge.go("/findings");
      },
    }),

    registerCommand({
      id: "git.history",
      title: t("History"),
      when: hasProject,
      run: () => {
        bridge.go("/history");
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
    insertion("editor.insert.footnote", t("Insert footnote"), "Mod-Shift-f", "insert.footnote"),

    registerCommand({
      id: "editor.frontmatter.edit",
      title: t("Edit front matter"),
      when: () => seated() !== undefined && bridge.mode() !== "usfm",
      run: () => {
        seated()?.perform("frontmatter.edit");
      },
    }),

    // ---------------------------------------------------------------------
    // Format. Registered, and refusing — see `src/core/fixes/fixes.ts`. The
    // shape is the shape it will keep: one `book.apply(…, 'format')` per book,
    // so a formatted book is one Undo step and a formatted project is one per
    // book. Only `Fixes.formatBook` changes when the engine grows the door.
    // ---------------------------------------------------------------------

    registerCommand({
      id: "format.book",
      title: t("Format book"),
      when: hasBook,
      run: () => {
        const book = bridge.focused();
        if (book === undefined) return;
        const previewed = formatBook(book);
        if (Result.isFailure(previewed)) {
          bridge.report(previewed.failure.description);
          return;
        }
        // Trusted, like a fix: the edits are the engine's own and they rewrite
        // markup the keyboard guards would refuse. Still ONE `apply`, so it is
        // one Undo step and every subscriber hears one receipt.
        const applied = book.apply(previewed.success.changes, "format", trustedBy("format"));
        bridge.report(
          Result.isFailure(applied)
            ? t("format refused: {reason}", { reason: applied.failure.description })
            : t("formatted {book}", { book: book.id }),
        );
        bridge.bump();
      },
    }),

    registerCommand({
      id: "format.project",
      title: t("Format every book"),
      when: hasProject,
      run: () => {
        let refused = 0;
        const operation = multibook.runAcrossBooks("format", (book) => {
          const previewed = formatBook(book);
          if (Result.isFailure(previewed)) {
            refused += 1;
            return null;
          }
          return previewed.success.changes;
        });
        if (operation === null) {
          bridge.report(
            refused === 0
              ? t("nothing to format")
              : t("Format needs an engine door: {door}", { door: FORMAT_DOOR }),
          );
          return;
        }
        bridge.report(t("formatted {count} book(s)", { count: operation.books.length }));
        bridge.bump();
      },
    }),
  ];

  return () => {
    for (const unregister of registrations) unregister();
  };
};
