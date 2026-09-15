/**
 * The committed key-terms guides, as a `StetCatalog` layer.
 *
 * Same trick as `src/core/fixture/smallNt.ts` — the bytes are the
 * repository's, imported rather than fetched, so the screen works with no
 * network, no host and no project binding. Two differences, both because a
 * guide is a thousand times the size of a fixture book:
 *
 *  - The `?raw` imports are DYNAMIC. Each guide is well over a megabyte, and a
 *    static import would put all three into the main bundle for a screen most
 *    sessions never open. As written, Vite emits one chunk per locale and
 *    fetches the one that was asked for.
 *  - The decoded result is CACHED per locale, in a plain map. Decoding is a
 *    `JSON.parse` of a megabyte plus a schema walk over five thousand verses;
 *    it is not something to do again because a reader clicked a second term.
 *
 * Everything else — the schema, the join, the refusals — is `./stet.ts`'s.
 * This file knows only which bytes belong to which locale, the way
 * `PublicStetCatalogSource` was the only thing that knew URLs in the previous
 * application.
 */

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

/** The guide a screen gets when it does not ask for one. */
export const DEFAULT_LOCALE = "en";

/**
 * Locale → the bytes of its envelope.
 *
 * A literal map rather than a computed path because Vite resolves an import
 * specifier at build time: a template string would give it nothing to bundle.
 * Adding a locale is a row here and a row in `fixtures/stet/index.json`.
 */
const GUIDES: Readonly<Record<string, () => Promise<{ readonly default: string }>>> = {
  en: () => import("../../../fixtures/stet/en.json?raw"),
  "es-419": () => import("../../../fixtures/stet/es-419.json?raw"),
  "pt-br": () => import("../../../fixtures/stet/pt-br.json?raw"),
};

const parse = (locale: string, text: string): Effect.Effect<unknown, StetError> =>
  Effect.try({
    // SAFETY: widening, not narrowing. `JSON.parse` is typed `any`, and the
    // whole point of this module is that nothing trusts the bytes until
    // `decodeGuide` has decoded them.
    try: () => JSON.parse(text) as unknown,
    catch: (cause) => new StetError({ locale, reason: `not JSON: ${String(cause)}` }),
  });

/**
 * The fixture-backed catalogue.
 *
 * `Layer.sync` rather than `Layer.effect`: nothing is read until a caller asks
 * for a guide, so building the layer costs a closure and an empty map.
 */
export const StetCatalogFixtureLive: Layer.Layer<StetCatalog> = Layer.sync(StetCatalog, () => {
  const held = new Map<string, readonly Term[]>();

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
