import { Result, Schema } from "effect";

const LocalizedText = Schema.Record(Schema.String, Schema.String);

const Scope = Schema.Record(Schema.String, Schema.Array(Schema.String));

const Checksum = Schema.Struct({
  md5: Schema.String,
});

const Ingredient = Schema.Struct({
  checksum: Checksum,
  mimeType: Schema.String,
  size: Schema.Number,
  scope: Schema.optionalKey(Scope),
});

const Generator = Schema.Struct({
  softwareName: Schema.String,
  softwareVersion: Schema.optionalKey(Schema.String),
});

const Meta = Schema.Struct({
  version: Schema.String,
  category: Schema.optionalKey(Schema.String),
  generator: Schema.optionalKey(Generator),
  defaultLocale: Schema.optionalKey(Schema.String),
  dateCreated: Schema.optionalKey(Schema.String),
});

const IdAuthority = Schema.Struct({
  id: Schema.String,
  name: LocalizedText,
});

const PrimaryId = Schema.Struct({
  revision: Schema.optionalKey(Schema.String),
  timestamp: Schema.optionalKey(Schema.String),
});

const Identification = Schema.Struct({
  name: LocalizedText,
  abbreviation: Schema.optionalKey(LocalizedText),
  description: Schema.optionalKey(LocalizedText),
  primary: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Record(Schema.String, PrimaryId)),
  ),
});

const Flavor = Schema.Struct({
  name: Schema.String,
});

const FlavorType = Schema.Struct({
  name: Schema.String,
  flavor: Flavor,
  currentScope: Schema.optionalKey(Scope),
});

const BurritoType = Schema.Struct({
  flavorType: FlavorType,
});

const Language = Schema.Struct({
  tag: Schema.String,
  name: LocalizedText,
  scriptDirection: Schema.optionalKey(Schema.Literals(["ltr", "rtl"])),
});

const LocalizedName = Schema.Struct({
  short: LocalizedText,
  long: Schema.optionalKey(LocalizedText),
  abbr: Schema.optionalKey(LocalizedText),
});

const BurritoMetadata = Schema.Struct({
  format: Schema.Literal("scripture burrito"),
  meta: Meta,
  idAuthorities: Schema.optionalKey(Schema.Record(Schema.String, IdAuthority)),
  identification: Identification,
  type: BurritoType,
  languages: Schema.Array(Language),
  ingredients: Schema.Record(Schema.String, Ingredient),
  localizedNames: Schema.optionalKey(Schema.Record(Schema.String, LocalizedName)),
});

export type BurritoMetadata = typeof BurritoMetadata.Type;

export type BurritoIngredient = typeof Ingredient.Type;

const decode = Schema.decodeUnknownResult(BurritoMetadata);

export const decodeBurritoMetadata = (
  value: unknown,
): Result.Result<BurritoMetadata, Schema.SchemaError> => decode(value);
