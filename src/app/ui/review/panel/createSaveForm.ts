import { Effect, Option } from "effect";
import { createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";
import type { Author } from "#core/git/git";

import { personAuthor } from "../../../author";
import { collaboration } from "../../../collaboration";
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
  if (!copy && facts?.canWrite === false)
    return name === undefined
      ? m.review_you_cant_change_the_shared()
      : m.review_you_cant_change_name({ name });
  if (name === undefined)
    return copy
      ? m.review_this_also_sends_your_changes()
      : m.review_this_also_sends_your_changes_to();
  return copy
    ? m.review_this_also_sends_your_changes_to_your({ name })
    : m.review_this_also_sends_your_changes_to_the({ name });
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
    if (againstShared()) return m.review_the_editor_now_reads_as();
    return unsaved().length > 0
      ? m.review_both_sides_now_read_the()
      : m.review_both_sides_now_read_the_same();
  };

  const saveDescription = (): string => {
    if (!againstShared())
      return m.review_your_changes_in_count_books({
        count: unsaved().length,
      });
    return fromCopy()
      ? m.review_the_projects_text_is_kept()
      : m.review_the_projects_text_is_kept_as();
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
    return names.length === 0
      ? m.review_edited()
      : m.review_edited_books({ books: names.join(", ") });
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
