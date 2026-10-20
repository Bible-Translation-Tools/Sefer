import { createSignal, untrack } from "solid-js";

import type { CompareSource } from "#core/compare";

import { describe } from "../../../describe";
import { t } from "../../../i18n";
import type { Navigate, Shell } from "../../../ProjectContext";
import type { Services } from "../../../services";
import { COPY_REVIEW, fetchCopy } from "../../../suggestions";
import { createRecordedVersion } from "../../panels/recorded";
import { sourceChoices, type SourceChoice } from "../sources";
import type { Decisions } from "./createDecisions";
import type { ReviewRoute } from "./createReviewRoute";
import { LIVE, writerSide } from "./helpers";

export interface SidesInputs {
  readonly shell: Shell;
  readonly services: Services;
  readonly navigate: Navigate;
  readonly route: ReviewRoute;
  readonly decisions: Decisions;
  readonly setNote: (note: string) => void;
  readonly setBusy: (busy: string) => void;
}

function createSideState(inputs: SidesInputs) {
  const { shell, route } = inputs;
  const version = createRecordedVersion(shell);
  const shared = createRecordedVersion(shell, "shared", route.theirsRef);
  const common = createRecordedVersion(shell, "base", route.theirsRef);

  const [leftId, setLeftId] = createSignal("project", { name: "reviewLeftKind" });
  const [rightId, setRightId] = createSignal(route.initialRightId(), { name: "reviewRightKind" });
  const againstShared = (): boolean => rightId() === "shared" || leftId() === "shared";
  const againstWriter = (): boolean => rightId() === "writer" || leftId() === "writer";
  const [leftPicked, setLeftPicked] = createSignal<CompareSource | undefined>(undefined, {
    name: "reviewLeftPicked",
  });
  const [rightPicked, setRightPicked] = createSignal<CompareSource | undefined>(undefined, {
    name: "reviewRightPicked",
  });
  return {
    version,
    shared,
    common,
    leftId,
    setLeftId,
    rightId,
    setRightId,
    againstShared,
    againstWriter,
    leftPicked,
    setLeftPicked,
    rightPicked,
    setRightPicked,
  };
}

type SideState = ReturnType<typeof createSideState>;

function createSourceChoices(inputs: SidesInputs, state: SideState) {
  const { shell, services, route } = inputs;
  const { pull, fromCopy } = route;
  const { version, shared } = state;

  const sharedLabelWords = (): string | undefined => {
    if (pull() !== undefined) return t("The suggested changes");
    return fromCopy() ? t("Your copy") : undefined;
  };
  const sharedExplainerWords = (): string | undefined => {
    if (pull() !== undefined)
      return t("What the suggestion offers: its author's copy, as they last sent it.");
    return fromCopy() ? t("Your copy, as another of your devices last sent it.") : undefined;
  };

  const choices = (): readonly SourceChoice[] =>
    sourceChoices({
      services,
      project: shell.project(),
      baselineOf: (book) => services.save.baseline(book),
      recorded: version.recorded(),
      shared: shared.recorded(),
      sharedLabel: sharedLabelWords(),
      sharedExplainer: sharedExplainerWords(),
      writer: writerSide(shell),
    });

  const choiceOf = (id: string): SourceChoice | undefined =>
    choices().find((choice) => choice.id === id);
  return { choices, choiceOf };
}

function createChoices(inputs: SidesInputs, state: SideState) {
  const { version, shared, leftId, rightId, leftPicked, rightPicked } = state;
  const { choices, choiceOf } = createSourceChoices(inputs, state);

  const sourceFor = (id: string, picked: CompareSource | undefined): CompareSource | undefined => {
    const choice = choiceOf(id);
    if (choice === undefined) return undefined;
    return choice.immediate === undefined ? picked : choice.immediate();
  };

  const left = (): CompareSource | undefined => sourceFor(leftId(), leftPicked());
  const right = (): CompareSource | undefined => sourceFor(rightId(), rightPicked());

  const leftShort = (): string => choiceOf(leftId())?.shortLabel ?? t("this side");
  const rightShort = (): string => choiceOf(rightId())?.shortLabel ?? t("the other side");
  const leftLabel = (): string => left()?.label ?? choiceOf(leftId())?.label ?? "";
  const rightLabel = (): string => right()?.label ?? choiceOf(rightId())?.label ?? "";

  const target = (): "left" | "right" | undefined => {
    if (left()?.canApply === true) return "left";
    return right()?.canApply === true ? "right" : undefined;
  };

  const live = (): boolean => LIVE.has(leftId()) || LIVE.has(rightId());

  const waitingFor = (): string | undefined => {
    for (const id of [leftId(), rightId()]) {
      const pending =
        (id === "shared" && !shared.recorded().read) ||
        (id === "recorded" && !version.recorded().read);
      if (pending) return choiceOf(id)?.shortLabel ?? t("the other side");
    }
    return undefined;
  };
  return {
    choices,
    choiceOf,
    left,
    right,
    leftShort,
    rightShort,
    leftLabel,
    rightLabel,
    target,
    live,
    waitingFor,
  };
}

function createPicking(
  inputs: SidesInputs,
  state: SideState,
  choiceOf: (id: string) => SourceChoice | undefined,
) {
  const { setNote, setBusy } = inputs;
  const { leftId, setLeftId, setRightId } = state;
  const { leftPicked, setLeftPicked, setRightPicked } = state;

  const pick = (side: "left" | "right", id: string): void => {
    const choice = choiceOf(id);
    if (side === "right" && id === "project") {
      const wasId = leftId();
      const wasPicked = leftPicked();
      setLeftId(id);
      setLeftPicked(undefined);
      setRightId(wasId);
      setRightPicked(wasPicked);
      inputs.decisions.startOver();
      return;
    }
    if (side === "left") {
      setLeftId(id);
      setLeftPicked(undefined);
    } else {
      setRightId(id);
      setRightPicked(undefined);
    }
    inputs.decisions.startOver();
    if (choice?.pick === undefined) return;
    setBusy(t("Reading…"));
    void choice
      .pick()
      .then((source) => {
        setBusy("");
        if (source === undefined) return;
        if (side === "left") setLeftPicked(source);
        else setRightPicked(source);
      })
      .catch((cause: unknown) => {
        setBusy("");
        setNote(describe(cause));
      });
  };

  return { pick, ...createSeeing(inputs, state, pick) };
}

function createSeeing(
  inputs: SidesInputs,
  state: SideState,
  pick: (side: "left" | "right", id: string) => void,
) {
  const { shell, services, navigate, route } = inputs;
  const { search, fromCopy } = route;
  const { shared, common, leftId, rightId } = state;

  const seeShared = (): void => {
    shared.refresh();
    common.refresh();
    if (rightId() !== "shared" && leftId() !== "shared") pick("right", "shared");
  };

  const seeCopy = (): void => {
    const project = shell.project();
    if (untrack(fromCopy) && untrack(() => search().against) === "shared") {
      if (project !== undefined) void fetchCopy(services, project).then(seeShared);
      return;
    }
    void navigate({
      to: "/project/$slug/review",
      params: { slug: shell.slug() },
      search: COPY_REVIEW,
    });
  };
  return { seeShared, seeCopy };
}

export function createSides(inputs: SidesInputs) {
  const state = createSideState(inputs);
  const choices = createChoices(inputs, state);
  const picking = createPicking(inputs, state, choices.choiceOf);
  const { version, shared, common, leftId, rightId, leftPicked, rightPicked } = state;
  const { againstShared, againstWriter } = state;

  return {
    version,
    shared,
    common,
    leftId,
    rightId,
    leftPicked,
    rightPicked,
    againstShared,
    againstWriter,
    ...choices,
    ...picking,
  };
}

export type Sides = ReturnType<typeof createSides>;
