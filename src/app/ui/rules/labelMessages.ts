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
    case "bookName.manifest":
      return values.listed === ""
        ? m.book_names_mark_manifest_none({ short: values.short ?? "" })
        : m.book_names_mark_manifest({ listed: values.listed ?? "", short: values.short ?? "" });
    case "bookName.missing":
      return m.book_names_mark_missing();
    case "bookNames.differ": {
      const differ = Number(values.manifest ?? 0);
      const missing = Number(values.missing ?? 0);
      return [
        differ > 0 ? m.book_names_summary_manifest({ count: differ }) : "",
        missing > 0 ? m.book_names_summary_missing({ count: missing }) : "",
      ]
        .filter((part) => part !== "")
        .join("; ");
    }
    default:
      return finding.message;
  }
};
