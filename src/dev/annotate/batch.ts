/**
 * The batch of comments, where it is kept, and what it looks like on the
 * clipboard.
 *
 * ## Storage
 *
 * `sessionStorage`, so a hot reload does not eat ten minutes of writing. Per
 * tab, which is right: two tabs are two things being reviewed.
 *
 * ## Copy clears, but softly
 *
 * Copying empties the active list — stale comments getting pasted a second
 * time is the worse failure, and the one that wastes somebody else's time. But
 * the batch is kept as `last`, and the panel offers to bring it back, because
 * losing a morning's notes to a misclicked button is a close second.
 *
 * ## Markdown, not JSON
 *
 * The destination is a chat box. Two verbosity levels, because three is a menu
 * nobody reads: `brief` is the URL, the build, and then a source location and
 * the words per comment — most comments are "this padding is wrong" and the
 * location IS the payload. `full` adds viewport, theme, selector and the
 * nearby text for the ones where the words are not enough.
 */

import type { Comment, Verbosity } from "./types.ts";

const ACTIVE = "sefer.annotate.comments";
const LAST = "sefer.annotate.lastBatch";

/**
 * Storage is not trusted input, but it is not hostile either — it is this
 * tool's own writes from a moment ago, possibly from an older shape of the
 * type. Each entry is checked for the two fields everything downstream reads,
 * and anything else is dropped rather than rendered as `undefined`.
 */
const isComment = (value: unknown): value is Comment => {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "text" in value &&
    typeof value.text === "string"
  );
};

const readList = (key: string): readonly Comment[] => {
  try {
    const held: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    return Array.isArray(held) ? held.filter(isComment) : [];
  } catch {
    // A tool that refuses to open because storage is disabled would be a worse
    // tool than one that forgets.
    return [];
  }
};

const writeList = (key: string, comments: readonly Comment[]): void => {
  try {
    sessionStorage.setItem(key, JSON.stringify(comments));
  } catch {
    // See above: forgetting beats failing.
  }
};

export const readComments = (): readonly Comment[] => readList(ACTIVE);
export const readLastBatch = (): readonly Comment[] => readList(LAST);

export const addComment = (comment: Comment): readonly Comment[] => {
  const next = [...readComments(), comment];
  writeList(ACTIVE, next);
  return next;
};

export const removeComment = (id: string): readonly Comment[] => {
  const next = readComments().filter((comment) => comment.id !== id);
  writeList(ACTIVE, next);
  return next;
};

/** Empties the active list, keeping it recoverable. */
export const archiveComments = (): void => {
  const current = readComments();
  if (current.length > 0) writeList(LAST, current);
  writeList(ACTIVE, []);
};

export const restoreLastBatch = (): readonly Comment[] => {
  const last = readLastBatch();
  if (last.length === 0) return readComments();
  const next = [...readComments(), ...last];
  writeList(ACTIVE, next);
  writeList(LAST, []);
  return next;
};

export const renderMarkdown = (
  comments: readonly Comment[],
  verbosity: Verbosity,
  context: Readonly<Record<string, string>>,
): string => {
  if (comments.length === 0) return "";
  const first = comments[0];
  const header = [
    ...Object.entries(context).map(([key, value]) => `${key} ${value}`),
    first?.url ?? "",
  ].filter((part) => part !== "");
  const lines: string[] = [header.join(" · "), ""];

  comments.forEach((comment, index) => {
    const place = comment.source ?? comment.selector;
    const label = comment.nearby === "" ? "" : `  "${comment.nearby}"`;
    const data = comment.data === "" ? "" : `  [${comment.data}]`;
    lines.push(`${String(index + 1)}. ${place}${label}${data}`);
    // Every line indented, not just the first: Shift+Enter makes multi-line
    // comments, and a continuation flush against the margin reads as a new
    // numbered item rather than as more of the same one.
    for (const line of comment.text.split("\n")) lines.push(`   ${line}`);
    if (verbosity === "full") {
      const facts = [
        comment.source === null ? null : `selector ${comment.selector}`,
        `viewport ${comment.viewport}`,
        `theme ${comment.theme}`,
      ].filter((fact): fact is string => fact !== null);
      lines.push(`   (${facts.join(" · ")})`);
    }
    lines.push("");
  });

  return lines.join("\n").trimEnd();
};

/**
 * `navigator.clipboard` needs a secure context and a user gesture, and this
 * runs from a click so the gesture is there — but a plain `http://` host on
 * the network is not secure, and a deployed prototype is exactly that. The
 * textarea fallback is not nostalgia; it is the path that works there.
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }
};
