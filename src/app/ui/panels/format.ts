import { uiLocale } from "../../locale";

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["second", 1000],
  ["minute", 60_000],
  ["hour", 3_600_000],
  ["day", 86_400_000],
  ["week", 604_800_000],
  ["month", 2_629_800_000],
  ["year", 31_557_600_000],
];

export const ago = (at: number, now = Date.now()): string => {
  const elapsed = at - now;
  const magnitude = Math.abs(elapsed);
  let unit: Intl.RelativeTimeFormatUnit = "second";
  let size = 1000;
  for (const [name, milliseconds] of UNITS) {
    if (magnitude < milliseconds) break;
    unit = name;
    size = milliseconds;
  }
  const format = new Intl.RelativeTimeFormat(uiLocale(), { numeric: "auto" });
  return format.format(Math.round(elapsed / size), unit);
};

export const exact = (at: number): string => new Date(at).toLocaleString(uiLocale());

export const dated = (at: number): string =>
  new Intl.DateTimeFormat(uiLocale(), { dateStyle: "medium", timeStyle: "short" }).format(at);

export const lines = (text: string): readonly string[] => {
  if (text === "") return [];
  const split = text.split("\n");
  if (split.at(-1) === "") split.pop();
  return split;
};
