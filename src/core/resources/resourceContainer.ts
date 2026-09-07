import { Result, Schema } from "effect";

const Language = Schema.Struct({
  identifier: Schema.String,
  direction: Schema.String,
  title: Schema.String,
});

const Source = Schema.Struct({
  identifier: Schema.String,
  language: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
});

const DublinCore = Schema.Struct({
  identifier: Schema.String,
  language: Language,
  title: Schema.String,
  version: Schema.optionalKey(Schema.String),
  subject: Schema.optionalKey(Schema.String),
  format: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  rights: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.Array(Source)),
});

const Checking = Schema.Struct({
  checking_level: Schema.String,
  checking_entity: Schema.optionalKey(Schema.Array(Schema.String)),
});

const Project = Schema.Struct({
  identifier: Schema.String,
  title: Schema.String,
  path: Schema.String,
  sort: Schema.Number,
  versification: Schema.optionalKey(Schema.String),
  categories: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const ResourceContainerManifest = Schema.Struct({
  dublin_core: DublinCore,
  checking: Schema.optionalKey(Checking),
  projects: Schema.Array(Project),
});

export type ResourceContainerManifest = typeof ResourceContainerManifest.Type;

export type ResourceContainerProject = typeof Project.Type;

export type ResourceContainerLanguage = typeof Language.Type;

const decode = Schema.decodeUnknownResult(ResourceContainerManifest);

export const decodeResourceContainerManifest = (
  value: unknown,
): Result.Result<ResourceContainerManifest, Schema.SchemaError> => decode(value);
