/**
 * Handing bytes to the person, in a browser.
 *
 * A host with a real filesystem writes a file to a path someone chose
 * (`ProjectAdmin.export`). A browser has no such path: OPFS is Sefer's own
 * storage and nothing outside the page can see it, and the `Dialogs` port has
 * no save picker to add one honestly. So the Web host's "save a copy" is a
 * download — an anchor with `download`, clicked once, over an object URL.
 *
 * This is the only place in `src/app` that reaches for `document` to do
 * something rather than to render it, which is why it is three lines in its own
 * file rather than a limb of a component.
 */

/** Offers `bytes` to the reader as a file named `name`. */
export const downloadBytes = (name: string, bytes: Uint8Array, type = "application/zip"): void => {
  // SAFETY: a copy into a plain ArrayBuffer-backed view — `Blob` will not take
  // a SharedArrayBuffer-backed one, and TypeScript cannot rule that out here.
  const blob = new Blob([new Uint8Array(bytes)], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Long enough for the download to have started; the browser holds its own
  // reference once it has, and an object URL never revoked is a leak the page
  // keeps for its lifetime.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
