/**
 * The primitive layer's one door.
 *
 * Screens import from here (`import { Button, Card } from "../app/ui/primitives"`)
 * and never from a file inside. That is what lets the corvu wrappers — Tooltip,
 * Popover, Dialog, Resizable — be the only files in the repository that import
 * corvu at all: see documentation/architecture/ui.md.
 */

export { Badge, severityTone, type BadgeProps, type BadgeTone } from "./Badge";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button";
export { Card, PanelHeader, type CardProps, type PanelHeaderProps } from "./Card";
export { cx, variants, type ClassValue } from "./cx";
export { Dialog, type DialogProps } from "./Dialog";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export {
  IconButton,
  type IconButtonProps,
  type IconButtonSize,
  type IconButtonVariant,
} from "./IconButton";
export { Input, type InputProps, type InputSize } from "./Input";
export { Kbd, type KbdProps } from "./Kbd";
export { Popover, type PopoverAlign, type PopoverProps, type PopoverSide } from "./Popover";
export {
  Resizable,
  type ResizableHandleProps,
  type ResizablePanelProps,
  type ResizableRootProps,
} from "./Resizable";
export { SegmentedControl, type Segment, type SegmentedControlProps } from "./SegmentedControl";
export { Select, type SelectProps, type SelectSize } from "./Select";
export { Switch, type SwitchProps } from "./Switch";
export {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type SortDirection,
  type TableHeaderProps,
} from "./Table";
export { Toaster } from "./Toaster";
export {
  VirtualList,
  type VirtualListProps,
  type VirtualRow,
  type VirtualSection,
} from "./VirtualList";
export { Tooltip, type TooltipProps, type TooltipSide } from "./Tooltip";
export * as toasts from "./toasts";
