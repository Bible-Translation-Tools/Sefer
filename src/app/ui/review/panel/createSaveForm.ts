import { Effect, Option } from "effect";
import { createSignal } from "solid-js";

import type { Author } from "#core/git/git";

import { personAuthor } from "../../../author";
import { collaboration } from "../../../collaboration";
import { t } from "../../../i18n";
import type { Shell } from "../../../ProjectContext";
import type { Services } from "../../../services";
import { syncPreferences } from "../../../syncSettings";
import { unsavedChanges } from "../../panels/changes";
import { bookName } from "../../workspace/books";
import { metadataOf } from "../../workspace/project";
import type { ReviewRoute } from "./createReviewRoute";
import type { Sides } from "./createSides";

export interface SaveFormInputs {
  readonly shell: Shell;
  readonly services: Services;
  readonly route: ReviewRoute;
  readonly sides: Sides;
}

function sendsLineOf(shell: Shell): string {
  const facts = collaboration.facts(shell.project()?.root);
  const copy = facts?.mode === "copy";
  const name = facts?.sendsTo;
  if (name === undefined)
    return copy
      ? t("This also sends your changes to your copy.")
      : t("This also sends your changes to the shared project.");
  return copy
    ? t("This also sends your changes to your copy, {name}.", { name })
    : t("This also sends your changes to the shared project, {name}.", { name });
}

function openRecordWith(
  inputs: SaveFormInputs,
  setRecordOpen: (open: boolean) => void,
  setAuthor: (author: Author | undefined) => void,
  setSends: (sends: boolean) => void,
): void {
  const { shell, services } = inputs;
  setRecordOpen(true);
  void services.run(personAuthor()).then((found) => setAuthor(Option.getOrUndefined(found)));
  const project = shell.project();
  if (project === undefined) return;
  void services
    .run(
      Effect.orElseSucceed(
        Effect.flatMap(services.git.open(project.root), (repo) => services.remote.origin(repo)),
        () => Option.none<string>(),
      ),
    )
    .then((origin) =>
      setSends(
        Option.isSome(origin) && syncPreferences(services.settings, project.root).sendOnSave,
      ),
    );
}

function createDescriptions(inputs: SaveFormInputs, unsaved: () => readonly unknown[]) {
  const { fromCopy } = inputs.route;
  const { againstShared } = inputs.sides;

  const decidedDescription = (): string => {
    if (againstShared())
      return t(
        "The editor now reads as you chose. Save to finish: it keeps your choices and joins your work with the shared project's.",
      );
    return unsaved().length > 0
      ? t("Both sides now read the same. Save to keep it.")
      : t("Both sides now read the same. Nothing is left to save.");
  };

  const saveDescription = (): string => {
    if (!againstShared())
      return t("Your changes in {count} book(s) are written and kept as a version.", {
        count: unsaved().length,
      });
    return fromCopy()
      ? t(
          "The project's text is kept as you left it here: your choices, and anything you edited. A passage only your copy changed, that you didn't choose for, comes in. Its versions stay in the history either way, and this one goes on top, so the next send is an ordinary one.",
        )
      : t(
          "The project's text is kept as you left it here: your choices, and anything you edited. A passage only the shared project changed, that you didn't choose for, comes in. Everything else it changed arrives too, as one version.",
        );
  };
  return { decidedDescription, saveDescription };
}

export function createSaveForm(inputs: SaveFormInputs) {
  const { shell } = inputs;
  const [message, setMessage] = createSignal("", { name: "reviewMessage" });
  const [recordOpen, setRecordOpen] = createSignal(false, { name: "reviewRecordOpen" });
  const [author, setAuthor] = createSignal<Author | undefined>(undefined, { name: "reviewAuthor" });
  const [typedName, setTypedName] = createSignal("", { name: "reviewAuthorName" });
  const [sends, setSends] = createSignal(false, { name: "reviewSends" });
  const [broughtIn, setBroughtIn] = createSignal(false, { name: "reviewBroughtIn" });
  const [closeOnSave, setCloseOnSave] = createSignal(true, { name: "reviewCloseSuggestion" });
  const sendsLine = (): string => sendsLineOf(shell);
  const openRecord = (): void => openRecordWith(inputs, setRecordOpen, setAuthor, setSends);

  const unsaved = () => unsavedChanges(shell);

  const defaultMessage = (): string => {
    const names = unsaved().map((book) => bookName(book.bookId, metadataOf(shell.project())));
    return names.length === 0 ? t("Edited") : t("Edited {books}", { books: names.join(", ") });
  };

  return {
    message,
    setMessage,
    recordOpen,
    setRecordOpen,
    author,
    setAuthor,
    typedName,
    setTypedName,
    sends,
    broughtIn,
    setBroughtIn,
    closeOnSave,
    setCloseOnSave,
    sendsLine,
    openRecord,
    unsaved,
    defaultMessage,
    ...createDescriptions(inputs, unsaved),
  };
}

export type SaveForm = ReturnType<typeof createSaveForm>;
