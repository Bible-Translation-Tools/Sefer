import type { Tour, TourContext } from "../machine";

const find = (context: TourContext, expect: string | undefined): void => {
  void context.navigate({
    to: "/project/$slug/find",
    params: { slug: context.shell.slug() },
    search: { q: "Jesus", scope: "reference", ...(expect === undefined ? {} : { expect }) },
  });
};

const clickWhen = (selector: string): void => {
  const started = Date.now();
  const attempt = (): void => {
    const element = document.querySelector<HTMLElement>(selector);
    if (element !== null) element.click();
    else if (Date.now() - started < 3000) setTimeout(attempt, 100);
  };
  attempt();
};

const toChapter = (book: string, chapter: string): void => {
  const row = `[data-outline="${book}"]`;
  const chip = `li:has(> ${row}) [data-chapter-hits="${chapter}"]`;
  if (document.querySelector(chip) === null) clickWhen(row);
  clickWhen(chip);
};

const EXPECT_TOGGLE = "[data-tour=find-expect-toggle] [role=switch]";
const expectOn = (): boolean =>
  document.querySelector(EXPECT_TOGGLE)?.getAttribute("aria-checked") === "true";

const results = (): boolean => {
  const count = document.querySelector("[data-count]")?.getAttribute("data-count");
  return count !== undefined && count !== null && count !== "0";
};

export const expectTour: Tour = {
  id: "expect",
  kind: "tutorial",
  title: "Expect: catching spelling slips (Bisa demo)",
  summary:
    "Where the source says “Jesus”, a Bisa translation should say “Yesu”. Sefer shows the verses that do not.",
  needsProject: true,
  start:
    "/r/Will_Kelly/leb-x-bisa_reg/find?q=Jesus&scope=reference&host=content.bibletranslationtools.org",
  steps: [
    {
      go: (context) => find(context, undefined),
      ready: results,
      timeoutMs: 60_000,
      spotlight: {
        anchor: "[data-tour=find-search]",
        title: "Find, in the source text",
        body: "This is the Bisa Bible. Sefer is searching its English source text for “Jesus”, not the Bisa, and shows each verse it found beside the Bisa verse. Same verse, two texts: that is alignment.",
      },
      advance: "user",
    },
    {
      spotlight: {
        anchor: "[data-count]",
        title: "Over a thousand verses",
        body: "Checking by eye how the name was spelled in each of these is days of work, and the few slips hide among hundreds of correct ones.",
      },
      advance: "user",
    },
    {
      go: () => {
        if (!expectOn()) clickWhen(EXPECT_TOGGLE);
      },
      ready: expectOn,
      spotlight: {
        anchor: "[data-tour=find-expect-toggle]",
        title: "Turn on Expect",
        body: "Expect is a tool you turn on when you have a rendering to check. It stays out of the way otherwise; this switch shows it.",
      },
      advance: "user",
    },
    {
      go: (context) => find(context, "Yesu"),
      ready: () => document.querySelector("[data-tour=find-expect-split]") !== null,
      spotlight: {
        anchor: "[data-tour=find-expect]",
        title: "Expect",
        body: "So say what the Bisa should read where the English says “Jesus”: “Yesu”. That is the whole primitive, an assertion over aligned verses: where the source says A, expect B.",
      },
      advance: "user",
    },
    {
      spotlight: {
        anchor: "[data-tour=find-expect-split]",
        title: "The split",
        body: "Most verses say “Yesu” and need nothing. The few dozen that do not are the whole list to check, and they are what the cards below show.",
      },
      advance: "user",
    },
    {
      go: () => toChapter("MAT", "27"),
      spotlight: {
        anchor: '[data-sid="MAT 27:58"]',
        title: "A slip",
        body: "Matthew 27:58: the translator typed “Yesa”. No spell checker knows Bisa. Expect found it because the source says “Jesus” in this verse. Edit fixes it right here.",
      },
      advance: "user",
    },
    {
      go: () => toChapter("JHN", "14"),
      spotlight: {
        anchor: '[data-sid="JHN 14:6"]',
        title: "Another",
        body: "John 14:6: “Ysu”, a letter dropped. Others in this list: “Yessu”, “Yesiu”, “Yes”.",
      },
      advance: "user",
    },
    {
      go: () => toChapter("MAT", "8"),
      spotlight: {
        anchor: '[data-sid="MAT 8:16"]',
        title: "Not every miss is a mistake",
        body: "Matthew 8:16 says “ena”, “he”, where the English names Jesus. That was the translator's choice. Expect does not decide; it turns over a thousand verses into a few dozen for a person to judge.",
      },
      advance: "user",
    },
    {
      spotlight: {
        anchor: "[data-tour=find-expect]",
        title: "Any settled rendering",
        body: "The same works for any key term, place name or divine name, in any script. “a + n + g” means those letters in order within one word, for languages that insert vowels.",
      },
      advance: "user",
    },
  ],
};
