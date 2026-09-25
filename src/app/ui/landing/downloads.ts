/**
 * A download in flight, as the projects page shows it.
 *
 * The WACS table starts one; the installed row draws it as a card with a
 * progress bar until the project it becomes is in the list. They share this
 * shape and nothing else — `ProjectsLanding` holds the list and passes it down.
 */

export interface PendingDownload {
  /** The catalogue row's `owner/repo`. */
  readonly id: string;
  /** Where the clone lands; the real card replaces this one once it is listed. */
  readonly root: string;
  readonly language: string;
  readonly code: string;
  readonly state: "downloading" | "failed";
  /** What the transfer says it is doing, or why it failed. */
  readonly status: string;
  /** 0–100, or undefined while the far side has not said how much there is. */
  readonly percent: number | undefined;
}

/**
 * Flies a ghost card from `from` to where `to` sits, then removes it. The
 * installed row scrolls sideways and so clips its children, which is why this
 * animates a fixed-position copy rather than the card itself.
 */
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
