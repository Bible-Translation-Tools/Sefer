export type Dial =
  | { readonly kind: "toggle"; readonly label: string; readonly initial?: boolean }
  | {
      readonly kind: "choice";
      readonly label: string;
      readonly options: readonly string[];
      readonly initial?: string;
    };

export type Dials = Readonly<Record<string, Dial>>;

export interface DialValues {
  readonly toggle: (key: string) => boolean;
  readonly choice: (key: string) => string;
}

const dialInitial = (dial: Dial): string =>
  dial.kind === "toggle" ? String(dial.initial ?? false) : (dial.initial ?? dial.options[0] ?? "");

const dialKey = (screenId: string, key: string): string => `${screenId}.${key}`;

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
