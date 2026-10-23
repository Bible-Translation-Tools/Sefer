export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

export const exportsFunctions = (module: unknown, ...names: readonly string[]): boolean =>
  isRecord(module) && names.every((name) => typeof module[name] === "function");
