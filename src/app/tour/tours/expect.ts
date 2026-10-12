import type { Tour, TourContext } from "../machine";

/**
 * Expect, shown on a real translation: the Bisa Bible (`leb-x-bisa`),
 * searched through its English source text for "Jesus", expecting "Yesu".
 *
 * The point is the primitive, not the screen. Find gives places, alignment
 * gives the verse in both texts, and expect is the assertion "where the source
 * says A, my text says B", which narrows over a thousand verses to the few
 * dozen a person has to judge. Among those are real slips in that text:
 * "Yesa" at Matthew 27:58 and "Ysu" at John 14:6. No spell checker knows Bisa,
 * and none was needed.
 *
 * It starts from a share link (`start`), so it opens the Bisa project on any
 * device, downloading it first where it is not there yet. Strings are raw and
 * translated where they are drawn.
 */

const find = (context: TourContext, expect: string | undefined): void => {
  void context.navigate({
    to: "/project/$slug/find",
    params: { slug: context.shell.slug() },
    search: { q: "Jesus", scope: "reference", ...(expect === undefined ? {} : { expect }) },
  });
};

/** Clicks the first match of `selector` once it exists, for up to 3 s. */
const clickWhen = (selector: string): void => {
  const started = Date.now();
  const attempt = (): void => {
    const element = document.querySelector<HTMLElement>(selector);
    if (element !== null) element.click();
    else if (Date.now() - started < 3000) setTimeout(attempt, 100);
  };
  attempt();
};

/** The results outline's chapter chip in one book, opening the book first. */
const toChapter = (book: string, chapter: string): void => {
  const row = `[data-outline="${book}"]`;
  const chip = `li:has(> ${row}) [data-chapter-hits="${chapter}"]`;
  if (document.querySelector(chip) === null) clickWhen(row);
  clickWhen(chip);
};

const results = (): boolean => {
  const count = document.querySelector("[data-count]")?.getAttribute("data-count");
  return count !== undefined && count !== null && count !== "0";
};

export const expectTour: Tour = {
  id: "expect",
  title: "Expect: catching spelling slips (Bisa demo)",
  summary:
    "Where the source says “Jesus”, a Bisa translation should say “Yesu”. Sefer shows the verses that do not.",
  needsProject: true,
  start: "/r/Will_Kelly/leb-x-bisa_reg/find?q=Jesus&scope=reference",
  steps: [
    {
      go: (context) => find(context, undefined),
      ready: results,
      // The first search waits on the English source text registering, and on
      // a first visit on its download too.
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
