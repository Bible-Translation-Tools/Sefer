import type { JSX } from "@solidjs/web";

export type ClassValue = JSX.ClassValue;

const push = (into: string[], value: ClassValue): void => {
  if (value === null || value === undefined || value === false || value === true) return;
  if (typeof value === "string") {
    if (value !== "") into.push(value);
    return;
  }
  if (typeof value === "number") {
    if (value !== 0) into.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const each of value) push(into, each);
    return;
  }
  for (const [name, on] of Object.entries(value)) if (on) into.push(name);
};

export const cx = (...parts: readonly ClassValue[]): string => {
  const names: string[] = [];
  for (const part of parts) push(names, part);
  return names.join(" ");
};

type Axis = Record<string, string>;

type Axes = Record<string, Axis>;

type Choices<A extends Axes> = {
  readonly [K in keyof A]?: (keyof A[K] & string) | undefined;
};

export interface VariantSpec<A extends Axes> {
  readonly base?: string;
  readonly variants: A;
  readonly defaults: { readonly [K in keyof A]: keyof A[K] & string };
}

export const variants =
  <A extends Axes>(spec: VariantSpec<A>) =>
  (chosen?: Choices<A>, extra?: ClassValue): string => {
    const picked = Object.keys(spec.variants).map((axis) => {
      const name = chosen?.[axis] ?? spec.defaults[axis];
      return spec.variants[axis]?.[name];
    });
    return cx(spec.base, ...picked, extra);
  };
