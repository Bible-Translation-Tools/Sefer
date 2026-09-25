# Resource plugins: one interface for Macula, Translation Notes and whatever comes next

**Status:** an idea to preserve, 2026-09-24. Nothing authorized. Written from Will's description and a read of the Macula prototype in `~/Downloads/clearBibleSyntaxTree` (README and `packages/macula-js/src/types.ts`). Related: [Translation Notes import](../01-discussing/web-translation-notes-import.md), the Library's roles (`documentation/architecture/resources.md`), and Location (`documentation/architecture/location.md`).

## The job

Sefer will hold resources that are not scripture text: Macula's Hebrew and Greek syntax trees, Translation Notes (TN), Words (TW), Questions (TQ), the STET guide. Today a `tn` or `tw` binding can be made and nothing reads it (`documentation/services.md`, Library). Each of these needs the same few things from the app — find what it says at a place, search it, perhaps edit it — and differs in everything else. The aim is a plugin interface small enough that a new resource kind is an adapter, not a feature, and that the app composes the same way the screens compose the primitives (`documentation/architecture/primitives.md`).

## What the Macula prototype already shows

- **It answers in places.** `passages(query)` returns `{ book, chapter, verseStart, verseEnd }`: "resolve the reference against your own text and you have your answer." That is an Address (`core/location/address.ts`); the adapter is a one-liner.
- **Its search describes itself.** `dimensions()` returns what a query can filter on (part of speech, stem, tense, case…) and presets (construct chain, genitive absolute); `facets(query)` returns how the CURRENT result set divides along each, with live counts, dropping dead ends. Nothing in the package names a grammatical category: "the difference between a case and a binyan is data." This is exactly the shape the host should require of every searchable resource — handles for a UI to call, not a list of categories Sefer predefines.
- **Reverse lookup.** `lookup("elohim" | "love" | "אֱלֹהִים")` finds a lemma by romanization, gloss or form; the lemma is a filter, and a filter is passages.
- **Below the verse.** `run()` returns hits with highlight spans, `word()` a word's full analysis and enclosing constituents — the word and morpheme level U23003 addresses with `!` (location.md, "U23003"). Five-level addressing in Hebrew (morphemes share a word address).
- **Read-only, fetched whole, wasm behind a reader.** One compiled blob per corpus (14.5 MB Greek, 47.3 MB Hebrew), opened without parsing; right-to-left carried in the blob.

## Every call may be async

A plugin need not be a file on this device. A resource could live in a database behind a service, answer over the network, and still be a perfectly good plugin — so the interface cannot be synchronous, even though Macula and TN happen to be local. **Every capability call returns an Effect.** A local plugin answers with `Effect.succeed` and costs nothing; a remote one really waits, can fail, and can be interrupted. The colour is paid once, in the interface, rather than again by whichever plugin first turns out to be remote.

What that buys and costs, stated once:

- **Failure is typed and expected.** `ResourceError` includes "unavailable" (offline, a service down) as an ordinary answer, not a crash; a pane shows it the way it shows "this resource has nothing here".
- **Interruption.** Following the caret fires a query per verse; the previous one is interrupted when the caret moves (Effect's fibers), so a slow remote plugin never paints a stale verse.
- **Paging is the plugin's.** `run` and `at` take a page; a remote plugin never ships a whole result set.
- **Caching is the host's, keyed by identity.** The handle's `identity` (format plus Fingerprint, or a remote version) is what a cached answer is keyed by, so a cache never outlives the data it came from.
- **Location stays synchronous.** Resolving an Address inside a text Sefer holds is pure and immediate (`core/location`); only asking a RESOURCE is async. The two meet at the Address, which is a plain value.

## The boundary: Library, plugins, UI

```text
Library (core/resources)      what is registered, where its bytes are, which role it plays in a project
   │  resolve(project, role) → Resource[]
   ▼
Plugin registry               kind → ResourcePlugin; recognize(metadata) picks one; open(resource) → handle
   │
   ▼
ResourceHandle                places / search? / edit?   — every call an Effect
   │
   ▼
shell.resources (app)         the project's handles by role, opened once, released with the project
   │
   ▼
UI                            a pane, a faceted search, an editor — by capability, never by kind
```

The Library keeps its present job — discovery, binding to roles, reading bytes — and gains nothing kind-specific. The registry is the only place that knows kinds. The UI asks `shell.resources` for the handles a role holds and composes by CAPABILITY: anything with `places` can fill a pane that follows the caret, anything with `search` can drive the faceted search, anything with `edit` offers Edit. A remote resource is a plugin whose `open` returns a handle backed by a client instead of bytes; nothing above the registry can tell.

## The interface: a handle with optional capabilities

Capabilities are separate and optional, the way Location split parse, resolve and label: a resource declares what it can do, and the app offers only that. A kind that cannot be edited simply has no `edit`; the UI never asks.

```ts
// src/core/resources/plugin.ts — framework-free, like the rest of core
interface ResourcePlugin {
  /** "macula-hebrew", "macula-greek", "tn-markdown", "tw-markdown" … */
  readonly kind: string;
  /** Classify from DECODED metadata, never a filename (the TN plan's rule 1). */
  recognize(metadata: ResourceMetadata): boolean;
  /** Open a registered resource: bytes through the Library, wasm through the platform. */
  open(resource: Resource): Effect<ResourceHandle, ResourceError>;
}

interface ResourceHandle {
  readonly info: {
    readonly title: string;
    readonly language: string;
    readonly direction: "ltr" | "rtl";
    /** Which numbering its Addresses use — see "Versification" below. */
    readonly versification: string;
    /** What exactly was opened: format version plus a Fingerprint. */
    readonly identity: { readonly format: string; readonly fingerprint: Fingerprint };
  };
  /** Required: every resource answers where. */
  readonly places: Places;
  readonly search?: Searchable;
  readonly edit?: Editable;
}
```

### Places (required): BCV both ways

```ts
interface Places {
  /** Does this resource have anything for this place? Cheap: a sidebar dot, a pane's empty state. */
  covers(address: Address): Effect<"yes" | "no" | "partly", ResourceError>;
  /** What the resource says at a place, as opaque entries in its own order. */
  at(address: Address, page?: Page): Effect<Paged<Entry>, ResourceError>;
  /** The places an entry is about. A TN note names one verse; a Macula clause may span two. */
  addressesOf(entry: EntryId): Effect<readonly Address[], ResourceError>;
}

interface Entry {
  readonly id: EntryId; // stable within the resource's identity
  readonly addresses: readonly Address[];
  readonly kind: string; // the plugin's own vocabulary: "note", "clause", "word"
}
```

Entries are OPAQUE to the host: a TN note is Markdown, a Macula entry is a subtree. The host holds ids and Addresses; the plugin's renderer draws the rest (below). That keeps the reference pane, a notes pane and a syntax pane one composition — follow the caret's Address (`whereAmI`), ask `places.at`, render what comes back — with nothing kind-specific in it.

### Search (optional): self-described facets

```ts
interface Searchable<Query = unknown> {
  /** What a query can filter on, as the resource describes itself. Nothing predefined by Sefer. */
  dimensions(): Effect<Dimensions, ResourceError>;
  /** How the CURRENT result set divides along each dimension, with live counts; dead ends dropped. */
  facets(query: Query): Effect<readonly Facet[], ResourceError>;
  /** Results, paged, each with the places it is about and display parts for a preview. */
  run(query: Query, page: Page): Effect<Paged<SearchHit>, ResourceError>;
  /** Optional reverse lookup ("what word am I thinking of"): typed text → filters. */
  lookup?(text: string): Effect<readonly Suggestion[], ResourceError>;
}

interface SearchHit {
  readonly entry: EntryId;
  readonly addresses: readonly Address[];
  /** Plain display runs with highlight flags, as Macula's `TextPart` — never parsed back. */
  readonly parts: readonly { readonly text: string; readonly highlight: boolean }[];
}
```

`Query` is the plugin's own type; the host treats it as a value it builds from the menus `dimensions` and `facets` gave it, and passes back. One generic faceted-search UI serves every searchable kind: a text box, the menus a resource describes, and results as Addresses — which the existing multibuffer already shows as cards beside the project's own verse (`excerpts.addressOccurrences`, Find's reference pairing by `addressesOverlap`). Full-text search over TN Markdown is just a plugin whose only dimension is "text".

### Edit (optional): a writable unit judged like a surface

```ts
interface Editable {
  /** The format a person edits in: "markdown" for TN. The host picks the editor surface by it. */
  readonly format: string;
  /** One writable unit — a note — shaped like a Book: Source, stamp, apply, changes. */
  open(entry: EntryId): Effect<WritableEntry, ResourceError>;
  /** Create and delete, when the resource allows them (a new note for a verse). */
  create?(address: Address): Effect<EntryId, ResourceError>;
  remove?(entry: EntryId): Effect<void, ResourceError>;
}
```

A TN note being edited is a small text document, so it should be the SAME machinery as scripture where that machinery is about text rather than USFM: a Source with a stamp, `apply` as the one write path, the explicit save model (written only when a version is recorded), the Recovery journal, a separate CodeMirror instance for the Markdown (the commenting plan already assumes one). What it does not get is the USFM phases; its rules, if any, are the plugin's. The plugin owns serialization back to its packed format (per-book JSON for TN, per the import plan) and says what a write-back costs. A read-only kind like Macula omits `edit` entirely, and so the UI never offers it.

### Rendering: the one app-side half

Core defines the data interface above; the app registers a renderer per kind (`src/app/ui/resources/<kind>.tsx`): given entries, draw them. Keeping the renderer out of core keeps core framework-free and lets the plugin's data half run in tests and tools. The renderer uses the primitives like any screen: `shell.location.label` for places, `shell.showReference` to jump, `flash` to mark.

## How it composes

- **A notes pane beside the text** — the reference pane's shape: the caret's Address → `places.at` → the TN renderer. Following, pinning and clipping are the pane's, exactly as for a reference text.
- **Syntax at the caret** — the same, with the Macula renderer; `word()`-level detail on hover.
- **"Where else does this construction occur?"** — `search.run` with the preset → Addresses → the multibuffer, with the project's own verse as each card.
- **References inside a TN note** — TN Markdown is full of citations ("see Rom 3:10"). This, not comments, may be the prose Citation scanner's first consumer (`citation.ts` already has the `prose` grammar and nothing that scans).
- **Editing a TN note** — the notes pane's Edit → a Markdown editor over the note's WritableEntry → `apply` → Record a version writes the packed book.

## Open questions

1. **Versification.** WLC Hebrew numbers some verses differently from English (Psalm titles, Malachi 4 as 3:19–24, Joel, others). A resource declares its scheme; mapping one Address between schemes is a separate primitive that Location does not have yet, and every cross-resource pane needs it. Not solved by this interface; named so no plugin hides it.
2. **Below the verse.** Macula entries and hits carry word and morpheme positions. The interface above stays at Addresses; a word-level place is a Location in the resource's own text (U23003's `!` refinement), not an Address. Whether the host ever needs it (aligned word highlighting in the project's text) decides whether `Places` grows a finer answer.
3. **Where plugins come from.** Built in (Macula, TN, TW compiled into the app), loaded (a resource package declaring its kind), or remote (a service answering the same interface)? Built-in first; the interface assumes none of them, which is why every call is an Effect.
4. **Remote editing.** An editable remote resource cannot use the local explicit-save model as-is: whose version is recorded, and what does Recovery journal? Probably the remote's own versioning, surfaced through `WritableEntry` — to decide when the first remote editable kind exists, not before.
5. **Loading and memory.** Macula fetches a 47 MB blob whole; TN is per-book JSON. Whether `open` is whole or lazy per book is each plugin's call, but the Library's storage and the Web import path (the TN plan) need to know the shape.
6. **Edit semantics for TN.** One note per verse or several (the TN plan warns against flattening); ordering; whether a new note needs an id the upstream format understands; how an edited TN resource syncs (is it a Git project of its own?).
7. **Identity across versions.** An entry id must survive re-import of the same resource version and be detectably stale across versions — the Fingerprint rule (location.md) applied to resources.
8. **Licensing and attribution.** Macula and TN carry licenses; a renderer may be obliged to show attribution. The handle's `info` may need it.

## First proof, when it is time

Macula Greek as the first plugin, read-only: `places` (the caret's verse → its clauses), `search` (the faceted UI over `dimensions`/`facets`, results as cards), no `edit`. It exercises everything but editing with a resource that already has the right shape. Then TN read-only, then TN editable — the first non-USFM writable unit, and the test of whether the Book machinery really is about text rather than about USFM.
