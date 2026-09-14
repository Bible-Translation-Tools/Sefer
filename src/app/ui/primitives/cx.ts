/**
 * Two functions, no dependency: how a primitive decides its class list.
 *
 * `cx` flattens whatever Solid itself accepts in a `class` prop —
 * `JSX.ClassValue`, which is a string, a `{ name: boolean }` record, an array,
 * or nothing — into the one string a primitive can concatenate with its own.
 * Taking Solid's own type is what lets a caller pass `class` straight through.
 *
 * `variants` turns a lookup table into a function of the props — the whole of
 * what `cva`/`tv` are used for, minus the package. A primitive declares its
 * table once at module scope, so the strings are literals Tailwind's source
 * scan can see; building a class name by concatenation (`` `bg-${tone}-500` ``)
 * would compile to nothing at all.
 */

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

/** Flattens the truthy parts. Later entries win only by Tailwind's own ordering. */
export const cx = (...parts: readonly ClassValue[]): string => {
  const names: string[] = [];
  for (const part of parts) push(names, part);
  return names.join(" ");
};

/** One axis of a component's look: `{ primary: "...", secondary: "..." }`. */
type Axis = Record<string, string>;

/** Every axis, by name: `{ variant: {...}, size: {...} }`. */
type Axes = Record<string, Axis>;

/** The choice a caller may make on each axis — all optional, defaults fill in. */
export type Choices<A extends Axes> = {
  readonly [K in keyof A]?: (keyof A[K] & string) | undefined;
};

export interface VariantSpec<A extends Axes> {
  /** Classes every instance carries. */
  readonly base?: string;
  readonly variants: A;
  /** One default per axis, so a caller may omit any of them. */
  readonly defaults: { readonly [K in keyof A]: keyof A[K] & string };
}

/**
 * Builds the class function for a component.
 *
 * The returned function takes the caller's choices and a trailing `class`
 * passthrough, which lands last so a caller can always override a corner.
 */
export const variants =
  <A extends Axes>(spec: VariantSpec<A>) =>
  (chosen?: Choices<A>, extra?: ClassValue): string => {
    const picked = Object.keys(spec.variants).map((axis) => {
      const name = chosen?.[axis] ?? spec.defaults[axis];
      return spec.variants[axis]?.[name];
    });
    return cx(spec.base, ...picked, extra);
  };
