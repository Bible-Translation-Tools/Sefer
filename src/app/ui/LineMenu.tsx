import type { JSX } from "@solidjs/web";
import type { BookEditorMount, LineKind } from "@wycliffeassociates/sefer-editor";
import Captions from "lucide-solid/icons/captions";
import Heading from "lucide-solid/icons/heading";
import Link2 from "lucide-solid/icons/link-2";
import Pilcrow from "lucide-solid/icons/pilcrow";
import TextAlignStart from "lucide-solid/icons/text-align-start";
import TextQuote from "lucide-solid/icons/text-quote";
import UserRound from "lucide-solid/icons/user-round";
import { For, Show, createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";

import { Button, IconButton, Input, Menu, MenuSeparator } from "./primitives";
import { nameBlock } from "./workspace/blockNames";

/** Where the menu was asked for: the press's point, and the line under it. */
export interface LineMenuAt {
  readonly x: number;
  readonly y: number;
  readonly offset: number;
  readonly line: LineKind;
}

/** A poetry level's icon: the quote mark with its level beside it. */
const poetryIcon = (level: string): JSX.Element => (
  <span class="relative inline-flex">
    <TextQuote size={20} />
    <span class="absolute -end-1.5 -bottom-1.5 text-[0.625rem] leading-none font-semibold">
      {level}
    </span>
  </span>
);

const ICONS: Readonly<Record<string, () => JSX.Element>> = {
  p: () => <Pilcrow />,
  m: () => <TextAlignStart />,
  s: () => <Heading />,
  s1: () => <Heading />,
  r: () => <Link2 />,
  d: () => <Captions />,
  sp: () => <UserRound />,
};
const iconFor = (kind: string): JSX.Element => {
  const poetry = /^q([1-4]?)$/.exec(kind);
  if (poetry !== null) return poetryIcon(poetry[1] === "" ? "1" : (poetry[1] ?? "1"));
  return (ICONS[kind] ?? (() => <Pilcrow />))();
};

/** The kinds Sefer supports from this menu (SEFER-72); anything else is not shown. */
const SUPPORTED = /^(p|m|q[1-4]?|s1?|r|d|sp)$/;

/**
 * The editor's right-click menu, after Notion's, the same with or without a
 * selection: only what it changes differs. A grid of the kinds this line can
 * be, an icon each with its name as a tooltip, its own pressed; over a
 * selection a kind turns every line it covers, without one the verse under
 * the press. Then a footnote field.
 */
export function LineMenu(props: {
  readonly editor: BookEditorMount;
  readonly at: LineMenuAt;
  readonly onClose: () => void;
}) {
  const [note, setNote] = createSignal("", { name: "lineMenuNote" });
  const close = (): void => {
    props.onClose();
    props.editor.focus();
  };
  const kinds = (): readonly string[] =>
    props.at.line.choices.filter((kind) => SUPPORTED.test(kind));
  // Whether the press was on the selection: then the menu acts on it, else on the press.
  const overSelection = (): { readonly from: number; readonly to: number } | undefined => {
    const range = props.editor.selectionRange();
    return range.from < range.to && props.at.offset >= range.from && props.at.offset <= range.to
      ? range
      : undefined;
  };
  const turn = (kind: string): void => {
    const over = overSelection();
    if (over !== undefined) props.editor.turnLineInto(over.from, kind, over.to);
    else props.editor.turnLineInto(props.at.offset, kind);
    close();
  };

  const addNote = (): void => {
    props.editor.addFootnote(note(), overSelection() === undefined ? props.at.offset : undefined);
    close();
  };

  return (
    <div class="fixed z-50" style={{ left: `${props.at.x}px`, top: `${props.at.y}px` }}>
      <Menu
        label={m.line_menu_label()}
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
        side="bottom"
        align="start"
        fitViewport
        class="w-72"
        trigger={<span class="block size-px" aria-hidden="true" />}
      >
        <Show
          when={kinds().length > 0}
          fallback={
            <p class="px-3 pb-2 text-small text-on-surface-secondary">{m.line_menu_fixed()}</p>
          }
        >
          <div class="grid grid-cols-5 gap-1 px-2" data-line-kinds>
            <For each={kinds()}>
              {(kind) => (
                <IconButton
                  data-testid={`line-menu-${kind}`}
                  label={nameBlock(kind)}
                  icon={iconFor(kind)}
                  aria-pressed={kind === props.at.line.kind ? "true" : "false"}
                  onClick={() => turn(kind)}
                />
              )}
            </For>
          </div>
        </Show>

        <MenuSeparator />

        <form
          class="flex gap-2 px-2"
          onSubmit={(event) => {
            event.preventDefault();
            addNote();
          }}
        >
          <Input
            aria-label={m.line_menu_footnote_placeholder()}
            placeholder={m.line_menu_footnote_placeholder()}
            value={note()}
            onInput={(event) => setNote(event.currentTarget.value)}
            wrapperClass="min-w-0 flex-1"
            data-testid="line-menu-footnote-text"
          />
          <Button type="submit" data-testid="line-menu-footnote">
            {m.line_menu_footnote_add()}
          </Button>
        </form>
      </Menu>
    </div>
  );
}
