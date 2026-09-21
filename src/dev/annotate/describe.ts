/**
 * Turning the element under the cursor into something a reader can find again.
 *
 * In order of usefulness:
 *
 *   1. `data-loc` — the file, line and column the markup was written at, put
 *      there by the JSX-location Vite transform. This is the whole point. A
 *      comment carrying `src/app/ui/review/DecisionRow.tsx:42` is a place to
 *      go; one carrying `.flex.items-center.gap-2` is a grep.
 *   2. A short CSS-ish path, for a project without that transform — this
 *      module must still be useful when dropped somewhere that has not set one
 *      up.
 *   3. The visible text nearby, because "the Find Project card" is how a
 *      person will describe it anyway.
 */

/** Written by `tools/vite/jsxLocation.ts`. Kept as a literal so this file depends on nothing. */
const LOCATION_ATTRIBUTE = "data-loc";

/** The nearest element that knows where it came from, including the target itself. */
export const sourceOf = (element: Element): string | null =>
  element.closest(`[${LOCATION_ATTRIBUTE}]`)?.getAttribute(LOCATION_ATTRIBUTE) ?? null;

const nth = (element: Element): string => {
  const parent = element.parentElement;
  if (parent === null) return "";
  const siblings = [...parent.children].filter((child) => child.tagName === element.tagName);
  if (siblings.length < 2) return "";
  return `:nth-of-type(${String(siblings.indexOf(element) + 1)})`;
};

/**
 * A path short enough to read. Three levels, ids win outright, and at most two
 * classes per step — a full Tailwind class list is longer than the comment and
 * identifies nothing.
 */
export const selectorOf = (element: Element): string => {
  const steps: string[] = [];
  let at: Element | null = element;
  for (let depth = 0; depth < 3 && at !== null && at.tagName !== "BODY"; depth += 1) {
    if (at.id !== "") {
      steps.unshift(`#${at.id}`);
      break;
    }
    const classes = [...at.classList]
      .slice(0, 2)
      .map((name) => `.${name}`)
      .join("");
    steps.unshift(`${at.tagName.toLowerCase()}${classes}${nth(at)}`);
    at = at.parentElement;
  }
  return steps.join(" > ");
};

const MAX_NEARBY = 80;

/** What the thing says, or what the nearest thing with words says. */
export const nearbyTextOf = (element: Element): string => {
  const own = (element.textContent ?? "").replace(/\s+/gu, " ").trim();
  if (own !== "") return own.length > MAX_NEARBY ? `${own.slice(0, MAX_NEARBY)}…` : own;
  const labelled =
    element.getAttribute("aria-label") ??
    element.getAttribute("placeholder") ??
    element.getAttribute("title") ??
    "";
  return labelled.trim();
};

/**
 * Dark or light, as the page actually resolved it rather than as it was asked
 * for — a comment about contrast is useless without knowing which one it was
 * about. Reads the stamped attribute first (an explicit choice), then the
 * media query (the "system" default).
 */
export const themeOf = (): string => {
  const stamped =
    document.documentElement.dataset["theme"] ??
    (document.documentElement.classList.contains("dark") ? "dark" : null);
  if (stamped !== null && stamped !== undefined) return stamped;
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches === true
    ? "dark"
    : "light";
};

export const viewportOf = (): string =>
  `${String(globalThis.innerWidth)}×${String(globalThis.innerHeight)}`;
