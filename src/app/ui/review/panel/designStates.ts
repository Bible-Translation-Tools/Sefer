import { trustedBy, type BookId } from "@wycliffeassociates/sefer-text/book";
import type { Source } from "@wycliffeassociates/sefer-text/source";
import { Effect, Option } from "effect";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";

import { setDesignStandIn, type RecordedStandIn } from "../../../designStandIn";
import type { Shell } from "../../../ProjectContext";
import type { Compare } from "./createCompare";
import type { Decisions } from "./createDecisions";
import type { ReviewRoute } from "./createReviewRoute";
import type { Sides } from "./createSides";
import type { Units } from "./createUnits";

/**
 * DESIGN SCAFFOLDING. A "Review state" choice in the design panel that puts
 * the REAL Review screen into each state it can reach, over the fixture
 * project only (`?fixture=1`): it edits the fixture's books in the editor (in
 * memory, never saved) and stands in for what only git and a forge supply.
 * Called only under `__SEFER_DESIGN__`; `pnpm lint:release` keeps it out of
 * preview and production.
 */

const STATES = ["live", "playground"] as const;
type State = (typeof STATES)[number];

/** One edit: the exact text (or a pattern) to find in the fixture book, and what it becomes. */
type Edit = readonly [find: string | RegExp, replace: string];

/** A whole line of one verse, its newline included: `$1` in a replacement. */
const verseLine = (verse: number): string => `(\\\\v ${verse} [^\\n]*\\n)`;
const lines = (...verses: number[]): RegExp => new RegExp(verses.map(verseLine).join(""), "u");

// Made-up edits over the fixture, covering what Review has to show: single
// words and whole verses replaced, added and removed; blocks added and taken
// out; paragraph, poetry and line-break markup; and verses both people edited.
// Jude carries the verse-marker cases: a verse deleted, renumbered, duplicated
// and transposed back into order, blank lines removed, and a marker swapped.

/** The version both last agreed on, before either person's edits: the "original". */
const BASE: Readonly<Record<string, readonly Edit[]>> = {
  JUD: [
    // Out of order: \v 4 before \v 3. My edit puts them back.
    [lines(3, 4), "$2$1"],
    // A second \v 18 where \v 19 belongs. My edit renumbers it.
    ["\\v 19 It is these", "\\v 18 It is these"],
    // Extra blank lines between \v 12 and \v 13. My edit removes them: whitespace only.
    ["\\v 13 They are violent", "\n\n\n\\v 13 They are violent"],
  ],
};

/** What I changed in the editor and have not saved. */
const MINE: Readonly<Record<string, readonly Edit[]>> = {
  PSA: [
    ["advice of the wicked", "counsel of the wicked"],
    ["But his delight", "But his great delight"],
    ["will not stand in the judgment", "will not stand in judgment"],
    [
      "\\v 1 Why are the nations in turmoil,\n\\q2 and why",
      "\\v 1 Why are the nations in turmoil, and why",
    ],
    ["\\q\n\\v 5 Then he will speak", "\\b\n\\q\n\\v 5 Then he will speak"],
    ["I will announce a decree of Yahweh.", "I will proclaim the decree of Yahweh."],
    [
      '\\v 2 Many say about me,\n\\q2 "There is no deliverance for him from God."',
      '\\v 2 So many are saying of me,\n\\q2 "God will never rescue him."',
    ],
  ],
  PHM: [
    [
      "\\v 11 For he once was useless to you, but now he is useful both to you and to me.",
      "\\v 11 Once he was of no use to you, but now he has become of great use, to you and to me alike.",
    ],
    [
      "\\s5\n\\v 10 I am appealing",
      "\\s5\n\\s1 Paul's appeal for Onesimus\n\\p\n\\v 10 I am appealing",
    ],
    [
      "who is my very heart.",
      "who is my very heart. Receive him as you would receive me, and do not hold against him what he did before. He has changed, and I have seen it with my own eyes.",
    ],
  ],
  "3JN": [
    [
      "So if I come, I will call attention to the deeds he is doing, falsely accusing us with wicked words. Not satisfied with that, he not only refuses to welcome the brothers himself, but he also stops those who want to welcome them and drives them out of the church.",
      "So if I come, I will call attention to the deeds he is doing.",
    ],
    ["\\v 3 For I rejoiced", "\\p\n\\v 3 For I rejoiced"],
    ["Greet our friends there by name.", ""],
  ],
  JUD: [
    [
      "May mercy and peace and love be multiplied to you.",
      "May mercy, peace and love be yours in abundance.",
    ],
    ["struggle earnestly", "contend"],
    // Transposed: back into order.
    [lines(4, 3), "$2$1"],
    // Renumbered: the second \v 18 becomes \v 19.
    ["\\v 18 It is these", "\\v 19 It is these"],
    // Duplicated: \v 5 twice.
    [lines(5), "$1$1"],
    // Whitespace only: the blank lines go.
    ["\n\n\n\\v 13 They are violent", "\\v 13 They are violent"],
    // USFM only: a paragraph becomes a flush-left paragraph, the words unchanged.
    ["\\s5\n\\p\n\\v 17", "\\s5\n\\m\n\\v 17"],
  ],
};

/** What somebody else changed in the shared project. */
const THEIRS: Readonly<Record<string, readonly Edit[]>> = {
  PSA: [
    ["streams of water", "rivers of water"],
    ["I will announce a decree of Yahweh.", "Let me tell of the decree of Yahweh."],
    ["\\q2 the Lord mocks them.", "\\q2 the Lord mocks them.\n\\q2 He laughs them to scorn."],
  ],
  PHM: [
    [
      "No longer would he be a slave, but better than a slave, a beloved brother. He is beloved especially to me, and much more so to you, in both the flesh and in the Lord.",
      "No longer a slave, but a beloved brother.",
    ],
    ["\\v 11 For he once was useless", "\\v 11 For he was once useless"],
  ],
  "3JN": [["with pen and ink", "with ink and pen"]],
  JUD: [
    [
      "May mercy and peace and love be multiplied to you.",
      "Mercy, peace, and love be multiplied to you all.",
    ],
    ["an example of those", "a warning of those"],
    // Whole verse deleted.
    [lines(22), ""],
    [
      "they slander the glorious ones.",
      "they slander the glorious ones.\n\\p\nThey walk after their own desires and boast about it, and they flatter others to gain an advantage. They are clouds without water, carried along by the winds.",
    ],
  ],
};

const editsOf = (text: string, edits: readonly Edit[] | undefined): string =>
  (edits ?? []).reduce((held, [find, replace]) => held.replace(find, replace), text);

const sharedRoute = (route: ReviewRoute): boolean =>
  untrack(route.search).against === "shared" && untrack(route.search).pull === undefined;

const withSharedRoute = (): string => {
  const url = new URL(location.href);
  url.searchParams.delete("pull");
  url.searchParams.delete("copy");
  url.searchParams.set("against", "shared");
  return url.toString();
};

interface DesignStatesInputs {
  readonly shell: Shell;
  readonly route: ReviewRoute;
  readonly sides: Sides;
  readonly compare: Compare;
  readonly units: Units;
  readonly decisions: Decisions;
  /** The Google Docs-style layout under trial: changes in the text, a card per change beside it. */
  readonly setLayout: (layout: ReviewLayout) => void;
}

const LAYOUTS = ["cards", "inline"] as const;
export type ReviewLayout = (typeof LAYOUTS)[number];

const recorded = (head: string, texts: ReadonlyMap<BookId, Source>): RecordedStandIn => ({
  head,
  texts,
});

/** Set each book's editor text, from whatever it holds now, as one whole-book edit. */
const setEditor = async (shell: Shell, texts: ReadonlyMap<BookId, string>): Promise<void> => {
  const project = shell.project();
  if (project === undefined) return;
  for (const [bookId, text] of texts) {
    const book = await shell.services.run(
      Effect.orElseSucceed(project.instantiate(bookId), () => undefined),
    );
    if (book === undefined) continue;
    const held = book.source().text;
    if (held === text) continue;
    book.apply({ from: 0, to: held.length, insert: text }, "compare", trustedBy("design"));
  }
};

export function designReviewStates(inputs: DesignStatesInputs): void {
  const { shell, route, sides, decisions } = inputs;
  const [state, setState] = createSignal<State>("live", {
    name: "designReviewState",
    ownedWrite: true,
  });

  const fixture = (): boolean => {
    const project = shell.project();
    return project !== undefined && project.root === shell.services.fixtureProject;
  };

  const apply = async (): Promise<void> => {
    const project = shell.project();
    if (project === undefined || !fixture()) return;
    if (!sharedRoute(route)) {
      location.assign(withSharedRoute());
      return;
    }
    const base = new Map<BookId, Source>();
    for (const listed of project.books) {
      const book = project.book(listed.id);
      if (book === undefined) continue;
      const found = Option.getOrUndefined(shell.services.save.baseline(book));
      if (found !== undefined)
        base.set(listed.id, {
          text: editsOf(found.text, BASE[listed.id]),
          stamp: found.stamp,
          form: book.source().form,
        });
    }
    const theirs = new Map(
      [...base].map(([bookId, source]) => [
        bookId,
        { ...source, text: editsOf(source.text, THEIRS[bookId]) },
      ]),
    );
    setDesignStandIn({
      shared: recorded("design-shared", theirs),
      base: recorded("design-base", base),
      author: "Batman",
      editor: "Robin",
    });
    await setEditor(
      shell,
      new Map([...base].map(([bookId, source]) => [bookId, editsOf(source.text, MINE[bookId])])),
    );
    sides.seeShared();
    decisions.startOver();
  };

  createEffect(
    () => ({ chosen: state(), project: shell.project() }),
    ({ chosen, project }) => {
      if (chosen === "live" || project === undefined) return;
      void apply();
    },
  );

  let release: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tries = 0;
  const attempt = (): void => {
    // SAFETY: the design surface installs `register` with exactly this shape (`src/dev/designSurface.ts`), and only in a design build; anything else reads as absent.
    const design = globalThis.__sefer?.design as
      | {
          readonly register?: (registration: {
            readonly namespace: string;
            readonly tweaks: readonly {
              readonly key: string;
              readonly label: string;
              readonly kind: "choice";
              readonly options: readonly string[];
            }[];
            readonly onChange: (values: Readonly<Record<string, string>>) => void;
          }) => () => void;
        }
      | undefined;
    if (design?.register === undefined) {
      tries += 1;
      timer = setTimeout(attempt, tries < 100 ? 50 : 500);
      return;
    }
    release = design.register({
      namespace: "review",
      tweaks: [
        { key: "state", label: "Review state", kind: "choice", options: STATES },
        { key: "layout", label: "Layout", kind: "choice", options: LAYOUTS },
      ],
      onChange: (values) => {
        const layout = values["review.layout"] ?? "cards";
        inputs.setLayout(LAYOUTS.find((each) => each === layout) ?? "cards");
        const chosen = values["review.state"] ?? "live";
        setState(STATES.find((each) => each === chosen) ?? "live");
      },
    });
  };
  attempt();
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
    release?.();
    setDesignStandIn({});
  });
}
