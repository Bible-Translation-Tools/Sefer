# Test drive: the Git lifecycle branch

A plain-English eyeball pass over everything on `git-lifecycle`, for Will. About an hour for the Web, plus the desktop part. Each check says what to do and what you should see; anything else is a finding.

**Only ever against the sandbox:** `https://content.bibletranslationtools.org/Will_Kelly/x-en-ulb`. Every profile below already has it cloned. Never send from a project cloned from `WycliffeAssociates/en_ulb`.

## Setup

**Host.** The dev server for this worktree, `http://localhost:3002`. If it is not running:

```sh
cd .claude/worktrees/git-lifecycle && pnpm dev --port 3002 --strictPort
```

**Windows.** Three Chromium profiles, each a separate "device" with its own browser storage and its own copy of the sandbox. Open each in its own visible window from the worktree (each command stays running while the window is open):

```sh
node .verify/lifecycle/window.mjs A   # left half: device A, signed in as Will_Kelly
node .verify/lifecycle/window.mjs B   # right half: device B, same account
node .verify/lifecycle/window.mjs C   # middle: a clone with only its newest version
```

Use A and B side by side for most of this. In each, press **Open Project** on the projects list; the project opens on Psalms. `/cloud` is the cloud icon in the app bar (or go to `/project/x-en-ulb/cloud`).

**What state they are in.** A and B should both read **attached-clean** on `/cloud` (up to date). If either says **behind**, press its button and receive first. If one says **diverged**, that is leftover from my runs: settle it through check 5.

## 1. Check on open, and send on save (A)

1. In A, open Matthew, type a word at the end of a verse.
2. Save & Review (the save key, or the kebab) → **Record a version…** → confirm.

You should see "Recorded 1 book(s) as …", and within a few seconds `/cloud` reads **attached-clean** again: the version was sent without you pressing anything (Send my changes on save is on by default).

3. In B, reload and press **Open Project**. Within a second or two of the project opening, `/cloud` should read **behind** — the check on open found A's version without you asking.

## 2. Receive into an open book (B)

1. In B, have Matthew open in the editor.
2. On `/cloud`, read the "What would arrive" card (it should name Matthew and the chapter), press the button, then confirm.

You should see A's word appear in the open Matthew without reopening it, **0 book(s) differ** on Review (nothing reads as unsaved), and `/cloud` back to **attached-clean**.

## 3. Different books on both sides: Combine (A and B)

1. A: change Mark and record. (It sends.)
2. B: change Luke and record. The send is refused, and `/cloud` should say **diverged**, with words saying your work was saved and only the sending did not happen.
3. B: press **Combine**. The dialog names Luke as staying and Mark as arriving. Confirm.

You should see "Combined", Mark has A's change in B's editor, and A then receives one version. On the server (or in History) that version has **two parents**: nothing was squashed or rebased.

## 4. The same book on both sides: Review (A and B)

This is the one the review caught. Use a book you have not touched this session, say John.

1. A: in John, change verse 1:1, and add something at the very end of the book. Then change one verse in Acts. Record (it sends).
2. B: in John, change the SAME verse 1:1 differently, and one other verse A did not touch. Record (refused → diverged).
3. B: `/cloud` → **Compare** (it opens Review against the shared project).

You should see:

- each card labelled **Changed there**, **Changed here** or **Changed in both places**;
- the "there" cards already showing **Taken from the shared project** pressed, and the "here" cards **Keep the editor's** pressed: those are the presets;
- **Record a version…** opens a dialog that says "1 passage(s) changed in both places still need a choice", and its Record button is disabled.

4. **Cancel** the dialog, then press **Record a version…** again. It must open again. (It used to open and shut in the same click.)
5. On the John 1:1 card ("both places"), choose **Keep the editor's**. On the Acts card ("there"), press **Taken from the shared project — put back**: it should switch to **Keep the editor's** (you are refusing their change).
6. Record. The message box can stay empty.

You should see "Combined with the shared project", and the version is named "Combined John, Acts with the shared project". Then in A, receive, and check by eye:

| Where                 | Should hold                   |
| --------------------- | ----------------------------- |
| John 1:1              | B's wording (B kept theirs)   |
| John, end of book     | A's addition (preset: theirs) |
| John, B's other verse | B's change                    |
| Acts                  | NOT A's change (B refused it) |

## 5. Offline, and coming back

1. In B, open DevTools (Cmd-Opt-I) → Network → **Offline**.
2. Change a verse, record.

You should see the version recorded, and the words say it was saved but not sent; `/cloud` reads **offline**, calmly, saying your work is safe.

3. Turn Offline off. Change something else and record. It should send without you pressing Retry anywhere. (One network failure used to switch sending off until you did.)

## 6. History with only the newest version (C)

C was cloned with the newest version only (the default now on every host). Once you have done this check C is whole; to run it again, close C's window and recreate it with `node .verify/lifecycle/freshC.mjs` (a fresh profile, your sign-in copied from A, a new clone).

1. In C, **Open Project**, then go to History (`/project/x-en-ulb/history`).

You should see a card saying only recent history is on this device, briefly "Bringing the older history to this device…", and then the list grows by about ten versions. The card stays, offering **Load 10 more** and **Load all**.

2. Press **Load 10 more**: the list grows again. Press **Load all**: the card goes away and the list is the sandbox's whole history.

3. Open a book's earlier version from the list: its text shows.

## 7. History on a real, long history (optional)

The sandbox is only ~40 commits, so it cannot show the bug this fixed. If you want to see it: in any profile, import `WycliffeAssociates/en_ulb` by URL (read only, never send from it), open History, and pick Genesis. You should see all its versions (native git counts 156) where it used to fail. First open builds an index (a few seconds); the second is instant. Delete that project afterwards.

## 8. The settings card

On `/cloud`, the **Sync settings** card has four switches. Turn off **Send my changes on save** in A, record something: it should NOT send (`/cloud` says ahead). Turn on **Skip review of my changes**: the save key should record straight away without opening Review. Put both back.

## 9. Rename stays on this device

In A, rename the project from the projects list. B still shows the old name after receiving: a name is a device's choice, and `metadata.json` is untouched.

## 10. Desktop (`pnpm dev:tauri` in the worktree)

Desktop has compiled through all of this but has never been run. Its own window, signed in through Settings as Will_Kelly.

1. Import the sandbox by URL. It should open quickly on the newest version, and the window should stay responsive while it clones (scroll, click about).
2. Within a minute, History should show the whole history without you pressing anything: desktop fills it in behind the clone, 200 commits at a time.
3. Run checks 1–4 between the desktop app and window A. While a send or receive is running, the window must not freeze.
4. Open two desktop windows on the same project and record in one while the other receives: nothing should break, and one should wait for the other.

## Not testable yet

- **Suggested changes** (your own copy, suggesting, bringing a suggestion in) need a second Gitea account that cannot write to the sandbox.
- **A burrito project combining** (the `metadata.json` checksum fix): the sandbox is a Resource Container, so it has no `metadata.json`. Needs a burrito repository on your account.
- **Two browser tabs on one project** (Web Locks): open the same profile's project in two tabs, record in one while the other receives; one should wait.

## When you are done

Close the windows. The dev server and the three profiles (which hold a copy of your sign-in) can be deleted: `rm -rf .verify/lifecycle/profile*`, and stop the server on 3002.
