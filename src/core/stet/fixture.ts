import { Effect, Layer, Option } from "effect";

import manifest from "../../../fixtures/stet/index.json?raw";
import {
  StetCatalog,
  StetError,
  decodeGuide,
  decodeManifestGuides,
  type Guide,
  type Term,
} from "./stet";

export const DEFAULT_LOCALE = "en";

const GUIDES: Readonly<Record<string, () => Promise<{ readonly default: string }>>> = {
  en: () => import("../../../fixtures/stet/en.json?raw"),
  "es-419": () => import("../../../fixtures/stet/es-419.json?raw"),
  "pt-br": () => import("../../../fixtures/stet/pt-br.json?raw"),
};

const parse = (locale: string, text: string): Effect.Effect<unknown, StetError> =>
  Effect.try({
    // SAFETY: widening, not narrowing. `JSON.parse` is typed `any`, and the whole point of this module is that nothing trusts the bytes until `decodeGuide` has decoded them.
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => new StetError({ locale, reason: `not JSON: ${String(cause)}` }),
  });

const held = new Map<string, readonly Term[]>();

export const StetCatalogFixtureLive: Layer.Layer<StetCatalog> = Layer.sync(StetCatalog, () => {
  const load = (locale: string): Effect.Effect<readonly Term[], StetError> =>
    Effect.gen(function* () {
      const cached = held.get(locale);
      if (cached !== undefined) return cached;
      const bytes = GUIDES[locale];
      if (bytes === undefined)
        return yield* Effect.fail(new StetError({ locale, reason: "no guide for this locale" }));
      const module = yield* Effect.tryPromise({
        try: bytes,
        catch: (cause) => new StetError({ locale, reason: `could not load: ${String(cause)}` }),
      });
      const terms = yield* Effect.flatMap(parse(locale, module.default), (value) =>
        decodeGuide(locale, value),
      );
      held.set(locale, terms);
      return terms;
    });

  const find = (id: string, locale: string): Effect.Effect<Option.Option<Term>, StetError> =>
    Effect.map(load(locale), (terms) => {
      const found = terms.find((term) => term.id === id);
      return found === undefined ? Option.none<Term>() : Option.some(found);
    });

  return {
    guides: (): Effect.Effect<readonly Guide[], StetError> =>
      Effect.flatMap(parse("*", manifest), decodeManifestGuides),

    terms: (locale = DEFAULT_LOCALE) => load(locale),

    term: (id, locale = DEFAULT_LOCALE) => find(id, locale),

    occurrences: (termId, locale = DEFAULT_LOCALE) =>
      Effect.map(find(termId, locale), (term) =>
        Option.isNone(term) ? [] : term.value.occurrences,
      ),
  };
});
