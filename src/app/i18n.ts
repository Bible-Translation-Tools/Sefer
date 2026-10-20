export type Params = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;

export const t = (message: string, params?: Params): string => {
  if (params === undefined) return message;
  return message.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
};
