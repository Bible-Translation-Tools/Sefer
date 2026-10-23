/**
 * The desktop app launches, a project arrives on the native disk and opens, a
 * book shows its text, an edit and Undo round-trip, and the save model holds:
 * an edit reaches the backup journal, and only Record a version writes the file.
 *
 * The template for promoting more desktop checks: each `it` makes one claim
 * only the desktop host can get wrong (the Tauri IPC, the native filesystem,
 * git2, the system webview), and none says how a screen looks.
 *
 * Three things about the embedded driver shape how this is written. It drives
 * the page through JavaScript (see documentation/agents/verification.md,
 * "Driving the desktop app"):
 *
 *   - A native dialog cannot be driven, so `answerDialogs` answers the Tauri
 *     dialog plugin's IPC in the page. Tauri posts every command through the
 *     global `fetch` to `ipc://localhost/<command>`, and `invoke` itself is
 *     frozen; the answer is the path a person would have picked.
 *   - Its click is `element.click()`, which places no caret, and its pointer
 *     actions send a mousedown with `detail: 0`, which CodeMirror reads as a
 *     line selection. `placeCaret` sends the mousedown a real click would.
 *   - `addValue` is `execCommand("insertText")` at the selection, which the
 *     editor receives as real `beforeinput`/`input`, the way typing arrives.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const home = process.env["SEFER_DESKTOP_HOME"] ?? "";
const picked = path.join(home, "Documents", "small-nt");
const projects = path.join(
  home,
  "Library",
  "Application Support",
  "org.wycliffe.sefer",
  "projects",
);
const appData = path.join(home, "Library", "Application Support", "org.wycliffe.sefer");
const editor = "[data-testid='editor-host'] .cm-content";
const mod = process.platform === "darwin" ? "Meta" : "Control";

/**
 * The backup journals holding `word`: `.jsonl` files under app data, outside
 * the projects and the Library (the journals sit beside them, each under its
 * project's path).
 */
const journalsHolding = (word: string): string[] => {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const at = path.join(directory, entry.name);
      if (directory === appData && (entry.name === "projects" || entry.name === "library"))
        continue;
      if (entry.isDirectory()) walk(at);
      else if (entry.name.endsWith(".jsonl") && readFileSync(at, "utf8").includes(word))
        found.push(at);
    }
  };
  if (existsSync(appData)) walk(appData);
  return found;
};

const bodyText = (): Promise<string> => browser.execute(() => document.body.innerText);

const editorText = (): Promise<string> =>
  browser.execute((selector) => document.querySelector(selector)?.textContent ?? "", editor);

const waitForText = (needle: string, timeout = 60_000): Promise<true | void> =>
  browser.waitUntil(async () => (await bodyText()).includes(needle), {
    timeout,
    interval: 500,
    timeoutMsg: `"${needle}" never appeared`,
  });

const answerDialogs = (answers: Record<string, unknown>): Promise<unknown> =>
  browser.execute((given) => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const match = /^ipc:\/\/localhost\/plugin%3Adialog%7C(\w+)/u.exec(url);
      const command = match?.[1];
      if (command !== undefined && command in given)
        return Promise.resolve(
          new Response(JSON.stringify(given[command]), {
            headers: { "content-type": "application/json", "Tauri-Response": "ok" },
          }),
        );
      return original(input, init);
    };
  }, answers);

/**
 * A click at the end of `words` in the editor, as a person's would land.
 * Scrolled into view first and measured only once the editor has settled:
 * CodeMirror re-lays out after a scroll, and coordinates taken in the same
 * task land a line or two off.
 */
const placeCaret = async (words: string): Promise<void> => {
  await browser.execute((needle) => {
    const line = [...document.querySelectorAll(".cm-line")].find((candidate) =>
      candidate.textContent?.includes(needle),
    );
    line?.scrollIntoView({ block: "center" });
  }, words);
  await browser.pause(500);
  const landed = await browser.execute((needle) => {
    const line = [...document.querySelectorAll(".cm-line")].find((candidate) =>
      candidate.textContent?.includes(needle),
    );
    if (line === undefined) throw new Error(`no line holds "${needle}"`);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let node: Node | null = null;
    for (let next = walker.nextNode(); next !== null; next = walker.nextNode())
      if (next.textContent?.includes(needle) === true) node = next;
    if (node === null) throw new Error(`no text node holds "${needle}"`);
    const end = (node.textContent ?? "").indexOf(needle) + needle.length;
    const range = document.createRange();
    range.setStart(node, end - 1);
    range.setEnd(node, end);
    const rect = range.getBoundingClientRect();
    const x = rect.right - 1;
    const y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y) ?? line;
    for (const type of ["mousedown", "mouseup"])
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === "mousedown" ? 1 : 0,
          detail: 1,
          view: window,
        }),
      );
    const selection = window.getSelection();
    return selection?.isCollapsed === true && selection.anchorNode === node;
  }, words);
  if (!landed) throw new Error(`the caret did not land after "${words}"`);
};

describe("the desktop app", () => {
  it("launches on the desktop host with the shell up", async () => {
    await browser.waitUntil(
      async () => browser.execute(() => document.querySelector("[data-testid='app-bar']") !== null),
      { timeout: 120_000, interval: 500, timeoutMsg: "the app bar never rendered" },
    );
    const host = await browser.execute(() => ({
      tauri: "__TAURI_INTERNALS__" in globalThis,
      observability: typeof Reflect.get(globalThis, "__sefer") === "object",
    }));
    expect(host).toEqual({ tauri: true, observability: true });
  });

  it("imports a folder onto the native disk and opens it", async () => {
    cpSync(path.join(root, "fixtures", "small-nt"), picked, { recursive: true });
    await answerDialogs({ open: picked });
    // Import lives on the projects page only; a fresh launch lands on the empty workspace.
    await browser.execute(() => location.assign("/projects"));
    await $("[data-testid='import-folder']").click();
    await waitForText("books imported");
    await $("button=Close").click();

    // On disk, through the Tauri filesystem: the books, and git2's repository.
    expect(existsSync(path.join(projects, "small-nt", "19-PSA.usfm"))).toBe(true);
    expect(existsSync(path.join(projects, "small-nt", ".git"))).toBe(true);

    await $("button=Open Project").click();
    await $(editor).waitForDisplayed({ timeout: 90_000 });
  });

  it("shows the book's text", async () => {
    await browser.waitUntil(async () => (await editorText()).includes("Blessed is the man"), {
      timeout: 30_000,
      timeoutMsg: "Psalms 1:1 never drew",
    });
  });

  it("round-trips an edit and Undo", async () => {
    const before = await editorText();
    await placeCaret("Blessed is the man");
    await $(editor).addValue(" DESKTOP");
    await browser.waitUntil(async () => (await editorText()).includes("the man DESKTOP"), {
      timeout: 10_000,
      timeoutMsg: "the typed text never reached the editor",
    });

    await browser.keys([mod, "z"]);
    await browser.waitUntil(async () => (await editorText()) === before, {
      timeout: 10_000,
      timeoutMsg: "Undo did not restore the text",
    });
  });

  it("keeps an edit in the backup journal and writes the file only on Record a version", async () => {
    const book = path.join(projects, "small-nt", "19-PSA.usfm");
    await placeCaret("who does not walk");
    await $(editor).addValue(" RECORDED");
    // The journal flush is debounced (500 ms of quiet, 5 s at most).
    await browser.waitUntil(() => journalsHolding("RECORDED").length > 0, {
      timeout: 15_000,
      interval: 500,
      timeoutMsg: "no backup journal holds the edit",
    });
    expect(readFileSync(book, "utf8").includes("RECORDED")).toBe(false);

    // In-app, not a reload: a reload would drop the unsaved edit.
    await browser.keys([mod, "s"]);
    await $("[data-review-record]").click();
    await $("#commit-message").waitForDisplayed({ timeout: 30_000 });
    const name = await $("[role=dialog] input:not(#commit-message)");
    if ((await name.isExisting()) && (await name.getValue()) === "")
      await name.addValue("Desktop smoke");
    await $("#commit-message").addValue("Desktop smoke: Record a version");
    await browser.execute(() =>
      [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")]
        .filter((button) => button.innerText.trim() === "Save")
        .at(-1)
        ?.click(),
    );

    await browser.waitUntil(() => readFileSync(book, "utf8").includes("RECORDED"), {
      timeout: 30_000,
      interval: 500,
      timeoutMsg: "Record a version did not write the book",
    });
    const head = spawnSync("git", ["-C", path.dirname(book), "log", "-1", "--format=%s"], {
      encoding: "utf8",
    });
    expect(head.stdout.trim()).toBe("Desktop smoke: Record a version");
  });
});
