import type { EditorWords, PhraseKey } from "@sefer/editor";

import { m } from "#app/paraglide/messages";

/** Each of the editor's UI phrases as a message, read when the editor draws it. */
const PHRASES: Readonly<Record<PhraseKey, (values: Readonly<Record<string, string>>) => string>> = {
  "chip.pageBreak": () => m.editor_chip_page_break(),
  "chip.publishedAs": () => m.editor_chip_published_as(),
  "attributes.hint": () => m.editor_attributes_hint(),
  "attributes.readOnly": () => m.editor_attributes_read_only(),
  "attributes.none": () => m.editor_attributes_none(),
  "attributes.keyLocked": () => m.editor_attributes_key_locked(),
  "verseMenu.changeNumber": () => m.editor_verse_menu_change_number(),
  "verseMenu.verseNumber": () => m.editor_verse_menu_verse_number(),
  "verseMenu.removeMarker": () => m.editor_verse_menu_remove_marker(),
  "verseMenu.addVerseAfter": () => m.editor_verse_menu_add_verse_after(),
  "verseLines.verse": () => m.editor_verse_label(),
  "verseLines.chapter": () => m.editor_chapter_label(),
  "emptyChapter.prompt": (values) => m.editor_empty_chapter_prompt({ title: values.title ?? "" }),
  "chapterWord.ask": (values) => m.editor_chapter_word_ask({ word: values.word ?? "" }),
  "chapterWord.book": () => m.editor_chapter_word_book(),
  "chapterWord.all": () => m.editor_chapter_word_all(),
  "bookName.placeholder": () => m.editor_book_name_placeholder(),
};

/** The editor's words in the interface language; a screen remounts when it changes. */
export const editorWords: EditorWords = { phrase: (key, values) => PHRASES[key](values) };
