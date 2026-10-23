import type { Comment, Target, Verbosity } from "./types.ts";

const ACTIVE = "sefer.annotate.comments";
const LAST = "sefer.annotate.lastBatch";

const isComment = (value: unknown): value is Comment => {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "text" in value &&
    typeof value.text === "string"
  );
};

const lift = (comment: Comment): Comment => {
  if (Array.isArray(comment.targets)) return comment;
  // SAFETY: reached only when `targets` is absent, which means this is the older flat shape written by this same module. Every field is read through `Partial`, so a comment that is neither shape yields empty strings rather than `undefined` in the paste.
  const flat = comment as unknown as Partial<Target>;
  return {
    ...comment,
    targets: [
      {
        id: `${comment.id}t0`,
        source: flat.source ?? null,
        selector: flat.selector ?? "",
        nearby: flat.nearby ?? "",
        data: flat.data ?? "",
      },
    ],
  };
};

const readList = (key: string): readonly Comment[] => {
  try {
    const held: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    return Array.isArray(held) ? held.filter(isComment).map(lift) : [];
  } catch {
    return [];
  }
};

const writeList = (key: string, comments: readonly Comment[]): void => {
  try {
    sessionStorage.setItem(key, JSON.stringify(comments));
  } catch {}
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
  const header = Object.entries(context)
    .map(([key, value]) => `${key} ${value}`)
    .filter((part) => part !== "");
  const lines: string[] = header.length > 0 ? [header.join(" · "), ""] : [];

  let showing: string | null = null;

  let pinNumber = 0;

  for (const comment of comments) {
    if (comment.url !== showing) {
      showing = comment.url;
      lines.push(`## ${comment.url}`, "");
    }
    for (const target of comment.targets) {
      pinNumber += 1;
      const place = target.source ?? target.selector;
      const label = target.nearby === "" ? "" : `  "${target.nearby}"`;
      const data = target.data === "" ? "" : `  [${target.data}]`;
      const selector =
        verbosity === "full" && target.source !== null ? `  · ${target.selector}` : "";
      lines.push(`[${String(pinNumber)}] ${place}${label}${data}${selector}`);
    }
    for (const line of comment.text.split("\n")) lines.push(`    ${line}`);
    if (verbosity === "full") {
      lines.push(`    (viewport ${comment.viewport} · theme ${comment.theme})`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
};

/** `navigator.clipboard` needs a secure context and a user gesture, and this runs from a click so the gesture is there — but a plain `http://` host on the network is not secure, and a deployed prototype is exactly that. */
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
