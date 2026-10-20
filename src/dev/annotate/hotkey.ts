export interface Hotkey {
  /** `event.code`, e.g. */
  readonly code: string | null;
  /** `event.key`, lowercased. */
  readonly key: string;
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
}

const STORAGE = "sefer.annotate.hotkey";
const NONE = "none";

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift", "AltGraph", "CapsLock"]);

const codeFor = (key: string): string | null => {
  if (/^[a-z]$/u.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/u.test(key)) return `Digit${key}`;
  return null;
};

/** Accepts the option as written — a bare key, a chord, or nothing. */
export const asHotkey = (value: string | Hotkey | null | undefined): Hotkey | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const key = value.toLowerCase();
  return { code: codeFor(key), key, alt: false, ctrl: false, meta: false, shift: false };
};

/** The keystroke that just happened, or null if it was only a modifier. */
export const hotkeyFrom = (event: KeyboardEvent): Hotkey | null => {
  if (MODIFIER_KEYS.has(event.key)) return null;
  return {
    code: event.code === "" ? null : event.code,
    key: event.key.toLowerCase(),
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
};

export const hotkeyMatches = (event: KeyboardEvent, hotkey: Hotkey): boolean => {
  if (
    event.altKey !== hotkey.alt ||
    event.ctrlKey !== hotkey.ctrl ||
    event.metaKey !== hotkey.meta ||
    event.shiftKey !== hotkey.shift
  ) {
    return false;
  }
  return hotkey.code === null ? event.key.toLowerCase() === hotkey.key : event.code === hotkey.code;
};

const LABELS: Readonly<Record<string, string>> = {
  Escape: "Esc",
  " ": "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

export const describeHotkey = (hotkey: Hotkey | null): string => {
  if (hotkey === null) return "none";
  const base =
    hotkey.code !== null && /^Key[A-Z]$/u.test(hotkey.code)
      ? hotkey.code.slice(3)
      : hotkey.code !== null && /^Digit[0-9]$/u.test(hotkey.code)
        ? hotkey.code.slice(5)
        : (LABELS[hotkey.key] ?? (hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key));
  return (
    (hotkey.ctrl ? "⌃" : "") +
    (hotkey.alt ? "⌥" : "") +
    (hotkey.shift ? "⇧" : "") +
    (hotkey.meta ? "⌘" : "") +
    base
  );
};

/** What this browser has been told to use, if anything. */
export const readSavedHotkey = (): Hotkey | null | undefined => {
  try {
    const held = localStorage.getItem(STORAGE);
    if (held === null) return undefined;
    if (held === NONE) return null;
    const parsed: unknown = JSON.parse(held);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    if (!("key" in parsed) || typeof parsed.key !== "string") return undefined;
    // SAFETY: this is our own write from `saveHotkey`, and `key` — the one field every match falls back on — has just been checked. A missing modifier from an older shape reads as `undefined`, which is falsy, so the worst outcome is a chord that matches without it.
    return parsed as Hotkey;
  } catch {
    return undefined;
  }
};

export const saveHotkey = (hotkey: Hotkey | null): void => {
  try {
    localStorage.setItem(STORAGE, hotkey === null ? NONE : JSON.stringify(hotkey));
  } catch {}
};
