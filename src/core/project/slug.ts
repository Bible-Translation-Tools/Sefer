const slugify = (name: string, fallback = "project"): string => {
  const folded = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const capped = folded.slice(0, 48).replace(/-+$/, "");
  return capped === "" ? fallback : capped;
};

export const nameOfRoot = (root: string): string => {
  const trimmed = root.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
};

export const mintSlug = (root: string, taken: Readonly<Record<string, string>>): string => {
  for (const [slug, held] of Object.entries(taken)) if (held === root) return slug;
  const base = slugify(nameOfRoot(root));
  if (taken[base] === undefined) return base;
  for (let attempt = 2; attempt < 1000; attempt += 1) {
    const candidate = `${base}-${attempt}`;
    if (taken[candidate] === undefined) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
};
