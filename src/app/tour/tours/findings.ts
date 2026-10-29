import type { Tour, TourContext } from "../machine";

const onBookScreen = (): boolean => /\/project\/[^/]+\/book\//u.test(window.location.pathname);

const toEditor = (context: TourContext): void => {
  if (onBookScreen()) return;
  void context.navigate({
    to: "/project/$slug",
    params: { slug: context.shell.slug() },
    search: {},
  });
};

const toFindings = (context: TourContext): void => {
  void context.navigate({
    to: "/project/$slug/findings",
    params: { slug: context.shell.slug() },
    search: {},
  });
};

export const findingsTour: Tour = {
  id: "findings",
  kind: "tutorial",
  audience: "internal",
  title: "Working through findings",
  summary: "Where Sefer lists the problems it finds, and how to step through them.",
  needsProject: true,
  steps: [
    {
      go: toEditor,
      spotlight: {
        anchor: "[data-testid=app-bar-more]",
        title: "Findings",
        body: "Sefer checks the text as you work. Findings, in this menu, shows how many need attention in this project.",
      },
      advance: "user",
    },
    {
      go: toFindings,
      spotlight: {
        anchor: "[data-findings-count]",
        title: "Every finding, in one list",
        body: "This screen lists every finding in the project. Group them by book, or by kind to work through one kind of problem at a time.",
      },
      advance: "user",
    },
    {
      spotlight: {
        anchor: "[data-tour=findings-filters]",
        title: "Narrow the list",
        body: "Show only errors, one book, one kind, or findings whose text matches what you type.",
      },
      advance: "user",
    },
    {
      spotlight: {
        anchor: "[data-finding]",
        title: "A finding",
        body: "Each card shows the verse and says what looks wrong. When Sefer knows the repair, Fix offers it; otherwise edit the verse right here.",
      },
      advance: "user",
    },
    {
      spotlight: {
        anchor: "[data-findings-in]",
        title: "Walk the list from the keyboard",
        body: "↑ and ↓ move between cards. Enter opens the verse in the editor.",
      },
      advance: "user",
    },
    {
      go: (context) => context.run("findings.next"),
      ready: () => onBookScreen() && document.querySelector("[data-testid=app-bar-more]") !== null,
      spotlight: {
        anchor: "[data-testid=app-bar-more]",
        title: "Next finding, from the editor",
        body: "Sefer has just taken you to the next finding. Alt+F8 does that from anywhere in the editor, and Alt+Shift+F8 goes back one.",
      },
      advance: "user",
    },
  ],
};
