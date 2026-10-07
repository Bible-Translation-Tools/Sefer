/**
 * Follow, or hold still: the chain that links one editor's place to another's.
 *
 * One button for every pair that can be aligned — a reference pane beside the
 * book, Review's two texts — so "linked" looks and reads the same wherever two
 * texts are side by side. Linked, scrolling either one brings the same verse
 * into the other (`createAlignedGroup`); unlinked, each holds still.
 */

import Link from "lucide-solid/icons/link";
import Unlink from "lucide-solid/icons/unlink";

import { IconButton } from "../primitives";

export function FollowToggle(props: {
  readonly following: boolean;
  readonly onToggle: () => void;
  /** What pressing it does, in each state: "Stop Greek following the book". */
  readonly stopLabel: string;
  readonly startLabel: string;
  readonly testId?: string;
  readonly tooltipSide?: "left" | "bottom";
}) {
  return (
    <IconButton
      size="sm"
      data-testid={props.testId}
      data-following={props.following ? "" : undefined}
      label={props.following ? props.stopLabel : props.startLabel}
      tooltipSide={props.tooltipSide ?? "left"}
      icon={props.following ? <Link /> : <Unlink />}
      onClick={() => props.onToggle()}
    />
  );
}
