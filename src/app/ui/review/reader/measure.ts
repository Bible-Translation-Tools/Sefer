import { onCleanup } from "solid-js";

/** A ref that reports the element's width as it changes; Review's, and the Word importer's diff. */
export function createMeasure(
  setWidth: (width: number) => void,
): (element: HTMLDivElement) => void {
  let observer: ResizeObserver | undefined;
  const measure = (element: HTMLDivElement): void => {
    observer?.disconnect();
    observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box !== undefined && box.width > 0) setWidth(box.width);
    });
    observer.observe(element);
  };
  onCleanup(() => observer?.disconnect());
  return measure;
}
