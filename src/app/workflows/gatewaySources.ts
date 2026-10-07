/**
 * Gateway texts as a project's source: what Refine's reference panel offers
 * under "Add source…", and what a project gets by default so that panel is
 * never empty.
 *
 * A gateway text is a Gateway Language translation WA publishes (catalogue
 * owner `wa-catalog`): English ULB, French, Swahili… It is READ beside a
 * translation, not worked in. So it is downloaded into the Library's own
 * folder (`services.sourcesRoot`), never the projects root: it is registered
 * with the Library and bound to a project as its `source`, and it is never in
 * "Your projects" to be opened for editing. The backend is the same clone the
 * projects page uses — latest version only — only where it lands differs.
 *
 * Editing a gateway text (a revision of the gateway itself) is a separate,
 * rarer job, and how someone is allowed to is not decided: a setting, a
 * separate build, or accounts and permissions. Nothing here offers it.
 *
 * The default: the project's own gateway language when its manifest names
 * one (`ProjectMetadata.sourceLanguage`), else English. To be confirmed with
 * the developer: whether a download should also fetch it up front, rather
 * than when the project is first opened (as here).
 */

import { Effect, FileSystem } from "effect";

import { cloneRepository } from "#core/remote/clone";
import type { Resource } from "#core/resources/library";

import { catalogueFor, type CatalogueEntry } from "../catalogue";
import type { Services } from "../services";

/** One gateway language on offer: its tag, its English name, and the text to fetch. */
export interface GatewayText {
  readonly code: string;
  readonly name: string;
  readonly entry: CatalogueEntry;
}

/** What the project falls back to when its manifest names no source language. */
export const DEFAULT_SOURCE_LANGUAGE = "en";

/**
 * Every gateway language the catalogue offers, one text each, A–Z. Where WA
 * publishes several texts in one language, the ULB is the one a translator
 * reads from, so it is preferred.
 */
export const gatewayTexts = async (
  services: Pick<Services, "settings">,
): Promise<readonly GatewayText[]> => {
  const { rows } = await catalogueFor(services.settings).entries();
  const best = new Map<string, CatalogueEntry>();
  for (const row of rows) {
    if (row.type !== "gateway" || row.owner.toLowerCase() !== "wa-catalog") continue;
    const held = best.get(row.code);
    const ulb = (entry: CatalogueEntry): boolean => /_ulb$/iu.test(entry.repo);
    if (held === undefined || (!ulb(held) && ulb(row))) best.set(row.code, row);
  }
  return [...best.values()]
    .map((entry) => ({
      code: entry.code,
      name: entry.anglicizedName || entry.naturalName,
      entry,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/** The gateway text for one language, if the catalogue has it. */
export const gatewayTextFor = (
  texts: readonly GatewayText[],
  language: string,
): GatewayText | undefined => {
  const want = language.toLowerCase();
  return (
    texts.find((text) => text.code.toLowerCase() === want) ??
    texts.find((text) => text.code.toLowerCase().split("-")[0] === want.split("-")[0])
  );
};

/** Where a gateway text lives on this device: the Library's folder, by repository. */
const rootOf = (services: Pick<Services, "sourcesRoot">, text: GatewayText): string =>
  `${services.sourcesRoot}/${text.entry.repo}`;

/**
 * Makes `text` this project's source: downloads it into the Library's folder
 * if it is not already there, registers it, and binds it under `source`.
 * Idempotent — a text already downloaded is only bound, and binding twice is
 * one binding.
 */
export const useGatewaySource = (
  services: Pick<Services, "sourcesRoot" | "library">,
  projectId: string,
  text: GatewayText,
) =>
  Effect.gen(function* () {
    const into = rootOf(services, text);
    const fileSystem = yield* FileSystem.FileSystem;
    const here = yield* Effect.orElseSucceed(fileSystem.exists(into), () => false);
    if (!here)
      yield* cloneRepository(text.entry.gitUrl, into, text.entry.id, { history: "latest" });
    const resource: Resource = yield* services.library.add(into);
    yield* services.library.bind(projectId, "source", resource.id);
    return resource;
  });
