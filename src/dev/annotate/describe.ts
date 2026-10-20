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

/** A path short enough to read. */
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

const MAX_NEARBY = 60;

/** What this element itself says — its OWN text, not its descendants'. */
export const nearbyTextOf = (element: Element): string => {
  const own = [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  if (own !== "") return own.length > MAX_NEARBY ? `${own.slice(0, MAX_NEARBY)}…` : own;
  const labelled =
    element.getAttribute("aria-label") ??
    element.getAttribute("placeholder") ??
    element.getAttribute("alt") ??
    element.getAttribute("title") ??
    "";
  return labelled.trim();
};

const SKIPPED_DATA = new Set(["data-loc", "data-sefer-annotate", "data-sefer-annotate-mode"]);

const MAX_DATA_VALUE = 32;

/** The element's own `data-*` attributes, which in a hand-written codebase are usually the most identifying thing on it — `data-screen`, `data-testid`, `data-state`. */
export const dataAttributesOf = (element: Element): string => {
  const parts: string[] = [];
  for (const attribute of element.attributes) {
    if (!attribute.name.startsWith("data-")) continue;
    if (SKIPPED_DATA.has(attribute.name)) continue;
    const name = attribute.name.slice("data-".length);
    const value = attribute.value;
    if (value === "") continue;
    const short = value.length > MAX_DATA_VALUE ? `${value.slice(0, MAX_DATA_VALUE)}…` : value;
    parts.push(`${name}=${short}`);
    if (parts.length === 3) break;
  }
  return parts.join(" ");
};

/** Dark or light, as the page actually resolved it rather than as it was asked for — a comment about contrast is useless without knowing which one it was about. */
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
