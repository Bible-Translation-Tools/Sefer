import { For, createSignal, onCleanup } from "solid-js";

import { cx } from "./primitives";

/**
 * The Settings page's side navigation: one anchor per section heading.
 *
 * Read from the page rather than declared, because the sections come from
 * several components (the setting groups, About, Cloud and its cards) and
 * some appear only sometimes (Advanced, Diagnostics). Every card's `h3`
 * becomes a link; the `h2` above a group of cards (Cloud) does not, for now.
 * The section in view is marked `aria-current`.
 */

interface Entry {
  readonly id: string;
  readonly title: string;
}

const slug = (text: string): string =>
  `settings-${text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")}`;

export function createSettingsNav() {
  const [entries, setEntries] = createSignal<readonly Entry[]>([], { name: "settingsNav" });
  const [current, setCurrent] = createSignal("", { name: "settingsNavCurrent" });
  // A link's own jump moves headings past the line too. Near the end of the page
  // the picked section cannot reach the top, so the jump would mark the one above it.
  let pickedAt = 0;
  const pick = (id: string): void => {
    pickedAt = performance.now();
    setCurrent(id);
  };

  /** The `ref` for the content whose headings the nav lists. */
  const watch = (content: HTMLElement): void => {
    let visible: IntersectionObserver | undefined;
    let watched: readonly HTMLElement[] = [];

    const read = (): void => {
      const headings = [...content.querySelectorAll<HTMLElement>("h3")];
      const taken = new Set<string>();
      const next = headings.map((heading, index): Entry => {
        // A heading in a script slug() keeps nothing of, or two alike, must
        // still get an anchor of its own.
        const wanted = slug(heading.textContent ?? "");
        heading.id ||= wanted === "settings-" || taken.has(wanted) ? `${wanted}${index}` : wanted;
        taken.add(heading.id);
        return {
          id: heading.id,
          title: heading.textContent?.trim() ?? "",
        };
      });
      // Typing and progress bars mutate the page too; only a changed outline,
      // or headings drawn anew, is news.
      const same = headings.length === watched.length && headings.every((h, i) => h === watched[i]);
      if (same && JSON.stringify(next) === JSON.stringify(entries())) return;
      watched = headings;
      if (JSON.stringify(next) !== JSON.stringify(entries())) setEntries(next);
      // Above the first heading's line, the first section is the one you are in.
      if (!next.some((entry) => entry.id === current())) setCurrent(next[0]?.id ?? "");
      visible?.disconnect();
      visible = new IntersectionObserver(
        (seen) => {
          const top = seen.find((entry) => entry.isIntersecting);
          if (top !== undefined && performance.now() - pickedAt > 600) setCurrent(top.target.id);
        },
        { rootMargin: "0px 0px -70% 0px" },
      );
      for (const heading of headings) visible.observe(heading);
    };

    queueMicrotask(read);
    const changes = new MutationObserver(read);
    changes.observe(content, { childList: true, subtree: true });
    onCleanup(() => {
      changes.disconnect();
      visible?.disconnect();
    });
  };

  return { entries, current, pick, watch };
}

/** One row of the Settings side menu, `md` height; a tab is `page`, a section `location`. */
export const NAV_ROW = cx(
  "flex h-12 items-center rounded-lg px-3 text-small no-underline transition-colors",
  "text-on-surface-tertiary hover:bg-button-tertiary-surface-hover hover:text-on-surface-secondary",
  "aria-[current]:font-medium aria-[current]:text-on-surface-primary",
);

/** The Preferences tab's section anchors, listed under its row in the side menu. */
export function SettingsNav(props: {
  readonly nav: ReturnType<typeof createSettingsNav>;
  /** Before the jump: bring the sections' tab forward if another is showing. */
  readonly onPick?: () => Promise<void>;
  /** False while another tab is showing: no section is "where you are". */
  readonly showing: boolean;
}) {
  return (
    <ul data-settings-sections>
      <For each={props.nav.entries()}>
        {(entry) => (
          <li>
            <a
              href={`#${entry.id}`}
              aria-current={
                props.showing && props.nav.current() === entry.id ? "location" : undefined
              }
              class={NAV_ROW}
              onClick={(event) => {
                event.preventDefault();
                props.nav.pick(entry.id);
                // The sections are hidden under another tab; jump once they show.
                void Promise.resolve(props.onPick?.()).then(() =>
                  requestAnimationFrame(() =>
                    document.getElementById(entry.id)?.scrollIntoView({ block: "start" }),
                  ),
                );
              }}
            >
              {entry.title}
            </a>
          </li>
        )}
      </For>
    </ul>
  );
}
