/**
 * Dials: the declared knobs a prototype exposes, and where their values live.
 *
 * The playground invented these for experiments over real text; the design
 * surface needs exactly the same vocabulary for screens that need no text at
 * all. Rather than a second copy that drifts, both read this.
 *
 * The one thing that changed in moving them here is WHERE a value is kept. The
 * playground held dials in `sessionStorage` and said so in its own module note:
 * "not a place anyone should link to, and a prototype whose settings live in
 * search params grows a `validateSearch` schema nobody wants to maintain."
 *
 * Both halves of that have stopped being true. Sharing IS the requirement now —
 * a designer's whole workflow is sending somebody two links and asking which is
 * better — and the schema worry is answered by not having one: the route
 * validates search as a flat `Record<string, string>` and keeps whatever keys
 * it is given. There is nothing per-screen to maintain because no screen
 * declares its params anywhere but in its own `dials`.
 *
 * So a dial value is a query parameter. That also means the router IS the
 * reactive store — reading `useSearch()` is reading a signal, and `navigate`
 * is the setter — and back, forward, reload and paste all work without this
 * module implementing any of them.
 */

/** One control in a frame's dial bar. */
export type Dial =
  | { readonly kind: "toggle"; readonly label: string; readonly initial?: boolean }
  | {
      readonly kind: "choice";
      readonly label: string;
      readonly options: readonly string[];
      readonly initial?: string;
    };

export type Dials = Readonly<Record<string, Dial>>;

/**
 * What the dials currently say. Untyped per-key on purpose: a prototype reads
 * its own dials and knows their kinds, and a generic map is the price of not
 * making every sketch declare a type it will rename twice this afternoon.
 */
export interface DialValues {
  readonly toggle: (key: string) => boolean;
  readonly choice: (key: string) => string;
}

const dialInitial = (dial: Dial): string =>
  dial.kind === "toggle" ? String(dial.initial ?? false) : (dial.initial ?? dial.options[0] ?? "");

/**
 * Query keys are namespaced per screen, so two screens may both have a
 * `density` dial and a link to one does not quietly set the other's.
 */
const dialKey = (screenId: string, key: string): string => `${screenId}.${key}`;

/**
 * A reader over whatever the URL currently says, falling back to each dial's
 * declared initial. Values are strings because a query parameter is a string;
 * `toggle` is the one place that is worth hiding.
 */
export const dialValues = (
  screenId: string,
  dials: Dials,
  search: () => Readonly<Record<string, string>>,
): DialValues => {
  const raw = (key: string): string => {
    const declared = dials[key];
    const fallback = declared === undefined ? "" : dialInitial(declared);
    return search()[dialKey(screenId, key)] ?? fallback;
  };
  return {
    toggle: (key) => raw(key) === "true",
    choice: raw,
  };
};

/**
 * The next search object after setting one dial — not a mutation, because
 * `navigate({ search })` wants a whole object and the router owns the state.
 *
 * A dial sitting at its declared initial is REMOVED rather than written. Links
 * are meant to be read and edited by hand, and a URL carrying every default a
 * screen has is one nobody can see the interesting part of.
 */
export const withDial = (
  current: Readonly<Record<string, string>>,
  screenId: string,
  dials: Dials,
  key: string,
  value: string,
): Record<string, string> => {
  const next = { ...current };
  const declared = dials[key];
  const full = dialKey(screenId, key);
  if (declared !== undefined && dialInitial(declared) === value) delete next[full];
  else next[full] = value;
  return next;
};
