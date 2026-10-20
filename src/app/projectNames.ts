import { createSignal } from "solid-js";

const [names, setNames] = createSignal<Readonly<Record<string, string>>>(
  {},
  { name: "renamedProjects" },
);

export const noteRenamed = (root: string, name: string): void => {
  setNames((held) => ({ ...held, [root]: name }));
};

export const renamedName = (root: string | undefined): string | undefined =>
  root === undefined ? undefined : names()[root];
