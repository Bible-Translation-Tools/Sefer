export interface PendingDownload {
  readonly id: string;
  readonly root: string;
  readonly language: string;
  readonly code: string;
  readonly state: "downloading" | "failed";
  readonly status: string;
  readonly percent: number | undefined;
}

export const flyCard = (from: DOMRect, to: Element, label: string): void => {
  const target = to.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.setAttribute("aria-hidden", "true");
  ghost.textContent = label;
  ghost.className =
    "pointer-events-none fixed z-50 flex items-center rounded-lg border border-brand bg-surface-primary px-3 text-small font-semibold text-on-surface-primary shadow-large";
  Object.assign(ghost.style, {
    left: `${String(from.left)}px`,
    top: `${String(from.top)}px`,
    width: `${String(from.width)}px`,
    height: `${String(from.height)}px`,
  });
  document.body.append(ghost);
  const animation = ghost.animate(
    [
      { transform: "none", opacity: 1 },
      {
        transform: `translate(${String(target.left - from.left)}px, ${String(target.top - from.top)}px)`,
        width: `${String(target.width)}px`,
        height: `${String(target.height)}px`,
        opacity: 0.4,
      },
    ],
    { duration: 450, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" },
  );
  animation.onfinish = () => ghost.remove();
  animation.oncancel = () => ghost.remove();
};
