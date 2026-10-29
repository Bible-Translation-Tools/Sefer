import { m } from "#app/paraglide/messages";
import type { Finding } from "#core/findings/finding";

/**
 * A finding's headline in the interface language. Sefer's own rules
 * (producer `project`) carry their message's values and are worded here;
 * every other finding keeps its own.
 */
export const findingMessage = (finding: Finding): string => {
  const values = finding.values ?? {};
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
