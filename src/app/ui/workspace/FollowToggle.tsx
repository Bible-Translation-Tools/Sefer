import Link from "lucide-solid/icons/link";
import Unlink from "lucide-solid/icons/unlink";

import { IconButton } from "../primitives";

export function FollowToggle(props: {
  readonly following: boolean;
  readonly onToggle: () => void;
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
