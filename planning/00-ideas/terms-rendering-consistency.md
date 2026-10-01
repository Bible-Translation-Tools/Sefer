# Spiritual terms as a consistency check: one control, an expected rendering (2026-10-01, experiment)

Will's idea, filed to run as an experiment later.

What a translator is really doing on the Spiritual terms screen is checking
CONSISTENCY: wherever the source says A, does the target say B?

## The shape

One control, not a screen of its own:

- **Where:** the scope (the shared `BookScope`: This book, Whole project,
  OT, NT, Custom).
- **The term, in the source language:** A, typed or picked ("grace",
  "gracia", whatever the source is in).
- **The expected rendering in the target:** B.

The result is every verse in scope whose source has A, split into those
whose target has B and those that do not. The second list is the work.

## The automatic part: suggest B

Given the verses where the source has A, suggest B from the target text of
those verses: the letter sequence they share most. Longest common
subsequence of letters, not a word match, so prefixes and endings
(inflection, agglutination) do not hide the stem. To flesh out:

- LCS over which units: letters within words, or across a short window?
- Ranking: coverage (in how many of the verses it appears) against length.
- Noise: frequent short sequences that appear everywhere ("the", articles,
  common affixes) need a corpus baseline, much as Sous judges against the
  project's own habits.
- Where it runs: probably a kitchen door over the registered target and
  source (the pairing and verse alignment already exist there), with Sefer
  owning the control and the wording.

## Relation to today

The STET catalogue and guide fixture already map a term to its places; this
generalises that to any term the translator types, with B as the thing being
checked. The card list, scope and source pairing it would show are the ones
Find and Findings already share.

## Explicit first, LCS as a suggestion (2026-10-01)

Will's worry: LCS may not work, given affixes and noise. So:

- **Primary: explicit.** The translator says what B must contain — a stem
  ("grac"), or a short pattern where inflection splits it. Predictable,
  checkable by anyone, and Find's literal / whole-word / regex matching
  already does it.
- **Secondary: LCS pre-fills that box**, with its coverage shown ("in 41 of
  46 verses"). Low coverage says "type your own". A wrong suggestion costs
  one edit, never a wrong result — which is what makes it safe to try.

Lower priority than History.
