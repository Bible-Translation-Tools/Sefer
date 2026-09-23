# Diff and sync: what happens today, what should happen

**Status:** 2026-09-23. Discussion, not a plan yet. This is the next core piece of work **after the primitives settle**: it underpins Review, History, incoming cloud changes and any folder or zip comparison, so it ranks above more features.

Sources: Will's voice note (transcript in the appendix), and a read of the current code.

---

## 1. How it works today

The comparison is built around one interface, `CompareSource` (`src/core/compare/source.ts`). Each side implements `books()` and `read(bookId)`. `src/app/ui/review/sources.ts` already says a git remote or checkpoint would be one more implementation.

| Side                                     | What it answers                                                              | Has a revision stamp? |
| ---------------------------------------- | ---------------------------------------------------------------------------- | --------------------- |
| In the editor (`currentProjectSource`)   | the live text of every open book                                             | yes                   |
| On disk (`savedSource`)                  | Save's baseline for each book, or its current text if nothing has touched it | yes                   |
| Last recorded version (`recordedSource`) | the files at the last recorded version                                       | yes                   |
| Folder or zip (`folderSource`)           | files read once when picked                                                  | no                    |

What a comparison does, step by step:

1. **Every book on both sides is read and line-diffed.** `compareBooks` runs the JavaScript line diff (`core/diff`, LCS over lines with the common prefix and suffix trimmed) on every book both sides hold, even untouched ones, just to decide `identical` and count hunks. Nothing is skipped by dirty state, although every text carries a `SourceStamp`, and the glossary says equal stamps mean equal text. Untouched books are cheap because the diff trims matching lines first, but the cost still grows with the whole project.
2. **It all happens again on every edit.** While either side is live, any edit in any book re-runs the full comparison of every book. Bursts of typing collapse into one pass after they finish.
3. **Changed books get the engine's diff.** Only books that differ go through `galley.diff`, the engine's verse-aligned decision units, over the whole book. Since `f10c5db` that is once per comparison, not once per render. Apply builds each decided book's text with `galley.merge`.
4. **There is nothing at chapter level in Review.** The only chapter logic is in `src/core/sync/plan.ts`, for incoming git. It splits a book's text on `\c` lines (a regex) and reports which chapters changed on the cloud, which changed here, and which books both sides touched. It's separate code that nothing else shares.

**Two diff mechanisms exist side by side.** The line diff decides "identical?" and the book counts in Review. It also drives History's change list and per-hunk Revert (`src/app/ui/panels/changes.ts`, `DiffView`). The engine's verse-aligned units drive what Review actually shows and writes. That sits awkwardly with the "verse-aligned diff only" rule, and it matters once this becomes shared machinery.

**Incoming sync is already closer to right.** `sync/plan.ts` is built from `Git.changedPathsBetween` and `Git.show`: it works from changed paths and reads only those blobs. Review's `compareBooks` is the part that reads everything.

---

## 2. The model Will described

**Goals.** The Review screen and its wording should make sense to non-developers. Build it from shared primitives. Keep the advantages of text and git underneath. No regex: scripture-kitchen, hashing and the table of contents decide what to diff, reusable for any USFM file. (Aside: the old app looked slow on an older machine, and memory climbed to about 1.1 GB, which suggests a leak.)

1. **Cheapest possible "are we up to date?"** Compare my latest commit id with the remote's.
2. **Pull only what changed.** If you changed Matthew and I changed Mark, that's two books to pull and diff, not 66. Ideally all we need is file path plus blob id. A full clone is only the fallback.
3. **Diff whole files, probably.** The network is the slow part, not the diff, so measure it. Wary of chapter-by-chapter diffing: added or deleted chapters would make the decision units strange.
4. **Granularity.** The engine's aligned decision units (in git terms, hunks). Inside each unit, a word-level diff by default, character-level optional, as a global preference. For each unit, know whether the change is whitespace only or markup only, and be able to flip it to USFM.
5. **A "change metadata" layer.** Classify every change by book, chapter and verse, and count changes per scope. Keep _conflict_ (both sides changed the same scope) separate from _information_ (something changed). Conflict can apply at project, book, chapter or verse level.
6. **Policy stays separate from data.** The default is cautious: every change gets looked at. Other policies stay possible, such as "accept changes to books that don't overlap" (you work on Matthew, I work on Mark), even though git would fast-forward those anyway. Verse-level policy is possible in principle, though probably nobody should use it.
7. **Messages people understand.** "Ana changed 12 verses in Mark and Luke on Tuesday." "Your last save made N changes in N books." Always read the metadata file, for localized book names.
8. **Anything that isn't USFM.**
   - The Burrito MD5 checksums can be regenerated from the accepted state, so they're tied to a commit and not a worry.
   - Hand-edited metadata (if the app ever edits it), added or deleted books, and binary files have no clear answer yet.
   - Where is the edge of the app, so it doesn't become a diff-everything viewer?

---

## 3. Feedback

### Pulling only what changed mostly comes free with git

A `fetch` after the first clone negotiates with the server and transfers only objects you don't have: the new Matthew blob, plus trees and commits, never 66 books. Then:

- Comparing tree ids between your HEAD and the remote ref gives the changed paths with their blob ids, with no checkout.
- The `Git` port already has `changedPathsBetween` and `show`, and `sync/plan.ts` builds the incoming plan from exactly that.
- So "path plus blob id, then read only those blobs" is already how incoming sync works.

For "are we up to date?", isomorphic-git's `getRemoteInfo` returns the remote's refs without fetching. Gitea's compare API can list changed files before any fetch, if a preview before downloading is wanted. **Worth measuring:** fetch cost through the Web proxy.

### Use git blob ids as the one identity for a file, on every side

A blob id is SHA-1 over the file's bytes, and isomorphic-git's `hashBlob` computes it locally. So a folder, a zip or the editor's text can be hashed into the same id space as a remote tree. "Did this book change?" becomes an id comparison on any pair of sides, without downloading the other side's copy.

- That's the cheap first stage the model wants, and it's reusable for any USFM file.
- xxh3 from scripture-kitchen is faster, but its ids can't be compared against a git tree. Keep it for finer checksums inside a file, if those are ever needed.
- **Caveat:** git hashes the bytes on disk, and our text is LF-normalized. Hash the bytes as they would be written, with the book's own line endings and BOM (`encode(source)`).
- For the live editor side, the `SourceStamp` already answers "same as the baseline?" without hashing anything.

### Diff whole files, then classify chapters afterwards

Will's instinct is right, and chapter-level information still comes out of it. The engine's decision units are addressed by verse ids, so after a whole-book diff, every unit already knows its book, chapter and verse.

- The change metadata falls out of the diff output with no regex and no slicing.
- Added or deleted chapters stay correct, because the engine aligned them.
- Slicing before diffing is where moved or merged verses and new chapters go wrong.
- If whole-book diffs ever measure slow, the fix is a scope option on the engine's diff door (as the overlay door has), not our own slicing.

### Change metadata: a sketch

Per pair of book texts (two-way):

- which books, chapters and verses are touched;
- per unit, whether the change is text, markup or whitespace only (see the engine questions below);
- counts per scope.

For a three-way comparison (common base, mine, theirs), per scope: changed here, changed there, or changed on both sides (the conflict).

**Policy** is then a plain function from that metadata to "needs review" or "can pass":

- the cautious default: review anything that changed, at any scope;
- "review only books both sides changed" is one alternative;
- git's fast-forward is just one policy among several.

Because the data never decides on its own, a team or a fork can change the policy without touching the machinery.

### The edge for non-USFM files: three tiers, never merged automatically

| Tier | What                                                            | How it's handled                                                                                                                                                                                                                                                                   |
| ---- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | USFM books                                                      | Everything above.                                                                                                                                                                                                                                                                  |
| 2    | Metadata the app understands (`metadata.json`, `manifest.yaml`) | Derived fields (ingredient MD5s, book lists) are regenerated from the accepted books, never merged. For hand-edited fields both sides changed, decode through the schemas we already have (`core/resources`) and show "project details changed on both sides", pick one per field. |
| 3    | Everything else                                                 | Known text types: an "advanced" pick-one-side screen with a plain text diff. Binary: pick one side, no diff.                                                                                                                                                                       |

That keeps the app a scripture tool with a documented escape hatch. **Added and deleted books** are already handled: the comparison marks a book as present on one side only. **Renames don't matter**, because books are identified by their `\id` line (`identifyBook`), not their path.

### Messages

Commit author and time plus the change metadata gives "Ana changed 12 verses in Mark and Luke". A zip or folder gets the same sentence without the name. Book names come from the metadata file (one small blob, always read). This is a good reason for the classification to be one shared primitive, used by History, Review and Cloud alike.

---

## 4. A possible shape

Every comparison goes through the same stages, whatever the two sides are:

1. **Identity.** Each side lists its files with a content id: git blob ids from a tree, `hashBlob` over a folder's or zip's bytes, the `SourceStamp` for the live editor against its baseline.
2. **Which files differ.** An id comparison, with no reads. Present on one side only means an added or removed book.
3. **Read only those.** For git: `show` the changed blobs, after a fetch that moved only new objects.
4. **Diff each changed book whole,** with the engine (`galley.diff`), giving decision units.
5. **Classify** the units into change metadata (book, chapter, verse, text/markup/whitespace), two-way or three-way.
6. **Policy** decides what needs a person's eyes. The default is everything.
7. **Present** the result in plain words ("Ana changed…"), with per-unit word or character detail and a USFM toggle.

What that replaces:

- `compareBooks` reading and line-diffing every book (stages 1–3);
- the line diff in History and Review (stage 4, the engine everywhere);
- `sync/plan.ts`'s `\c` regex (stage 5, verse ids from the units).

---

## 5. Open questions

**For the engine (Galley maintainer):**

1. Can `galley.diff` or its units report "whitespace only" and "markup only" per unit?
2. Is word versus character granularity exposed through the adapter, or only in onion?
3. Would a scope option on the diff door (chapter, sid range) be possible, if whole-book diffs ever measure slow?
4. Re-running an Overlay adds a blank line inside a `\q1` block it inserted (not idempotent). Found 2026-09-23; see `documentation/lint-results.md`.

**To measure:**

- a whole-book engine diff on the largest books (Psalms, Isaiah), on a slow machine;
- fetch plus tree comparison through the Web proxy, against a remote where one book changed;
- `hashBlob` over a 66-book project in the browser.

**For Will:**

- **History's per-hunk Revert** is built on the line diff. Does it move to engine units too, or does History stay a plain text view?
- **Tier 2 metadata editing:** is "pick one per field" enough, given the app doesn't edit metadata today?
- **Scope of the policy knob:** is "accept books only the other side changed" ever the default for a team, or only an opt-in?

---

## Appendix: transcript

Transcribed with `chough` from `~/Downloads/diff.m4a`, unedited apart from line wrapping. Machine transcription: "cephyr" is Sefer, "Loklaw" is localized, "XXX3" is xxh3, "Ummatically" is presumably "automatically".

<details>
<summary>Full transcript (~2,300 words)</summary>

Um so one thing that I'm gonna need to fix compared to the old version that can feel flat. Uh is
not only do I have to fix the diff surface to be as non-developer friendly and yet leverage all the
advantages of text-based diff and collaboration through something like Git. Um I need a so there's
a bunch of miscellaneous things. One, the verbiage needs to be as non-developer friendly as
possible. Two the UI needs to be as non-developer friendly as possible. Three we want to use as
many primitives as possible. Four we want to um So the current I saw someone working the current
app and I was wondering if it was bug, I was wondering if it was slow or not so these bugs but
they're on a much older machine and I was like oh great e one I think theirs has a memory leak the
old cephyr because I saw memory climb to like 1.1 gigabytes which I'm just embarrassed of but it
happens. Two um I don't know if we're doing Git operations as efficiently as possible. Obviously
isomorphic Git gives us uh some limitations. So so here so here's the top to bottom of the
problems. Um one, conceptually we want the cheapest are we up to date? And I think that's just a
what's my latest shaw, what's that latest shaw for a remote. Alright, so that check should be
relatively cheap, I would think. If that is not the same, um I'm not sure if check out or clone is
actually what we should do or not. Because let's say somebody only changed um the book of Matthew
and I changed the book of Mark. That's two books that should dip. Not 66. So we shouldn't check out 66. So if there's a call in isomorphic Git, or we need to instrument it manually over like Git
APIs, the Git API, for J API, GitHub API, some API to traverse the blob directory specifically to a
file, then really you would only want to see the diff of those things. And then the next layer of
performance optimization is if that's not possible, then we have to just do a full checkout, like a
full clone to compare, that's one thing. I would love just file path and blob ID though. Which I
have a comment I'm gonna come back to there, so asterisk. The second thing is that so okay, you
change math, you got to mark we need to pull both those files we need diff both those files um even
then we have the ability to really cheaply take chexoms to feed into diff. We'll expose XXX3 in the
scripture kitchen, I think. And maybe it's not worth it and full file def should just be done. So
that context is available as a decision unit. I'm not sure. Or if we only want to feed in changed
chapters. So if you made changes only in chapter four, you know, should we really feed in the whole
file? I'm kinda tempted to think we should stick to full file diff because I think it's performant
enough to do it if we can only pull files. I feel like it's the network that's slow and it's um
it's network that's slow, like oh I've changed something in English UB. Now I have to pull all uh
five megabytes instead of only changed books. Or change blobs, we'll say, to be a little more get
get accurate. And then two, uh I don't know that it once the data is in process it full file death
is too slow. We should probably be measure just to see. My concern would be is if you try to do
chapter to chapter. Um I don't think we would be at risk. Uh because essentially you would want to
take the maximal set. So let's just say theoretically someone like a chapter. So those checksums
are gonna come off uh amiss. And the decision units are gonna be really weird because of that. But
I think So that's that's a maybe. Maybe, maybe not needed, I'm not sure, to only feed in a changed
chapter. We have to think about what that means if you add a chapter and delete a chapter. Um next
is what we'll call um so there's there's those two performance levels should matter a lot. And then
each decision unit so there should be a global granularity preference, which is probably per
decision unit we get a div, which is just like tiled the file as a mosaic. And once the file is
tiled, it does sell in those aligned units. And then inside of those aligned units, which for us is
what we call in Git terminol a hunk. So inside those aligned units or a decision unit, there's uh
the library in Scripture Kitchen, an onion takes an argument to be per word or characters. That's
probably should be a global preference in ours that defaults to per word. And then optionally down
to the per character unit. We should have done enough work to for any given tile or decision unit
you could flip to USFM or not, and you know if the change is only with respect to white spacing, um
or if it's only a USFM change. So. Next is um messaging. Um I need to think about oh, so this is
the other part that really needs some brain power of to do because I didn't fulfill this in the
previous product. And I really feel like I need to. Which is that the scripture burrito spec wants
MD5 hashes. If you're not gonna use a web-based web subtle crypto while they went with MD5, I don't
know, but MD5 hashes, um those are regenerable based upon the final accepted state. So those are
ephemerable tied to a commit point. So I'm not terribly worried about that. What I genuinely don't
know what to do about is we can say our app only cares about USFM, right? But that doesn't deny the
fact that one if we allow editing metadata in the manifest or in the metadata file for Burrito.
Ummatically generated, we don't have a way to resolve conflicts there. Now we don't allow that
today, but let's say this becomes a drafting tool and you want to delete a book or add a book or
something of that nature. I don't know what to do because I'm a little hesitant about creating a
You could say if that happens you have gone outside of our application and that's just that and
like we can't handle it if you've gone outside of our application. I'm also a little wary on Um a
little bit wary on building general purpose differs for like metadata files. I'm not sure. We could
say you throw uh information or an error that tech could handle and then because it's text, for
text like files you could say well this is an advanced debuggenario where somehow you've both
edited a text file that belongs to another repo. Here is the date on both. And someone who can just
understand a classic diff, just a regular text diff, has to pick one of the other. What that
doesn't handle is binary files, and I guess we could just say if it's not a known text extension
type, you just gotta go binary file. Um So I don't know if there's a way that we could just kinda
say, hey, this is not supposed to be Common Path. Our app only allows everything USFM. That's all
it ever presents you. If somehow you get a file changed on disk, then here's what we do. Um that's
one part that I want a little bit of advice on. And then the performance question. Um verbiage. I
said this about verbiage, but ideally because of our algorithms that we have, we know blob that
changed, and we need to potentially account for added blob, move blob, or rename blob, delete a
blob from the blobs directory. If we can do that instead of a full checkout. And then ideally I
would actually love to say maybe we check out the metadata file always. So always the manifest or
metadata.json. Reason being for using Loklaw's book names potentially um and then our messaging can
become committer made number changes in a list of books at time. Because that really clear, like
someone made these changes at this time. You last your last save made X changes and Xbooks and X
Time. Like that really user friendly information bubbling up and you're comparing two different
versions would help. Now obviously that's even doable for a zip in a folder, maybe not with the
committer information. But like we can basically classify every change within scripture as to a
book, to a chapter, down to a verse. So we can count changes in change points of how many are in
the same verse, how many are in the same chapter, and how many are in the same book. Right. And so
that kind of visibility is going to be we want the primitives to do that. So that when we pull or
check out blobs, between any two blobs which represent a USFM file, We want a layer or an effect
service or something in effect.pipe that pipes that comparison through with probably the type
should be call something like change metadata where given two changes um file and file for
scripture for us fm we classify and we may not end up showing all this but we classify uh things
and what that would allow potentially if it got asked for, we're talking about flexibility because
I don't know the full thing the product owner's gonna work or how people or teams might wanna work.
So we want to build for flexibility and the best development speed and the best development
products often lean into the constraints of your domain. And Scripture's greatest asset is the book
chapter versification. So then when you have that commit metadata as part of the pipeline, you can
do what the old editor did, but it should be really intentional that we do that. That we if someone
wants to say hey take all changes. Like it becomes policy. So our default cautious policy is eyes
on everything. But if someone needed it to dial it in or someone wanted to fork this and use it as
policy, it could become rebase changes from books that don't conflict. If you worked on Matthew and
I worked on Mark and that's how we knew we wanted to work and we didn't need eyes on that. We
didn't want to provide the friction of an additional review screen to say well you're not on the
same commit. Like that information should be there. And then I don't think anyone likely should
ever do it down to the first level, but theoretically we could, right? Cause um as a result of
diffing book and book, you could just say well here's only the conflicting verses like you could do
it even down to the method of conflict which conflict is your current version working or disc or
otherwise and the version coming in have changed the same part of table content, the same verse.
And that's conflict only. Um versus, you know, informational. Right? And so the informational ideas
like we're gonna surface everything to you. Uh and it's probably worth doing that. So informational
is I guess it's really two a two part enum right now and it's con conflict, which is I have
something different, you have something different for a scope. I e a book or chapter or verse.
That's conflict. And you could say conflict applies at any level. Conflict applies at book,
conflict applies at chapter, conflict applies at verse. And so we could say if you change the file
and I change the file, that's conflict at the book level. Um actually that's not true. We can say
conflict applies all the way at the project level. So for the project, if any file has changed at
all, um then eyes have to be put on it. Right, and that would be the most cautious espousal of this
view. And then a step down is to say if uh any but right but but but I guess what I'm trying to say
in terms of change metadata that I was talking about is conflict is not the same thing as um
information. And that's kind of a get thing and not just an informational thing, only in terms of
like Git would happily accept a fast forward. You change Mark, I change Matthew, no conflict. Um so
just because there's no conflict and you can fast forward, we have a different policy for handling
scripture. Um that needs to be piped piped through. So that metadata of what's changed, um we do
want to retain what I'm trying to say is there is some point in retaining the information of like
not only has it changed, but you've each changed it independently. Right, and so that's conflict in
the truest sense. And also unlike Git, we can define conflict in a way that doesn't. So Git would
say any two files changing at all is conflict, but we could technically through policy say only
overlapping chapter edits are conflict. Right. So our default it just needs to be bubble up nearly
anything and everything. Um performance Pulling only what needs to be pulled, diffing what only
needs to be diff. What do we do for everything that's not USFM? Like what's the same boundary for
our app without trying to just become a diff everything viewer. And Yeah.

</details>
