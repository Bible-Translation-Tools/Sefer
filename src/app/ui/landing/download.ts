export const downloadBytes = (name: string, bytes: Uint8Array, type = "application/zip"): void => {
  // SAFETY: a copy into a plain ArrayBuffer-backed view — `Blob` will not take a SharedArrayBuffer-backed one, and TypeScript cannot rule that out here.
  const blob = new Blob([new Uint8Array(bytes)], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
