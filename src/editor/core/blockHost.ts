/**
 * The element a block widget hands CodeMirror, around the one it draws.
 *
 * CodeMirror places every line below a block widget by the widget's measured
 * height, and the measure is the element's own box: a vertical margin on it
 * is not counted. The height map then runs short by the margin, and a click is
 * resolved to the line that far below it. The front-matter card's 24px sent
 * the lower half of the first verse's line to verse 2. So a widget's spacing
 * goes on the element inside, and this host (`display: flow-root`) holds those
 * margins inside the box that is measured.
 */
export const blockHost = (inner: HTMLElement): HTMLElement => {
  const host = document.createElement("div");
  host.className = "cm-block-host";
  host.append(inner);
  return host;
};
