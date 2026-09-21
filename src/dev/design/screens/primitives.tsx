/**
 * The primitive inventory, under dials.
 *
 * The first committed screen on purpose. It needs no project, no filesystem
 * and no scripture, so it is the one that proves the deployed design build
 * works at all — and it is the screen somebody polishing buttons and spacing
 * actually wants open.
 *
 * Every colour here is a semantic token, which is also why this screen is
 * worth having: a primitive that only looks right in one theme shows it
 * immediately when the whole inventory is on one page.
 */

import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Kbd,
  PanelHeader,
  Select,
  Switch,
} from "../../../app/ui/primitives";
import type { Screen } from "../screen";

const VARIANTS = ["primary", "secondary", "tertiary", "danger"] as const;
const TONES = ["neutral", "brand", "success", "warning", "error", "muted"] as const;

const Row = (props: { readonly label: string; readonly children: JSX.Element }) => (
  <div class="flex flex-wrap items-center gap-3">
    <span class="w-24 shrink-0 text-smallest text-on-surface-tertiary">{props.label}</span>
    {props.children}
  </div>
);

export const primitivesScreen: Screen = {
  id: "primitives",
  title: "Primitives",
  blurb: "Every primitive at once, so a token that only works in one theme shows itself.",
  // Shared tweaks: they mean the same thing whichever variant is showing, so
  // they survive the switch rather than resetting with it.
  tweaks: [
    { key: "size", label: "Size", kind: "choice", options: ["sm", "md"], initial: "md" },
    { key: "disabled", label: "Disabled", kind: "toggle" },
  ],
  variants: [
    {
      id: "cosy",
      label: "Cosy",
      tweaks: [{ key: "rule", label: "Dividers", kind: "toggle", initial: true }],
    },
    { id: "tight", label: "Tight" },
  ],
  view: (props) => {
    const size = () => (props.tweak("size") === "sm" ? "sm" : "md");
    const tight = () => props.variant() === "tight";
    const off = () => props.on("disabled");
    const ruled = () => props.variant() === "cosy" && props.on("rule");

    return (
      <div class={["space-y-6", tight() ? "p-3" : "p-6"]}>
        <Card>
          <PanelHeader title="Buttons" />
          <div
            class={[
              "space-y-3",
              tight() ? "p-3" : "p-4",
              ruled() ? "divide-y divide-surface-border" : "",
            ]}
          >
            <Row label="Variants">
              <For each={VARIANTS}>
                {(variant) => (
                  <Button variant={variant} size={size()} disabled={off()}>
                    {variant}
                  </Button>
                )}
              </For>
            </Row>
            <Row label="Pressed">
              <For each={VARIANTS}>
                {(variant) => (
                  <Button variant={variant} size={size()} aria-pressed="true" disabled={off()}>
                    {variant}
                  </Button>
                )}
              </For>
            </Row>
          </div>
        </Card>

        <Card>
          <PanelHeader title="Badges" />
          <div class={["flex flex-wrap gap-2", tight() ? "p-3" : "p-4"]}>
            <For each={TONES}>{(tone) => <Badge tone={tone}>{tone}</Badge>}</For>
          </div>
        </Card>

        <Card>
          <PanelHeader title="Fields" />
          <div
            class={[
              "space-y-3",
              tight() ? "p-3" : "p-4",
              ruled() ? "divide-y divide-surface-border" : "",
            ]}
          >
            <Row label="Input">
              <Input size={size()} placeholder="Placeholder" disabled={off()} />
            </Row>
            <Row label="Select">
              <Select size={size()} wrapperClass="w-48" disabled={off()}>
                <option>First</option>
                <option>Second</option>
              </Select>
            </Row>
            <Row label="Switch">
              {/* A static pair: this screen shows what the two states LOOK like,
                  so neither one moves. The dials above are where this screen is
                  driven from. */}
              <Switch checked onChange={() => {}} label="On" disabled={off()} />
              <Switch checked={false} onChange={() => {}} label="Off" disabled={off()} />
            </Row>
            <Row label="Keys">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </Row>
          </div>
        </Card>

        <Card>
          <PanelHeader title="Empty state" />
          <div class={tight() ? "p-3" : "p-4"}>
            <EmptyState
              title="Nothing here yet"
              description="What an empty panel says, and how much room it takes saying it."
            />
          </div>
        </Card>
      </div>
    );
  },
};
