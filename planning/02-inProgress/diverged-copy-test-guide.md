# Testing a copy that has moved on, by hand

For Will, 2026-10-13. How to reproduce the "diverged own copy" case and check the fix yourself, on
desktop and on the Web, with no test harness. Background: [sync](../../documentation/architecture/sync.md),
"A copy that has moved on".

**The case.** You work in your own copy (a fork). Your copy's branch has a version this device does
not have: something you sent from another device, or an earlier offer the shared project never took.
You edit here and press Save. Before the fix, the send was refused with "the shared project has
changed", Compare compared with the wrong thing, and Offer failed. Now there is one next decision:
Review against your copy.

**The promise to check.** One decision, never a rebase. History only moves forward: nothing on the
server is force-pushed, reset or deleted, and your copy's old version stays in history.

## 1. What you need

- **A shared project** you cannot write to as the test account: the sandbox `Will_Kelly/x-en-ulb`.
- **A test account** that works in its own copy: `will-kelly-test`, whose fork is
  `will-kelly-test/x-en-ulb`.
- **A copy with a version the shared project never took.** Three ways to make one:
  1. **Two devices, one account.** On device A, open the project, choose "Work in my own copy", edit,
     Save (it sends to the copy). On device B, open the same project from the shared project (not the
     copy), choose "Work in my own copy", edit something else, Save. B is now the device that is behind
     its copy.
  2. **One device plus WACS's web editor.** Sign in to WACS as the test account, open
     `will-kelly-test/x-en-ulb`, edit a book file in the browser (pencil icon), commit to `master`. Then,
     on the device, edit and Save.
  3. **An old offer.** Offer from the copy, have the shared project's owner close the pull request
     without merging, then edit and Save.

  Check it on WACS: the fork's `master` should have a commit that `Will_Kelly/x-en-ulb`'s `master`
  does not (the fork's page says "This branch is N commits ahead").

## 2. The state I left it in

- `Will_Kelly/x-en-ulb` `master`: `69c132d Reconciled gen from firefox again`, unchanged.
- `will-kelly-test/x-en-ulb` `master`: `2590981`, my decision commit. Its history, newest first:

  ```
  2590981  Keep my text; the copy's older title change stays in history   (parents df1cbf0, f2c457e)
  df1cbf0  Round 3: a change sent while the copy holds older work
  7dfbbd9  Desktop send test (Jude 1:1)
  f2c457e  Test: a change sent to my own copy        (the old commit, still there)
  69c132d  Reconciled gen from firefox again          (the shared project's head)
  ```

- **Pull request #1 is open**: <https://content.bibletranslationtools.org/Will_Kelly/x-en-ulb/pulls/1>,
  "Changes suggested on October 13, 2026", from `will-kelly-test:master`. Its net change is one line
  of `66-JUD.usfm` (Jude 1:1); its commit list includes the old `f2c457e`, whose Genesis title change
  the decision commit undoes. I left it for you.

Because the fork is now ahead of the shared project and no longer diverged from a device that has
`2590981`, you need a new divergence to repeat the test: any of the three ways above, or step 6's
reset.

## 3. The steps (desktop and Web are the same)

On the Web, open Sefer in a browser and use the share link
`/r/Will_Kelly/x-en-ulb/book/JUD?host=content.bibletranslationtools.org`. On desktop, open the
project from the projects page, or the same link through the app.

1. **Sign in** as the test account: the cloud button (top right) → username and password → Sign in.
   The popover ends with `will-kelly-test · content.bibletranslationtools.org`.
2. **Work in your own copy.** In the cloud popover: "Work in my own copy". The toast says "Your
   changes go to will-kelly-test/x-en-ulb." If the copy already has versions this device lacks, the
   popover now also says **"Your copy has changes this device does not: from another device, or
   offered before."** with **See the changes**. That button is the same decision as below.
3. **Edit and Save.** Change a word in a verse, press Mod-S (Cmd-S), then **Save**, type a message,
   **Save**.
4. **The refused send.** The dialog stays open with two lines:
   - "Recorded 1 book(s) on this device", your message and a short commit id.
   - **"Saved here. Not sent: your copy has changes this device does not"**, then "They came from
     another device, or from changes you offered before. Compare with your copy and choose what to
     keep; then it sends as usual. Nothing is lost on either side."
   - One button: **Compare with your copy**.

   (Before the fix: "Not sent: the shared project has changed", and "Compare the changes".)

5. **The decision.** Press **Compare with your copy**. The review's title reads **"Your copy → In
   the editor"**, and the address ends `?against=shared&copy=1`. Each card says where a passage
   changed: "changed there" (only your copy), "changed here" (only this device), or "changed in both
   places".
   - What only your copy changed starts as **"Taken from your copy"**. To keep your own text
     (the "keep ours" case) press **Keep the editor's** on those cards.
   - "changed in both places" has no preset; choose one.
   - Press **Save**. The dialog says "A passage only your copy changed, that you didn't choose for,
     comes in. Its versions stay in the history either way, and this one goes on top, so the next
     send is an ordinary one." and "This also sends your changes to your copy,
     will-kelly-test/x-en-ulb." Type a message, **Save**.
   - The receipt: **"Combined with your copy on this device"**, then **"Sent to your copy"** and
     "Offer them to the shared project when they are ready." with **Offer these changes** (or "Your
     open suggestion now includes these changes." when one is open). In my run it still read
     "Combined with the shared project on this device" and "Sent to the shared project" although it
     went to the copy; I fixed that wording right after, so this is the first run that will show it.
6. **Offer.** Press **Offer these changes**, or Suggestions → **Offer my changes**. "Your changes are
   offered"; Suggestions → Yours shows "Changes suggested on <today>", "Waiting for the project's
   editors". If you press Offer while the copy still has versions this device lacks, it now goes
   straight to the review in step 5 with a note, instead of failing.

   An open suggestion follows the copy: while one is open, Offer is hidden and every send to the copy
   adds to it.

## 4. What the history should look like

On the device (desktop: the project folder; Web: History in the app), after step 5:

```
git log --graph --oneline -6

*   2590981 Keep my text; the copy's older title change stays in history
|\
| * f2c457e Test: a change sent to my own copy
* | df1cbf0 Round 3: a change sent while the copy holds older work
* | 7dfbbd9 Desktop send test (Jude 1:1)
|/
*   69c132d Reconciled gen from firefox again
```

One new commit on top with two parents: this device's head and the copy's head. Nothing above the
fork's old tip was rewritten; the old commit is still a parent. With "keep ours" the decision commit's
files are your text, so the old change has no effect.

## 5. Confirming nothing was forced, on WACS

- **The fork's branch history**: `https://content.bibletranslationtools.org/will-kelly-test/x-en-ulb/commits/branch/master`.
  The fork's previous tip (in my run `f2c457e`) is still listed below the decision commit.
- **The fork's activity**: the repository's front page, or
  `https://content.bibletranslationtools.org/api/v1/repos/will-kelly-test/x-en-ulb/activities/feeds`.
  A normal push reads "pushed to master"; a forced one reads "force-pushed". In my run the entry's
  compare link was `f2c457e…2590981`, three commits, an ordinary push.
- **The shared project** `Will_Kelly/x-en-ulb` `master` did not move: only an editor taking the
  suggestion moves it.

## 6. Cleaning up

- **The pull request**: open #1 on WACS and close it (or merge it, if you want Jude 1:1's test edit
  in the sandbox). Closing leaves the fork as it is.
- **To repeat the test with the fork as it was**: as `will-kelly-test` on WACS you cannot reset a
  branch from the web page. Either delete the fork (Settings → Danger zone) and let Sefer make a new
  one with "Work in my own copy" (then make a divergence with way 2 above), or from a terminal with
  the test account: `git push --force-with-lease origin <old-sha>:master` on a clone of the fork. That
  is the one force-push in this whole guide, and it is yours, not Sefer's.
- **On the device**: Remove/Delete the project from the projects page; nothing else is kept.

## 7. What still needs a second account

- **Another person reviewing and taking the suggestion**: a reviewer who can write to
  `Will_Kelly/x-en-ulb` opens #1 (Suggestions → To review), takes or declines it, and the author sees
  the outcome under Yours. You can do it as `Will_Kelly`.
- **Offer's own refusal path** with no open suggestion: close #1 first, make a divergence, then press
  Offer before Save. It should go to the review in step 5 with "Your copy has changes this device
  does not".
- **The Web record**: I stopped the Web run at the review (recording would have pushed to the fork
  that #1 follows). The record path is the same code as desktop's, through isomorphic-git instead of
  git2.
