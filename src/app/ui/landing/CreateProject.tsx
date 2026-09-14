/**
 * Create project: the form that says what a new project IS, and stops one step
 * short of making it.
 *
 * That stop is deliberate and it is not laziness. `ProjectAdmin` has `rename`,
 * `delete`, `metadata`, `updateMetadata` and `export` — and no `create`. Worse,
 * `openProject` refuses a root with no books (`NoBooks`), so a project created
 * from this form alone could not be opened until something put USFM in it. The
 * missing piece is a decision about what an empty project contains — blank
 * books for every selected id, or nothing until the first import — and that is
 * domain vocabulary, not code. The React prototype dodged it entirely: it has
 * no create flow at all, only import.
 *
 * So what this form does is the half that IS decided: it builds the Scripture
 * Burrito metadata, decodes it through `src/core/resources/burrito.ts` — the
 * same schema every reader in Sefer validates against — and shows the result.
 * If the schema refuses, the form says why, here, rather than at first open.
 * The one TODO below is the single line where the write belongs once
 * `ProjectAdmin.create` exists.
 */

import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { Result } from "effect";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import { For, Show, createSignal } from "solid-js";

import { decodeBurritoMetadata, type BurritoMetadata } from "../../../core/resources/burrito";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Badge, Button, Card, Input, PanelHeader, SegmentedControl, Select } from "../primitives";

/**
 * The canonical book ids, as the form's checkboxes. They live here rather than
 * in core because core has no canon list — Galley's table of contents is per
 * document — and this is a picker, not a rule.
 */
const OT_IDS =
  "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL";

const NT_IDS =
  "MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV";

const OLD_TESTAMENT: readonly string[] = OT_IDS.split(" ");

const NEW_TESTAMENT: readonly string[] = NT_IDS.split(" ");

type ProjectType = "translation" | "gateway";

export function CreateProject() {
  const shell = useShell();
  const { services } = shell;
  /** Burrito keys every localized string by locale; this is the one we write. */
  const locale = services.hostInfo.locale().split("-")[0] ?? "en";

  const [name, setName] = createSignal("", { name: "createName" });
  const [abbreviation, setAbbreviation] = createSignal("", { name: "createAbbrev" });
  const [projectId, setProjectId] = createSignal("", { name: "createId" });
  const [languageName, setLanguageName] = createSignal("", { name: "createLanguage" });
  const [languageTag, setLanguageTag] = createSignal("", { name: "createTag" });
  const [direction, setDirection] = createSignal<"ltr" | "rtl">("ltr", { name: "createDirection" });
  const [type, setType] = createSignal<ProjectType>("translation", { name: "createType" });
  const [books, setBooks] = createSignal<readonly string[]>([...NEW_TESTAMENT], {
    name: "createBooks",
  });
  const [staged, setStaged] = createSignal<BurritoMetadata | undefined>(undefined, {
    name: "createStaged",
  });
  const [problem, setProblem] = createSignal("", { name: "createProblem" });

  const toggle = (book: string): void => {
    setBooks((held) =>
      held.includes(book) ? held.filter((each) => each !== book) : [...held, book],
    );
  };

  const selectAll = (set: readonly string[]): void => {
    setBooks((held) => [...new Set([...held, ...set])]);
  };

  const complete = (): boolean =>
    name().trim() !== "" && languageName().trim() !== "" && languageTag().trim() !== "";

  /**
   * Builds the metadata the project WOULD have. `currentScope` is the selected
   * books with empty chapter lists, which is Burrito's way of saying "these
   * books are in scope and nothing is delivered yet".
   */
  const build = (): void => {
    setProblem("");
    setStaged(undefined);
    const scope: Record<string, readonly string[]> = {};
    for (const book of books()) scope[book] = [];
    const candidate = {
      format: "scripture burrito",
      meta: {
        version: "1.0.0",
        category: type() === "gateway" ? "gateway" : "translation",
        generator: { softwareName: "Sefer", softwareVersion: services.hostInfo.build() },
        defaultLocale: locale,
        dateCreated: new Date(Date.now()).toISOString(),
      },
      identification: {
        name: { [locale]: name().trim() },
        ...(abbreviation().trim() === ""
          ? {}
          : { abbreviation: { [locale]: abbreviation().trim() } }),
      },
      type: {
        flavorType: {
          name: "scripture",
          flavor: { name: "textTranslation" },
          currentScope: scope,
        },
      },
      languages: [
        {
          tag: languageTag().trim(),
          name: { [locale]: languageName().trim() },
          scriptDirection: direction(),
        },
      ],
      ingredients: {},
    };

    const decoded = decodeBurritoMetadata(candidate);
    if (Result.isFailure(decoded)) {
      setProblem(decoded.failure.message);
      return;
    }
    setStaged(decoded.success);
    // TODO(seam): this is where the project is written. It needs one operation
    // on `ProjectAdmin` — `create(root, metadata, books)` — that makes the
    // directory, writes `metadata.json` atomically and seeds a book file per
    // id in `currentScope`, because `openProject` refuses a root with no books.
    // Until that exists the form validates and stops, rather than leaving a
    // directory nothing can open.
  };

  const group = (title: string, set: readonly string[]) => (
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <h3 class="text-smallest font-semibold uppercase tracking-wide text-on-surface-tertiary">
          {title}
        </h3>
        <Button size="sm" variant="tertiary" onClick={() => selectAll(set)}>
          {t("Select all")}
        </Button>
      </div>
      <div class="flex flex-wrap gap-1">
        <For each={set}>
          {(book) => (
            <button
              type="button"
              aria-pressed={books().includes(book) ? "true" : "false"}
              onClick={() => toggle(book)}
              class="cursor-pointer rounded-md border border-surface-border bg-surface-primary px-2 py-1 font-mono text-smallest text-on-surface-secondary transition-colors hover:border-brand/40 aria-pressed:border-brand aria-pressed:bg-brand-light aria-pressed:text-brand"
            >
              {book}
            </button>
          )}
        </For>
      </div>
    </div>
  );

  const field = (label: string, hint: string, control: JSX.Element) => (
    <label class="flex flex-col gap-1">
      <span class="text-small font-medium text-on-surface-primary">{label}</span>
      <span class="text-smallest text-on-surface-tertiary">{hint}</span>
      {control}
    </label>
  );

  return (
    <div class="space-y-4">
      <Card class="space-y-5">
        <PanelHeader
          title={t("Create new project")}
          subtitle={t("Everything a Scripture Burrito needs to identify itself.")}
          actions={
            <Link
              to="/start/find"
              search={true}
              class="inline-flex items-center gap-1 text-smallest text-on-surface-tertiary no-underline hover:text-on-surface-secondary"
            >
              <ArrowLeft size={13} aria-hidden="true" />
              {t("Go back")}
            </Link>
          }
        />

        <div class="grid gap-4 sm:grid-cols-2">
          {field(
            t("Project name"),
            t("What translators will see in the projects list."),
            <Input
              value={name()}
              placeholder={t("Shila New Testament")}
              onInput={(event) => setName(event.currentTarget.value)}
            />,
          )}
          {field(
            t("Abbreviation"),
            t("Optional short form, e.g. SHNT."),
            <Input
              value={abbreviation()}
              placeholder={t("SHNT")}
              onInput={(event) => setAbbreviation(event.currentTarget.value)}
            />,
          )}
          {field(
            t("Project id"),
            t("The folder name on disk. Letters, digits and hyphens."),
            <Input
              value={projectId()}
              placeholder={t("bem-x-shila-nt")}
              onInput={(event) => setProjectId(event.currentTarget.value)}
            />,
          )}
          {field(
            t("Language name"),
            t("As its own speakers write it."),
            <Input
              value={languageName()}
              placeholder={t("Ichibemba")}
              onInput={(event) => setLanguageName(event.currentTarget.value)}
            />,
          )}
          {field(
            t("Language id"),
            t("A BCP-47 tag, e.g. bem or bem-x-shila."),
            <Input
              value={languageTag()}
              placeholder={t("bem-x-shila")}
              onInput={(event) => setLanguageTag(event.currentTarget.value)}
            />,
          )}
          {field(
            t("Script direction"),
            t("How the script runs on the page."),
            <Select
              value={direction()}
              onChange={(event) =>
                setDirection(event.currentTarget.value === "rtl" ? "rtl" : "ltr")
              }
            >
              <option value="ltr">{t("Left to right")}</option>
              <option value="rtl">{t("Right to left")}</option>
            </Select>,
          )}
        </div>

        <div class="space-y-1.5">
          <SegmentedControl
            label={t("Project type")}
            value={type()}
            onChange={setType}
            items={[
              { value: "translation", label: t("Translation") },
              { value: "gateway", label: t("Gateway") },
            ]}
          />
          <p class="text-smallest text-on-surface-tertiary">
            {t("A gateway project is the one other teams translate from.")}
          </p>
        </div>
      </Card>

      <Card class="space-y-4">
        <PanelHeader
          level={3}
          title={t("Books to include")}
          subtitle={t("{count} selected", { count: books().length })}
          actions={
            <Button size="sm" variant="tertiary" onClick={() => setBooks([])}>
              {t("Clear")}
            </Button>
          }
        />
        {group(t("Old Testament"), OLD_TESTAMENT)}
        {group(t("New Testament"), NEW_TESTAMENT)}
      </Card>

      <Card class="space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={!complete()} onClick={build}>
            {t("Validate metadata")}
          </Button>
          <p class="text-smallest text-on-surface-tertiary">
            {t(
              "Sefer cannot write a new project yet: this checks the metadata against the Scripture Burrito schema and shows it.",
            )}
          </p>
        </div>

        <Show when={problem() !== ""}>
          <p class="rounded-md bg-surface-error px-3 py-2 text-small break-words text-on-surface-error">
            {problem()}
          </p>
        </Show>

        <Show when={staged()}>
          {(metadata) => (
            <div class="space-y-2" data-staged-metadata>
              <div class="flex items-center gap-2">
                <Badge tone="success" size="sm">
                  {t("valid Scripture Burrito")}
                </Badge>
                <span class="text-smallest text-on-surface-tertiary">
                  {t("Not written: ProjectAdmin has no create yet.")}
                </span>
              </div>
              <pre class="max-h-72 overflow-auto rounded-md bg-surface-secondary p-3 font-mono text-smallest text-on-surface-secondary">
                {JSON.stringify(metadata(), undefined, 2)}
              </pre>
            </div>
          )}
        </Show>
      </Card>
    </div>
  );
}
