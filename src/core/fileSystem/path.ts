export const normalisePath = (path: string): string => {
  const source = path.replaceAll("\\", "/");
  const absolute = source.startsWith("/");
  const parts: string[] = [];
  for (const segment of source.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") {
      parts.push(segment);
      continue;
    }
    const last = parts.at(-1);
    if (last !== undefined && last !== "..") parts.pop();
    else if (!absolute) parts.push("..");
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
};

export const parentPath = (path: string): string => {
  const index = path.lastIndexOf("/");
  if (index < 0) return "";
  if (index === 0) return "/";
  return path.slice(0, index);
};

/** The last `/`-separated segment: a file or folder name. */
export const lastSegment = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export const joinPath = (left: string, right: string): string => {
  if (left === "") return normalisePath(right);
  if (right === "") return normalisePath(left);
  return normalisePath(`${left}/${right}`);
};

export const isAbsolutePath = (path: string): boolean =>
  path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[/\\]/.test(path);

export const escapesRoot = (root: string, resolved: string): boolean => {
  if (root === "") return resolved.startsWith("..");
  if (root === "/") return !resolved.startsWith("/");
  return resolved !== root && !resolved.startsWith(`${root}/`);
};
