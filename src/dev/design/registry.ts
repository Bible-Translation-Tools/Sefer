import { isScreen, type Screen } from "./screen";

const collect = (modules: Readonly<Record<string, unknown>>): readonly Screen[] => {
  const found: Screen[] = [];
  for (const path of Object.keys(modules).sort()) {
    const module = modules[path];
    if (typeof module !== "object" || module === null) continue;
    for (const exported of Object.values(module)) {
      if (isScreen(exported)) found.push(exported);
    }
  }
  return found;
};

export const screens: readonly Screen[] = [
  ...collect(import.meta.glob("./screens/*.tsx", { eager: true })),
  ...collect(import.meta.glob("./local/*.tsx", { eager: true })),
];

export const screenById = (id: string): Screen | undefined =>
  screens.find((screen) => screen.id === id);
