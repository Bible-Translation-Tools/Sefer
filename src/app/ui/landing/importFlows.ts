import { Effect, Option, Scope } from "effect";

import { lastSegment } from "#core/fileSystem/path";
import { intakeRepository, type IntakeResult } from "#core/git/intake";
import { Observability, type Verdict } from "#core/observability";
import { remoteVerdict } from "#core/remote/remote";
import { classify, commit, stage } from "#core/resources/import";
import type { Dropped } from "#platform/web/intake";

import { announceSourceTexts, arrivalRoot, cloneArrival } from "../../arrival";
import { APP_AUTHOR } from "../../author";
import { describe, reasonOf, remoteReasonOf } from "../../describe";
import { t } from "../../i18n";
import { m } from "../../paraglide/messages";
import type { Domain, Services } from "../../services";
import { toasts } from "../primitives";
import { rememberProject } from "./summaries";

export const STEPS = ["pick", "stage", "classify", "commit"] as const;

export type Step = (typeof STEPS)[number];

export const STEP_LABEL: Readonly<Record<Step, string>> = {
  pick: "Selecting the source…",
  stage: "Copying files into staging…",
  classify: "Working out what it is…",
  commit: "Validating books and committing…",
};

export interface Progress {
  readonly title: string;
  readonly step: Step | undefined;
  readonly message: string;
  readonly failed: boolean;
  readonly detail?: string;
}

export interface ImportContext {
  readonly services: Services;
  readonly running: (title: string, step: Step, detail?: string) => void;
  readonly finished: (title: string, message: string, failed: boolean) => void;
  readonly clear: () => void;
  readonly onImported: () => void;
}

type Operation = ReturnType<Services["composition"]["observability"]["operation"]>;

interface Flow {
  readonly context: ImportContext;
  readonly title: string;
  readonly toast: ReturnType<typeof toasts.progress>;
  readonly operation: Operation;
  readonly phase: { name: string };
  readonly run: <A, E>(
    effect: Effect.Effect<A, E, Domain | Scope.Scope>,
    stageName?: string,
  ) => Promise<A>;
}

const intakeAttrs = (intake: IntakeResult) => ({
  "import.adopted": intake.adopted,
  "import.arrival": intake.arrival !== undefined,
  ...(intake.fallback === undefined ? {} : { "import.fallback": intake.fallback }),
});

const runIn =
  (services: Services, operation: Operation): Flow["run"] =>
  async (effect, stageName) => {
    const stop = stageName === undefined ? undefined : operation.span(stageName);
    try {
      return await services.run(Effect.provideService(effect, Observability, operation));
    } finally {
      stop?.();
    }
  };

const beginImport = (
  context: ImportContext,
  title: string,
  source: "folder" | "zip",
  choosing: string,
): Flow => {
  const { services } = context;
  const toast = toasts.progress({ title: t("Importing project"), message: choosing });
  context.running(title, "pick");
  const operation = services.composition.observability.operation("import.resource", {
    "import.source": source,
    "import.host": services.hostInfo.kind(),
  });
  return {
    context,
    title,
    toast,
    operation,
    phase: { name: "pick" },
    run: runIn(services, operation),
  };
};

const declineImport = (flow: Flow): void => {
  flow.operation.end("declined", { "import.phase": flow.phase.name });
  flow.context.clear();
  toasts.dismiss(flow.toast);
};

const failImport = (flow: Flow, cause: unknown): void => {
  const message = describe(cause);
  flow.operation.end("failed", {
    "import.phase": flow.phase.name,
    "import.reason": reasonOf(cause) ?? "Unknown",
  });
  flow.context.finished(t("Couldn't bring it in"), message, true);
  toasts.update(flow.toast, {
    title: t("Import failed"),
    message,
    tone: "error",
    autoClose: false,
  });
};

const enterPhase = (flow: Flow, step: "classify" | "commit"): void => {
  flow.context.running(flow.title, step);
  flow.phase.name = step;
};

const classifyAndCommit = async (
  flow: Flow,
  staged: Effect.Success<ReturnType<typeof stage>>,
  target: {
    readonly name: string;
    readonly source: "folder" | "zip";
    readonly extraAttrs: Readonly<Record<string, number>>;
  },
): Promise<void> => {
  const { services } = flow.context;
  const { run, operation, toast } = flow;
  enterPhase(flow, "classify");
  const kind = await run(classify(services.fileSystem, staged), "import.classify");

  enterPhase(flow, "commit");
  toasts.update(toast, { title: t("Importing project"), message: t("Committing books") });
  const into = `${services.projectsRoot}/${target.name}`;
  const books = await run(
    commit(services.fileSystem, staged, { root: into }, target.source),
    "import.commit",
  );
  const arrived = await run(
    intakeRepository({
      root: into,
      written: staged.files,
      from: target.name,
      author: APP_AUTHOR,
    }),
    "import.intake",
  );
  operation.attr({
    "import.kind": kind,
    "import.books": books.length,
    ...target.extraAttrs,
    ...intakeAttrs(arrived),
  });

  flow.context.finished(
    t("Ready"),
    t("{count} books imported as {kind} into {root}.", {
      count: books.length,
      kind,
      root: into,
    }),
    false,
  );
  toasts.update(toast, {
    title: t("Project imported"),
    message: t("{count} books", { count: books.length }),
    tone: "success",
  });
  await run(rememberProject(services.projectsRoot, into, undefined));
  void announceSourceTexts(services, into);
  operation.end("passed", { "import.phase": "complete" });
  flow.context.onImported();
};

export const importFolder = (context: ImportContext): void => {
  const { services } = context;
  const title = t("Import from a folder");
  const flow = beginImport(context, title, "folder", t("Choosing a folder"));
  const { run, toast } = flow;

  void (async () => {
    const picked = await run(services.dialogs.pickFolder(t("Select a project folder")));
    const source = Option.getOrUndefined(picked);
    if (source === undefined) return declineImport(flow);

    context.running(title, "stage");
    flow.phase.name = "stage";
    toasts.update(toast, { title: t("Importing project"), message: t("Staging files") });
    const staged = await run(
      stage(services.fileSystem, [source], `${services.hostInfo.paths().temp}/import`),
      "import.stage",
    );
    await classifyAndCommit(flow, staged, {
      name: lastSegment(source),
      source: "folder",
      extraAttrs: {},
    });
  })().catch((cause: unknown) => failImport(flow, cause));
};

export const importPicked = (
  context: ImportContext,
  title: string,
  source: "folder" | "zip",
  dropped?: Dropped,
): void => {
  const { services } = context;
  const flow = beginImport(context, title, source, t("Choosing files"));
  const { run, toast } = flow;

  void (async () => {
    const intake = await import("#platform/web/intake");
    const picked =
      dropped !== undefined
        ? await intake.readDropped(dropped, flow.operation)
        : source === "zip"
          ? await intake.pickZip(flow.operation)
          : await intake.pickFolder(flow.operation);
    if (picked === undefined) return declineImport(flow);

    context.running(title, "stage", t("0 of {total} files", { total: picked.files.length }));
    flow.phase.name = "stage";
    toasts.update(toast, { title: t("Importing project"), message: t("Copying files in") });
    const staged = await run(
      intake.intake(
        services.fileSystem,
        `${services.hostInfo.paths().temp}/import`,
        picked,
        (written, total) =>
          context.running(title, "stage", t("{written} of {total} files", { written, total })),
      ),
      "import.stage",
    );
    await classifyAndCommit(flow, staged, {
      name: picked.name,
      source,
      extraAttrs: { "import.files": picked.files.length },
    });
  })().catch((cause: unknown) => failImport(flow, cause));
};

export const cloneRepository = (context: ImportContext, url: string): void => {
  const { services } = context;
  const name = lastSegment(url.replace(/\.git$/u, ""));
  const into = arrivalRoot(services, "project", url);
  const toast = toasts.progress({ title: t("Cloning {name}", { name }) });
  context.running(m.landing_clone_repository(), "commit");
  const operation = services.composition.observability.operation("import.remote", {
    "import.source": "cloud",
    "import.host": services.hostInfo.kind(),
  });
  let ended = false;
  const end = (verdict: Verdict, attrs: Parameters<typeof operation.end>[1]): void => {
    if (ended) return;
    ended = true;
    operation.end(verdict, attrs);
  };
  const run = runIn(services, operation);

  void (async () => {
    const cloned = await run(cloneArrival(services, "project", url), "remote.clone");
    operation.attr({
      "remote.progress.phase": cloned.progress.phase,
      "remote.progress.loaded": cloned.progress.loaded,
      ...(cloned.progress.total === undefined
        ? {}
        : { "remote.progress.total": cloned.progress.total }),
    });
    end("passed", { "import.phase": "complete" });
    void announceSourceTexts(services, into);
    context.finished(t("Ready"), t("Cloned into {root}.", { root: into }), false);
    toasts.update(toast, { title: t("Cloned {name}", { name }), tone: "success" });
    context.onImported();
  })().catch((cause: unknown) => {
    const message = describe(cause);
    end(remoteVerdict(remoteReasonOf(cause)), {
      "import.phase": "clone",
      "import.reason": reasonOf(cause) ?? "Unknown",
    });
    context.finished(t("Couldn't bring it in"), message, true);
    toasts.update(toast, { title: t("Clone failed"), message, tone: "error", autoClose: false });
  });
};
