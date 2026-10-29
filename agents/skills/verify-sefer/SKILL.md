---
name: verify-sefer
description: Drive the real Sefer app (Web through agent-browser, desktop through WebDriver) the way a person does, and prove a feature works with evidence. Use before claiming a UI change works, when asked to "try it", "check it in the app", or to verify a feature; the feature map in features/ says how to reach and drive each one.
---

# Verify Sefer

How to launch, check, drive and clean up is already written down in
[agent verification](../../../documentation/agents/verification.md). This skill
doesn't repeat it. It gives the order of a run and the **feature map**: one
file per user-facing feature in [features/](features/README.md), saying how a
person reaches it, how to drive it, and what proves it worked.

## A run

1. **Pick the feature** in [features/README.md](features/README.md) and read
   its file. If the feature isn't there, drive it anyway, then add a file
   for it (below).
2. **Launch your own instance.** Never drive someone's running `pnpm dev`
   (usually port 3000): it is their browser storage and their session.
   - Web: `pnpm verify:launch`, in the background. Its JSON line can sit in a
     pipe buffer; the URL is also in `.verify/<runId>/server.log`
     (`http://localhost:<port>`). The run directory is the newest in `.verify/`.
   - Desktop: `pnpm verify:desktop` ([verification](../../../documentation/agents/verification.md),
     "Driving the desktop app"). The first build is about 8 minutes.
3. **Doctor before driving.** Use a named agent-browser session so it can't
   touch another one: `agent-browser --session verify open "<url>/projects?fixture=1"`,
   then `agent-browser --session verify eval 'JSON.stringify(globalThis.__sefer.observability.errors())'`.
   `[]` and a "small-nt" card on the page means the instance is healthy.
4. **Drive the person's path**: clicks, keys, typing. Fixture setup may
   set preconditions; internal setters must not stand in for the action.
5. **Prove it.** Capture the action and the state after it, and the side
   effect a person would rely on: a saved version in History, a project in
   the list, a file on disk on desktop. A success toast alone proves nothing.
   Screenshots go in `$PWD/.verify/<runId>/` as **absolute paths**:
   agent-browser resolves relative paths from its own directory, not yours.
6. **Read the app's own record**: `__sefer.observability.errors()` should
   still be `[]`, and `traces.recent()` names what ran. Don't add logging.
7. **Clean up what you started, and only that**:
   `agent-browser --session verify close`, then stop the `verify:launch` task
   you started (or SIGTERM its pid). Never `pkill` by name. Leave
   `.verify/<runId>/`; it is the evidence.

## Driving conventions (Web)

- **The fixture** (`?fixture=1`) is `fixtures/small-nt`, in memory: Psalms
  and three NT books. It resets on every **reload**, so move inside the app
  after it loads (clicks, keys, or
  `history.pushState({}, "", "<path>?fixture=1"); dispatchEvent(new PopStateEvent("popstate"))`),
  and keep `?fixture=1` on every path.
- **Real projects** need the network: a share link
  (`/r/<owner>/<repo>/book/<BOOK>?host=content.bibletranslationtools.org`) downloads
  one into the session's own browser storage. A fresh agent-browser session
  starts with nothing on it.
- **Stable handles first**: `data-testid`, `data-tour`, `data-review-*`, ARIA
  names (`agent-browser --session verify snapshot -i` lists them with refs).
  The tours in `src/app/tour/tours/` use the same handles. When a tour's step
  and this map disagree, one of them is stale: check the app and fix both.
- **Placing a caret** in the editor needs a real mouse event at a point,
  not `.click()`. Measure the point with a DOM `Range`, then
  `mouse move <x> <y>`, `mouse down`, `mouse up` (recipe in
  [edit and save](features/edit-and-save.md)).
- **Hidden pages paint nothing.** agent-browser's page gets no
  `requestAnimationFrame` until a screenshot renders a frame. Popovers and
  lists that wait on a frame look missing. Take a screenshot before deciding
  something is absent.

## Keeping the map true

- A feature file is a user's path, not the code: entry points, handles,
  preconditions, commands, and what proves it. Implementation belongs in
  `documentation/architecture/`.
- Each file says when it was last walked end to end, and what wasn't. Don't
  call a path verified because a different path to the same feature was.
- When a change moves or renames a handle a file uses, fix the file in the
  same change. When a run finds a trap, add it to that file's Gotchas.
