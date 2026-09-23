/**
 * The rule order, as data: admission → normalization → protection → settlement
 * (seams §3.4).
 *
 * Two of CodeMirror's hooks are involved, and they run in opposite directions;
 * `compose.install` is the only place that knows it. Naming every rule and
 * listing them in one array is what makes `omit` possible, what lets a trace say
 * which door a keystroke went through, and what makes the order reviewable
 * without reading the implementations.
 */

import { settleTheCaretOnALegalPosition } from "./caret";
import { pullSelectionsIntoTheClip, refuseEditsOutsideTheClip } from "./clip";
import { deleteMarkersWholeOrNotAtAll } from "./deletion";
import { PAINT_PORT, caretClipAt, editableClipAt, planAt, structureAt } from "./editorState";
import {
  keepPoetryMarkersAtTheStartOfTheirLine,
  refuseATypedBackslash,
  refuseMarkupPastedInsideAWord,
  refusePastesThatWouldAddAChapter,
  supplyTheDelimiterAMarkerIsMissing,
} from "./input";
import type { ChangeRule, TransactionRule } from "./kernel";
import { refuseKeystrokesInsideHiddenMarkup } from "./sealed";

export interface ParserPort {
  marksUp: (doc: string, from: number, to: number) => boolean;
  chapterCount: (doc: string) => number;
}

const PHASE_ORDER = ["admission", "normalization", "protection", "settlement"] as const;

export type Phase = (typeof PHASE_ORDER)[number];

export const HOOK: Record<Phase, "change" | "transaction"> = {
  admission: "change",
  normalization: "transaction",
  protection: "transaction",
  settlement: "transaction",
};

export interface PhaseRule {
  readonly phase: Phase;
  readonly name: string;
  readonly rule: (parser: ParserPort) => ChangeRule | TransactionRule;
}

export const PHASES = [
  {
    phase: "admission",
    name: "refuseEditsOutsideTheClip",
    rule: () => refuseEditsOutsideTheClip(editableClipAt),
  },
  {
    phase: "admission",
    name: "refuseKeystrokesInsideHiddenMarkup",
    rule: () => refuseKeystrokesInsideHiddenMarkup(structureAt, planAt, PAINT_PORT),
  },
  {
    phase: "normalization",
    name: "supplyTheDelimiterAMarkerIsMissing",
    rule: () => supplyTheDelimiterAMarkerIsMissing(structureAt),
  },
  {
    phase: "normalization",
    name: "refuseATypedBackslash",
    rule: () => refuseATypedBackslash(),
  },
  {
    phase: "normalization",
    name: "refusePastesThatWouldAddAChapter",
    rule: (parser: ParserPort) =>
      refusePastesThatWouldAddAChapter(structureAt, parser.chapterCount),
  },
  {
    phase: "normalization",
    name: "refuseMarkupPastedInsideAWord",
    rule: (parser: ParserPort) => refuseMarkupPastedInsideAWord(structureAt, parser.marksUp),
  },
  {
    phase: "normalization",
    name: "keepPoetryMarkersAtTheStartOfTheirLine",
    rule: () => keepPoetryMarkersAtTheStartOfTheirLine(structureAt),
  },
  {
    phase: "protection",
    name: "deleteMarkersWholeOrNotAtAll",
    rule: () => deleteMarkersWholeOrNotAtAll(structureAt, planAt),
  },
  {
    phase: "settlement",
    name: "settleTheCaretOnALegalPosition",
    rule: () => settleTheCaretOnALegalPosition(structureAt, PAINT_PORT),
  },
  {
    phase: "settlement",
    name: "pullSelectionsIntoTheClip",
    rule: () => pullSelectionsIntoTheClip(caretClipAt),
  },
] as const satisfies readonly PhaseRule[];

export type RuleName = (typeof PHASES)[number]["name"];
