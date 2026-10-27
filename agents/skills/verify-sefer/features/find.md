# Find

A person searches their project's text, or the Translation Notes held for
it. Each result shows in place with its verse, so it can be read and edited
where it is.

## Sub-features

- `search` a query over the project, results counted.
- `helps` the switch to search the notes instead; each matching note shows beside the verse it is about.

## How to get to it (user POV)

- The sidebar's Find, or `/project/<slug>/find`.
- `?q=<text>` fills the query; `?scope=helps` searches the notes.

## Driving it with agent-browser

Preconditions:

- A `verify:launch` instance and `--session verify`. The fixture is enough
  for `search`; `helps` needs notes downloaded
  ([Translation Notes](./translation-notes.md)).

- **Search.** From the fixture's book, move inside the app to
  `/project/small-nt/find?q=Blessed&fixture=1`. The element with
  `[data-count]` reads a number above `0`.
- **Notes.** With notes held, go to `?q=believe&scope=helps`.
  `[data-tour=find-helps]` is on and `[data-count]` is above `0`.
- **Proof.** Screenshot the results and record `data-count`. `errors()` is `[]`.

## Gotchas

- `[data-count]` is `0` while a search runs; wait for it to settle.
- Typing in the query box searches as you go; the URL may lag the box.

Last walked end to end: the `helps` path by the Translation Notes tour,
before 2026-10-26. Not walked with this file yet.
