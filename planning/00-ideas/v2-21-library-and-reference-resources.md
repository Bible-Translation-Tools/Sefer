# 21 — Library bindings, sources, and Translation Notes

Status: proposed. Prerequisites: [20](v2-20-import-and-classification.md), [16](v2-16-readonly-surfaces.md). Owns: stable local resource identities and project-role bindings.

## Outcome and increments

1. Bind an imported source scripture to a target project with stable local identity and immutable provenance. Display one source alongside the target with useful chapter/verse navigation.
2. Add an auxiliary reference without duplicating target ownership. Represent unavailable bindings as recoverable missing resources.
3. Render Translation Notes by their semantic domain, including anchors and safe links. Markdown is a physical format, not a universal resource model. Reading is the initial job; note authoring is not implied.
4. Add deliberate resource replacement/adoption only after comparison and provenance policy exist. Optional update checks remain opt-in and cannot silently change the translation basis.

The Web import cost for a raw TN archive, and the direct-to-packed alternative, are captured in [Fast Web import for Translation Notes](../01-discussing/web-translation-notes-import.md).

## Resource layers to finish

The current Library is a registry and project-role binding service, not yet a general resource reader. It recognizes Burrito, Resource Container, and loose-USFM containers; preserves `subject`; and can bind the `tn` and `tw` roles. Its implemented `readBook` and `lookup` methods assume USFM, and the current reference column only renders scripture. A successful TN/TW binding therefore must not imply that Sefer can read or display its content.

Keep four responsibilities distinct as the next resource type arrives:

1. **Identity and binding:** register a resource, retain metadata/provenance, and assign a role in a project. Container format, resource subject, and contextual role answer different questions; a role alone does not select a parser.
2. **Subject reader:** validate and decode the resource's actual content, then expose queries in its own address space. Scripture is queried by book/chapter/verse and yields canonical USFM. Translation Notes are queried by scripture anchor and yield note entries with exact Markdown bodies. Translation Words or a lexicon should be queried by its term/article/lexeme key if that is what its real corpus uses; references *inside* an entry do not make BCV its primary address.
3. **Application adapter:** turn editor location, selection, or a content link into a subject query. Missing books, verses, or entries are ordinary empty results. Cross-resource navigation, such as a TN link to a TW article, belongs here rather than in the registry.
4. **Presentation:** transform the subject result into a safe read-only UI. Markdown parsing, link policy, reference hover/navigation, and any subject-specific layout happen after decoding; no universal Markdown or USFM renderer is assumed.

Build the TN reader and anchor adapter against a representative resource first. Reuse the old app's per-book packed TN shape as evidence, not an automatic compatibility requirement. It had a loaded `translationNotes` noun and a BCV anchor adapter; `translationWords` appeared in its catalog taxonomy but did not have an equivalent loaded reader. Add a small shared reader contract only when TN plus another real subject reveal repeated behavior. Avoid making every resource implement `lookup(Ref)` or building a plugin SDK in advance.

## Contract and failures

Resource kind, physical format, and binding role are independent. Read-only enforcement applies at the mounted capability boundary. Target export does not copy every bound resource body. Library identity survives display-name changes; a missing item cannot silently resolve to a different release with the same title.

External resource markup/links need the application's safe rendering and navigation policy; content is data, not agent or application instructions.

## Useful proof

A real source/TN fixture proves correct anchor navigation, target-independent selection, denied source mutation, and missing-binding recovery. One restart proves provenance/binding persistence. Do not implement a plugin SDK to prepare for speculative resource types.

## Open questions

What is the exact scripture/TN alignment policy for differing versification, bridges, or missing verses? Which blessed-source releases must work offline? What are the actual entry keys, file layout, and link conventions of a representative TW corpus? Does a second implemented subject reader justify a small shared capability interface? Translation Questions, arbitrary docking, and authoring non-scripture resources remain explicit later choices rather than automatic parity.
