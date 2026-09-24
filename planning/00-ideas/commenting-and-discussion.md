# Commenting and discussion attached to scripture

**Status:** working idea, 2026-09-19. This records the discussion and the decisions still needed. It does not authorize implementation.

## Job

A translator or reviewer can discuss a passage, a proposed change, or a recorded version without adding markers to canonical USFM. The conversation remains findable when text changes, moves, or disappears. A public repository does not expose private working discussion merely because someone cloned it.

The useful part of Upwelling is a discussion alongside a reviewable unit of work. The useful part of Delta is a durable connection between a change and its rationale. Sefer already has explicit versions and a verse-oriented Review; neither reference requires adopting a CRDT or recording every keystroke as shared history.

## Working model

Three targets have different survival rules:

| Thread target    | Created from                            | What stays stable                                                               |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| Passage          | A selection or verse in an open Book    | The thread ID and its original quote; its current highlight may move or detach. |
| Review change    | A decision unit between two exact texts | The two compared versions and the review question, even after Apply.            |
| Recorded version | The explicit Record a version action    | The recorded version and rationale, even after later revisions.                 |

A thread has an independent ID and history. Its anchor is a versioned claim about a location, not its identity. Deleting the selected text must not delete the discussion. Resolving a thread is an explicit action.

### Passage anchors

At creation, retain the project and book identity, text identity (the source hash plus length, and a version ID when available), canonical USFM source range(s), the typed semantic address or address list obtained by inverse lookup from the selection, selected reading quote, and limited surrounding context. The semantic reference itself is checksum-free; an attached location records the text it describes. Store which coordinate space each range uses; Sefer's source and CodeMirror offsets are UTF-16. A displayed selection that crosses discontinuous retained source spans must keep its pieces or become a coarser verse anchor. Never silently use their enclosing source range.

While the Book is open, accepted `Book.apply` changes transform the live anchor through the same before-text changes the editor publishes. Define boundary affinity so insertion immediately beside a selection does not unpredictably join it. Edits inside a selection may change the quote but retain the thread. A full deletion detaches the live highlight while preserving the original quote and address.

Across a reload or incoming version, lazily resolve against an exact, stamped analysis: map unchanged source spans through the version comparison where possible, then use the structural address and quote/context to verify a candidate. Retain the original location and derive a current location rather than overwriting history. A whole-book hash changing does not by itself mean the anchor is lost; an unrelated chapter may have changed. A possible chapter or quoted-span fingerprint is an optimization to investigate, not proof that an old absolute offset is still valid. Auto-reattach only with one convincing candidate. A repeated phrase, verse split, renumber, major rewrite, or absent text yields `needs reattachment`, not a guessed highlight. Manual reattachment is itself recorded. Review-change and version threads retain their historical target even if no current-text position exists.

The UI should distinguish `attached`, `changed`, and `needs reattachment` from a thread's separate `open`/`resolved` state. It should show the original quote and the version it described when the current highlight is uncertain.

### Mapping an anchor through edits

Outlined 2026-09-24 with Will; agreed in principle, not designed in detail. Today's ranges (findings, Find hits) are recomputed from a fresh parse every time and never mapped. An anchor cannot be recomputed from the text, so it has to map. Three tiers, cheapest first:

1. **While the Book is open:** map the live range through each accepted `ChangeSet` as the Book publishes it, the way `src/editor/recipes/flash.ts` maps its decoration (`held.map(tr.changes)`). Exclusive affinity: `from` maps with `assoc = 1`, `to` with `assoc = -1`, so an insertion right beside the selection does not join it and one inside it does. If the mapped range collapses (`from >= to`) the text was deleted: the live highlight detaches, and the original location, quote and address remain. Edits inside only change the current quote.
2. **Later, the Fingerprint matches:** the stored offsets are exact. Done.
3. **Later, the Fingerprint differs:** if the text the anchor described can be recovered (it was a recorded version), map through the sid-aligned diff between that text and the current one. Otherwise resolve the anchor's address in the current text and search that passage for the quote, using the context to break ties. Exactly one convincing candidate reattaches; none, or more than one, is `needs reattachment`. Never guess.

Record which tier produced the current location (`mapped`, `re-resolved`, `needs reattachment`), and keep the original immutable. U23003, the USFM committee's reference proposal, reaches the same conclusion about word-indexed references: they break under edits, and falling back to the verse is the best available case. The vocabulary (Address, Location, Anchor, Fingerprint) is in the primitives plan.

The [primitive consistency discussion](../01-discussing/editor-primitives-consistency.md) owns the proposed reference-to-location resolver that this feature would consume; commenting should not invent a second resolver.

## Identity, visibility, and sharing

Use Forgejo as identity provider. The Sefer discussion service stores conversations outside the Git repository. A repository URL is a useful way to discover a project, but an accepted Forgejo instance plus repository ID should identify it in the service; URLs and owner/name paths may change. Decide explicitly how forks, mirrors, and imported copies relate.

The proposed first visibility vocabulary is `private to me` and `shared with collaborators on this project`. An invitation is scoped to one project: Alice invites Bob, Bob accepts, and the relationship then permits each to see the other's **shared** project threads. Neither gets access before acceptance. This is pairwise, not transitive through another collaborator. The invitation must state whether previously shared threads become visible; the working preference is yes, with explicit wording. Private threads stay private.

The service checks membership on every read and write. Searching for a user is discovery, not authorization; bind accepted relationships to Forgejo's stable server-side user ID rather than display name or email. Whether a thread created by Alice can later be shared with a group, and what happens when Bob replies to it, need a clear audience rule before group collaboration is built. A reply must not widen its parent thread's audience.

No client-side public-key encryption is proposed for the first version. The service and controlled administrators can read and migrate the content; Forgejo identity and service authorization define access. D1 encrypts stored data, but that is not end-to-end secrecy. Admin access should be separate and audited. Revoking a relationship stops future service access, not copies a collaborator already read.

## Data and offline writes

Start with one D1 database, partitioned by `project_id`, rather than a database per project. Candidate records are `projects`, `users`, `invitations`/`relationships`, `threads`, `messages`, and `thread_events` for resolution or reattachment. This is a domain sketch, not a committed SQL schema. The service is the source of truth for shared threads; the local client keeps an outbox for offline work.

A message or event gets a client-generated unique ID. The client queues it, shows pending state, retries with the same ID, and marks it sent only after server acknowledgement. Two offline replies become two rows; they do not edit the same thread document. The service orders accepted events and applies explicit policy to competing state changes such as resolve versus reopen. Do not use a timestamp alone as causal identity.

Periodic exports to independent storage are needed if discussion history must survive beyond D1's bounded Time Travel window. R2 could hold these exports, but it need not be part of live thread reads or writes. Define recovery checks and retention before calling exports a backup.

## Comment authoring and links

Comments may be stored as Markdown and edited in a separate CodeMirror instance. This does not change USFM. A safe renderer is a separate concern from Markdown syntax support. Reference tagging is a distinct follow-on idea: use a strict prose matcher to recognize explicit or unambiguous scripture references, resolve them in a named project or reference resource, and offer click/focus navigation plus a preview. The existing forgiving whole-input `parseReference` is suited to navigation boxes, not prose scanning. A missing passage or ambiguous match must be visible.

## Decisions to make before implementation

1. Are threads created against unsaved working text visible to collaborators immediately, or only after a version is recorded? If immediately, another device may not have the text their anchor describes.
2. Does accepting an invitation expose all earlier `shared` threads, or only later ones? The invitation must say which.
3. Does a project relationship grant access to every shared thread, or can an individual thread have a narrower audience? Avoid both models at once initially.
4. What is the policy when a relationship is revoked, a Forgejo account is removed, or the repository is transferred or forked?
5. Which changes may be attached to a Review decision unit that is recomputed from two texts? The durable key must include the compared text identities and address, not a transient row index.

## First proof

Use one book and two offline clients. Create a passage thread, edit one character inside its selection, delete it, make the same phrase occur twice, and receive a conflicting revision. The thread must remain readable throughout and auto-highlight only when its location is defensible. Then submit concurrent replies and retry one submission after a lost acknowledgement; each reply should appear once, with the correct audience.

## Current-tree seams

- `src/core/book/book.ts` and `src/editor/book.ts`: accepted changes and canonical publication.
- `src/core/galley/analysis.ts`: source identity and freshness.
- `src/core/galley/diff.ts` and `documentation/architecture/review.md`: versioned review units.
- `src/core/reference/reference.ts`, `src/core/excerpts/excerpts.ts`: reference parsing and current reference-to-span mapping.
- `documentation/architecture/git.md` and `documentation/architecture/sync.md`: explicit versions and transfer policy.
