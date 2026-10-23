import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { Result } from "effect";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import { For, Show, createSignal } from "solid-js";

import { decodeBurritoMetadata, type BurritoMetadata } from "#core/resources/burrito";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Badge, Button, Card, Input, PanelHeader, SegmentedControl, Select } from "../primitives";

const OT_IDS =
  "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL";

const NT_IDS =
  "MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV";

const OLD_TESTAMENT: readonly string[] = OT_IDS.split(" ");

const NEW_TESTAMENT: readonly string[] = NT_IDS.split(" ");

type ProjectType = "translation" | "gateway";

interface Fields {
  readonly locale: string;
  readonly build: string;
  readonly type: ProjectType;
  readonly name: string;
  readonly abbreviation: string;
  readonly languageName: string;
  readonly languageTag: string;
  readonly direction: "ltr" | "rtl";
  readonly books: readonly string[];
}

const candidateFor = (fields: Fields) => {
  const { locale } = fields;
  const scope: Record<string, readonly string[]> = {};
  for (const book of fields.books) scope[book] = [];
  return {
    format: "scripture burrito",
    meta: {
      version: "1.0.0",
      category: fields.type === "gateway" ? "gateway" : "translation",
      generator: { softwareName: "Sefer", softwareVersion: fields.build },
      defaultLocale: locale,
      dateCreated: new Date(Date.now()).toISOString(),
    },
    identification: {
      name: { [locale]: fields.name.trim() },
      ...(fields.abbreviation.trim() === ""
        ? {}
        : { abbreviation: { [locale]: fields.abbreviation.trim() } }),
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
        tag: fields.languageTag.trim(),
        name: { [locale]: fields.languageName.trim() },
        scriptDirection: fields.direction,
      },
    ],
    ingredients: {},
  };
};

const toggled = (held: readonly string[], book: string): readonly string[] =>
  held.includes(book) ? held.filter((each) => each !== book) : [...held, book];

const withAll = (held: readonly string[], set: readonly string[]): readonly string[] => [
  ...new Set([...held, ...set]),
];

const createIdentity = () => {
  const [name, setName] = createSignal("", { name: "createName" });
  const [abbreviation, setAbbreviation] = createSignal("", { name: "createAbbrev" });
  const [projectId, setProjectId] = createSignal("", { name: "createId" });
  const [languageName, setLanguageName] = createSignal("", { name: "createLanguage" });
  const [languageTag, setLanguageTag] = createSignal("", { name: "createTag" });
  const [direction, setDirection] = createSignal<"ltr" | "rtl">("ltr", { name: "createDirection" });
  return {
    name,
    setName,
    abbreviation,
    setAbbreviation,
    projectId,
    setProjectId,
    languageName,
    setLanguageName,
    languageTag,
    setLanguageTag,
    direction,
    setDirection,
  };
};

const createProjectForm = () => {
  const shell = useShell();
  const { services } = shell;
  const locale = services.hostInfo.locale().split("-")[0] ?? "en";

  const identity = createIdentity();
  const { name, abbreviation, languageName, languageTag, direction } = identity;
  const [type, setType] = createSignal<ProjectType>("translation", { name: "createType" });
  const [books, setBooks] = createSignal<readonly string[]>([...NEW_TESTAMENT], {
    name: "createBooks",
  });
  const [staged, setStaged] = createSignal<BurritoMetadata | undefined>(undefined, {
    name: "createStaged",
  });
  const [problem, setProblem] = createSignal("", { name: "createProblem" });

  const build = (): void => {
    setProblem("");
    setStaged(undefined);
    const decoded = decodeBurritoMetadata(
      candidateFor({
        locale,
        build: services.hostInfo.build(),
        type: type(),
        name: name(),
        abbreviation: abbreviation(),
        languageName: languageName(),
        languageTag: languageTag(),
        direction: direction(),
        books: books(),
      }),
    );
    if (Result.isFailure(decoded)) setProblem(decoded.failure.message);
    else setStaged(decoded.success);
  };

  return {
    ...identity,
    type,
    setType,
    books,
    setBooks,
    staged,
    problem,
    build,
    toggle: (book: string): void => {
      setBooks((held) => toggled(held, book));
    },
    selectAll: (set: readonly string[]): void => {
      setBooks((held) => withAll(held, set));
    },
    complete: (): boolean =>
      name().trim() !== "" && languageName().trim() !== "" && languageTag().trim() !== "",
  };
};

type ProjectForm = ReturnType<typeof createProjectForm>;

const Field = (props: {
  readonly label: string;
  readonly hint: string;
  readonly children: JSX.Element;
}) => (
  <label class="flex flex-col gap-1">
    <span class="text-small font-medium text-on-surface-primary">{props.label}</span>
    <span class="text-smallest text-on-surface-tertiary">{props.hint}</span>
    {props.children}
  </label>
);

const BookGroup = (props: {
  readonly title: string;
  readonly set: readonly string[];
  readonly form: ProjectForm;
}) => (
  <div class="space-y-2">
    <div class="flex items-center gap-2">
      <h3 class="text-smallest font-semibold uppercase tracking-wide text-on-surface-tertiary">
        {props.title}
      </h3>
      <Button size="sm" variant="tertiary" onClick={() => props.form.selectAll(props.set)}>
        {t("Select all")}
      </Button>
    </div>
    <div class="flex flex-wrap gap-1">
      <For each={props.set}>
        {(book) => (
          <button
            type="button"
            aria-pressed={props.form.books().includes(book) ? "true" : "false"}
            onClick={() => props.form.toggle(book)}
            class="cursor-pointer rounded-md border border-surface-border bg-surface-primary px-2 py-1 font-mono text-smallest text-on-surface-secondary transition-colors hover:border-brand/40 aria-pressed:border-brand aria-pressed:bg-brand-light aria-pressed:text-brand"
          >
            {book}
          </button>
        )}
      </For>
    </div>
  </div>
);

const IdentityFields = (props: { readonly form: ProjectForm }) => (
  <div class="grid gap-4 sm:grid-cols-2">
    <Field label={t("Project name")} hint={t("What translators will see in the projects list.")}>
      <Input
        value={props.form.name()}
        placeholder={t("Shila New Testament")}
        onInput={(event) => props.form.setName(event.currentTarget.value)}
      />
    </Field>
    <Field label={t("Abbreviation")} hint={t("Optional short form, e.g. SHNT.")}>
      <Input
        value={props.form.abbreviation()}
        placeholder={t("SHNT")}
        onInput={(event) => props.form.setAbbreviation(event.currentTarget.value)}
      />
    </Field>
    <Field
      label={t("Project id")}
      hint={t("The folder name on disk. Letters, digits and hyphens.")}
    >
      <Input
        value={props.form.projectId()}
        placeholder={t("bem-x-shila-nt")}
        onInput={(event) => props.form.setProjectId(event.currentTarget.value)}
      />
    </Field>
    <Field label={t("Language name")} hint={t("As its own speakers write it.")}>
      <Input
        value={props.form.languageName()}
        placeholder={t("Ichibemba")}
        onInput={(event) => props.form.setLanguageName(event.currentTarget.value)}
      />
    </Field>
    <Field label={t("Language id")} hint={t("A BCP-47 tag, e.g. bem or bem-x-shila.")}>
      <Input
        value={props.form.languageTag()}
        placeholder={t("bem-x-shila")}
        onInput={(event) => props.form.setLanguageTag(event.currentTarget.value)}
      />
    </Field>
    <Field label={t("Script direction")} hint={t("How the script runs on the page.")}>
      <Select
        value={props.form.direction()}
        onChange={(event) =>
          props.form.setDirection(event.currentTarget.value === "rtl" ? "rtl" : "ltr")
        }
      >
        <option value="ltr">{t("Left to right")}</option>
        <option value="rtl">{t("Right to left")}</option>
      </Select>
    </Field>
  </div>
);

const StagedMetadata = (props: { readonly metadata: BurritoMetadata }) => (
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
      {JSON.stringify(props.metadata, undefined, 2)}
    </pre>
  </div>
);

const TypePicker = (props: { readonly form: ProjectForm }) => (
  <div class="space-y-1.5">
    <SegmentedControl
      label={t("Project type")}
      value={props.form.type()}
      onChange={props.form.setType}
      items={[
        { value: "translation", label: t("Translation") },
        { value: "gateway", label: t("Gateway") },
      ]}
    />
    <p class="text-smallest text-on-surface-tertiary">
      {t("A gateway project is the one other teams translate from.")}
    </p>
  </div>
);

const BooksCard = (props: { readonly form: ProjectForm }) => (
  <Card class="space-y-4">
    <PanelHeader
      level={3}
      title={t("Books to include")}
      subtitle={t("{count} selected", { count: props.form.books().length })}
      actions={
        <Button size="sm" variant="tertiary" onClick={() => props.form.setBooks([])}>
          {t("Clear")}
        </Button>
      }
    />
    <BookGroup title={t("Old Testament")} set={OLD_TESTAMENT} form={props.form} />
    <BookGroup title={t("New Testament")} set={NEW_TESTAMENT} form={props.form} />
  </Card>
);

export function CreateProject() {
  const form = createProjectForm();

  return (
    <div class="space-y-4">
      <Card class="space-y-5">
        <PanelHeader
          title={t("Create new project")}
          subtitle={t("Everything a Scripture Burrito needs to identify itself.")}
          actions={
            <Link
              to="/projects"
              search={true}
              class="inline-flex items-center gap-1 text-smallest text-on-surface-tertiary no-underline hover:text-on-surface-secondary"
            >
              <ArrowLeft size={13} aria-hidden="true" />
              {t("Go back")}
            </Link>
          }
        />

        <IdentityFields form={form} />

        <TypePicker form={form} />
      </Card>

      <BooksCard form={form} />

      <Card class="space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled>
            {t("Create (not available yet)")}
          </Button>
          <Button disabled={!form.complete()} onClick={form.build}>
            {t("Validate metadata")}
          </Button>
          <p class="min-w-60 flex-1 text-smallest text-on-surface-tertiary">
            {t(
              "Sefer cannot write a new project yet: ProjectAdmin has no create, and a project with no books could not be opened. Validate checks this metadata against the Scripture Burrito schema and shows exactly what would be written.",
            )}
          </p>
        </div>

        <Show when={form.problem() !== ""}>
          <p class="rounded-md bg-surface-error px-3 py-2 text-small break-words text-on-surface-error">
            {form.problem()}
          </p>
        </Show>

        <Show when={form.staged()}>{(metadata) => <StagedMetadata metadata={metadata()} />}</Show>
      </Card>
    </div>
  );
}
