import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { Result } from "effect";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import { For, Show, createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";
import { decodeBurritoMetadata, type BurritoMetadata } from "#core/resources/burrito";

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
        {m.landing_select_all()}
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
    <Field label={m.landing_project_name()} hint={m.landing_what_translators_will_see_in()}>
      <Input
        value={props.form.name()}
        placeholder={m.landing_shila_new_testament()}
        onInput={(event) => props.form.setName(event.currentTarget.value)}
      />
    </Field>
    <Field label={m.landing_abbreviation()} hint={m.landing_optional_short_form_e_g()}>
      <Input
        value={props.form.abbreviation()}
        placeholder={m.landing_shnt()}
        onInput={(event) => props.form.setAbbreviation(event.currentTarget.value)}
      />
    </Field>
    <Field label={m.landing_project_id()} hint={m.landing_the_folder_name_on_disk()}>
      <Input
        value={props.form.projectId()}
        placeholder={m.landing_bem_x_shila_nt()}
        onInput={(event) => props.form.setProjectId(event.currentTarget.value)}
      />
    </Field>
    <Field label={m.landing_language_name()} hint={m.landing_as_its_own_speakers_write()}>
      <Input
        value={props.form.languageName()}
        placeholder={m.landing_ichibemba()}
        onInput={(event) => props.form.setLanguageName(event.currentTarget.value)}
      />
    </Field>
    <Field label={m.landing_language_id()} hint={m.landing_a_bcp_47_tag_e()}>
      <Input
        value={props.form.languageTag()}
        placeholder={m.landing_bem_x_shila()}
        onInput={(event) => props.form.setLanguageTag(event.currentTarget.value)}
      />
    </Field>
    <Field label={m.landing_script_direction()} hint={m.landing_how_the_script_runs_on()}>
      <Select
        value={props.form.direction()}
        onChange={(event) =>
          props.form.setDirection(event.currentTarget.value === "rtl" ? "rtl" : "ltr")
        }
      >
        <option value="ltr">{m.landing_left_to_right()}</option>
        <option value="rtl">{m.landing_right_to_left()}</option>
      </Select>
    </Field>
  </div>
);

const StagedMetadata = (props: { readonly metadata: BurritoMetadata }) => (
  <div class="space-y-2" data-staged-metadata>
    <div class="flex items-center gap-2">
      <Badge tone="success" size="sm">
        {m.landing_valid_scripture_burrito()}
      </Badge>
      <span class="text-smallest text-on-surface-tertiary">
        {m.landing_not_written_projectadmin_has_no()}
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
      label={m.landing_project_type()}
      value={props.form.type()}
      onChange={props.form.setType}
      items={[
        { value: "translation", label: m.landing_translation() },
        { value: "gateway", label: m.landing_gateway() },
      ]}
    />
    <p class="text-smallest text-on-surface-tertiary">{m.landing_a_gateway_project_is_the()}</p>
  </div>
);

const BooksCard = (props: { readonly form: ProjectForm }) => (
  <Card class="space-y-4">
    <PanelHeader
      level={3}
      title={m.landing_books_to_include()}
      subtitle={m.landing_count_selected({ count: props.form.books().length })}
      actions={
        <Button size="sm" variant="tertiary" onClick={() => props.form.setBooks([])}>
          {m.common_clear()}
        </Button>
      }
    />
    <BookGroup title={m.common_old_testament()} set={OLD_TESTAMENT} form={props.form} />
    <BookGroup title={m.common_new_testament()} set={NEW_TESTAMENT} form={props.form} />
  </Card>
);

export function CreateProject() {
  const form = createProjectForm();

  return (
    <div class="space-y-4">
      <Card class="space-y-5">
        <PanelHeader
          title={m.landing_create_new_project()}
          subtitle={m.landing_everything_a_scripture_burrito_needs()}
          actions={
            <Link
              to="/projects"
              search={true}
              class="inline-flex items-center gap-1 text-smallest text-on-surface-tertiary no-underline hover:text-on-surface-secondary"
            >
              <ArrowLeft size={13} aria-hidden="true" />
              {m.landing_go_back()}
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
            {m.landing_create_not_available_yet()}
          </Button>
          <Button disabled={!form.complete()} onClick={form.build}>
            {m.landing_validate_metadata()}
          </Button>
          <p class="min-w-60 flex-1 text-smallest text-on-surface-tertiary">
            {m.landing_sefer_cannot_write_a_new()}
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
