import { isExperiment, type Experiment } from "./experiment";

const collect = (modules: Readonly<Record<string, unknown>>): readonly Experiment[] => {
  const found: Experiment[] = [];
  for (const path of Object.keys(modules).sort()) {
    const module = modules[path];
    if (typeof module !== "object" || module === null) continue;
    for (const exported of Object.values(module)) {
      if (isExperiment(exported)) found.push(exported);
    }
  }
  return found;
};

export const experiments: readonly Experiment[] = [
  ...collect(import.meta.glob("./experiments/*.tsx", { eager: true })),
  ...collect(import.meta.glob("./local/*.tsx", { eager: true })),
];
