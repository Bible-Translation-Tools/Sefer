/**
 * Offsets to 1-based line and column.
 *
 * oxc hands back spans as JS string indices; humans, editors and stack traces
 * want line and column. Computed once per file rather than per lookup — a file
 * with thirty imports, or three hundred JSX elements, should not be rescanned
 * once per answer.
 *
 * Shared by the boundary walker and the JSX-location transform, which are the
 * two things in this repository that read its own source with oxc.
 */
export const lineIndex = (
  source: string,
): ((offset: number) => { line: number; column: number }) => {
  const starts: number[] = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((starts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
  };
};
