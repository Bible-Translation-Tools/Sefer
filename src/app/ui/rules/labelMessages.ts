import { m } from "#app/paraglide/messages";
import type { Finding } from "#core/findings/finding";
import { render } from "#core/findings/messages";

import { sousWords } from "../../sousWords";
import { usfmSentence } from "../panels/usfmWords";

/**
 * A finding's headline in the interface language. The USFM engine's findings
 * and Sefer's own rules carry their message's values and are worded here; a
 * Sous finding from its `described` message, in Sefer's Sous catalog.
 */
export const findingMessage = (finding: Finding): string => {
  const values = finding.values ?? {};
  if (finding.producer === "onion") return usfmSentence(finding.code, values) ?? finding.message;
  if (finding.described !== undefined) return render(finding.described, "headline", sousWords());
  switch (finding.code) {
    case "chapterLabel.word":
      return m.chapter_labels_mark_word({
        word: values.word ?? "",
        expected: values.expected ?? "",
      });
    case "chapterLabel.number":
      return m.chapter_labels_mark_number({
        text: values.text ?? "",
        chapter: values.chapter ?? "",
      });
    case "chapterLabels.differ":
      return m.chapter_labels_summary({
        count: Number(values.count ?? 0),
        words: Number(values.words ?? 0),
        books: Number(values.books ?? 0),
      });
    default:
      return finding.message;
  }
};
