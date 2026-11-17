import type { JSX } from "@solidjs/web";
import type { BookEditorMount, EditorAction, LineKind } from "@wycliffeassociates/sefer-editor";
import Bookmark from "lucide-solid/icons/bookmark";
import Captions from "lucide-solid/icons/captions";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Heading1 from "lucide-solid/icons/heading-1";
import MessageCirclePlus from "lucide-solid/icons/message-circle-plus";
import MessageSquareQuote from "lucide-solid/icons/message-square-quote";
import Search from "lucide-solid/icons/search";
import TextAlignJustify from "lucide-solid/icons/text-align-justify";
import { For, Show, createSignal, onCleanup, untrack } from "solid-js";

import { m } from "#app/paraglide/messages";
import { useShell } from "#app/ProjectContext";

import { openFind } from "./find/findState";
import { Button, Input, Menu, MenuItem, MenuRadio, cx, toasts } from "./primitives";
import { nameBlock } from "./workspace/blockNames";

/** Where the menu was asked for: the press's point, and the line under it. */
export interface LineMenuAt {
  readonly x: number;
  readonly y: number;
  readonly offset: number;
  readonly line: LineKind;
}

/** Lucide's frame, for the menu's own icons Lucide has no match for. */
const Glyph = (props: { readonly children: JSX.Element }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    {props.children}
  </svg>
);

/** Poetry levels and Add paragraph: Thomas's drawings (2026-11-13), on Lucide's frame. */
const POETRY_DIGIT: Readonly<Record<"1" | "2", string>> = {
  "1": "M5 7L8 5V13",
  "2": "M9 12H5C5 10.2854 5.442 9.7139 6.5 9.14237C7.558 8.57084 9 7.80957 9 6.28702C9 5.7475 8.83 5.22399 8.516 4.81249C8.19605 4.39878 7.76134 4.12346 7.28483 4.03272C6.80833 3.94197 6.31901 4.04133 5.899 4.31412C5.479 4.58731 5.161 5.01595 5 5.52575",
};

const PoetryIcon = (props: { readonly level: "1" | "2" }) => (
  <Glyph>
    <path d="M15 5H21M15 12H21M3 19H21" />
    <path d={POETRY_DIGIT[props.level]} />
  </Glyph>
);

const ParagraphIcon = () => (
  <Glyph>
    <path d="M3 5H21M3 19H21M11 12H21" />
    <path d="M3 9L6 12L3 15" />
  </Glyph>
);

/** A line break: a line, a gap, the next line. */
const LineBreakIcon = () => (
  <Glyph>
    <path d="M3 5h18M3 19h18" />
  </Glyph>
);

type GroupId = "content" | "titles" | "spacing";

/**
 * The editor's right-click menu (Thomas, 2026-11-13): Find for selected
 * words, then three groups as an accordion, one open at a time, Content open
 * first. A line kind turns the verse under the press, or every line a
 * selection covers, and is shown but off where the line cannot be it; the
 * Spacing rows add a line at the press.
 */
export function LineMenu(props: {
  readonly editor: BookEditorMount;
  readonly at: LineMenuAt;
  readonly onClose: () => void;
}) {
  const shell = useShell();
  const [open, setOpen] = createSignal<GroupId>("content", { name: "lineMenuGroup" });
  const [noting, setNoting] = createSignal(false, { name: "lineMenuNoting" });
  const [note, setNote] = createSignal("", { name: "lineMenuNote" });
  // A right-click does not move the caret; focus going back to the editor
  // would scroll to wherever the caret was. So it goes to the press first,
  // which is on screen, unless the menu acted on a selection or set the caret.
  const close = (): void => {
    if (overSelection() === undefined) props.editor.placeCaret(props.at.offset);
    props.onClose();
    props.editor.focus();
  };

  // Read once, at opening: the words selected then, without the USFM among them.
  const picked = untrack(() => props.editor.selectedText())
    .replaceAll(/\\[vc]\s+\S+/g, " ")
    .replaceAll(/\\\+?[a-z]+\d*\*?/gi, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  const find = (): void => {
    props.onClose();
    const book = shell.focused();
    const range = props.editor.selectionRange();
    openFind(picked, book === undefined ? undefined : { bookId: book.id, offset: range.from });
  };

  // Whether the press was on the selection: then the menu acts on it, else on the press.
  const overSelection = (): { readonly from: number; readonly to: number } | undefined => {
    const range = props.editor.selectionRange();
    return range.from < range.to && props.at.offset >= range.from && props.at.offset <= range.to
      ? range
      : undefined;
  };
  /** The marker a kind is written with here (`q` or `q1`, `s` or `s1`); undefined where the line cannot be it. */
  const markerOf = (markers: readonly string[]): string | undefined =>
    markers.find((marker) => props.at.line.choices.includes(marker));
  const turn = (markers: readonly string[]): void => {
    const marker = markerOf(markers);
    if (marker === undefined) return;
    const over = overSelection();
    if (over !== undefined) props.editor.turnLineInto(over.from, marker, over.to);
    else props.editor.turnLineInto(props.at.offset, marker);
    close();
  };
  const add = (action: EditorAction): void => {
    props.onClose();
    props.editor.performAt(props.at.offset, action);
    props.editor.focus();
  };
  const wordsOfJesus = (): void => {
    const over = overSelection();
    const done =
      over === undefined
        ? props.editor.styleWords("wj", props.at.offset, props.at.offset)
        : props.editor.styleWords("wj", over.from, over.to);
    if (!done) toasts.error({ title: m.line_menu_style_fails() });
    // The style put the caret in its pair; keep it there.
    props.onClose();
    props.editor.focus();
  };
  const addNote = (): void => {
    props.editor.addFootnote(note(), overSelection() === undefined ? props.at.offset : undefined);
    close();
  };

  const KindRow = (row: {
    readonly markers: readonly string[];
    readonly icon: JSX.Element;
    readonly label: string;
  }) => (
    <MenuRadio
      data-testid={`line-menu-${row.markers[0] ?? ""}`}
      icon={row.icon}
      checked={row.markers.includes(props.at.line.kind)}
      disabled={markerOf(row.markers) === undefined}
      title={markerOf(row.markers) === undefined ? m.line_menu_needs_own_line() : undefined}
      onSelect={() => turn(row.markers)}
    >
      {row.label}
    </MenuRadio>
  );

  /** A group's header and its rows, which open and close with a short slide. */
  const Group = (group: {
    readonly id: GroupId;
    readonly label: string;
    readonly count: number;
    readonly children: JSX.Element;
  }) => (
    <div data-line-menu-group={group.id}>
      <button
        type="button"
        role="menuitem"
        tabindex={-1}
        aria-expanded={open() === group.id ? "true" : "false"}
        data-testid={`line-menu-group-${group.id}`}
        class="flex min-h-12 w-full cursor-pointer items-center justify-between p-3 text-small font-semibold text-on-surface-primary outline-none hover:bg-surface-secondary focus-visible:bg-surface-secondary"
        onClick={() => setOpen(group.id)}
      >
        {`${group.label} (${group.count})`}
        <ChevronDown
          size={20}
          aria-hidden="true"
          class={cx(
            "transition-transform duration-200 ease-out motion-reduce:transition-none",
            open() === group.id && "rotate-180",
          )}
        />
      </button>
      <div
        class={cx(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open() === group.id ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
        inert={open() !== group.id}
      >
        <div class="min-h-0 overflow-hidden">{group.children}</div>
      </div>
    </div>
  );

  return (
    <div class="fixed z-50" style={{ left: `${props.at.x}px`, top: `${props.at.y}px` }}>
      <Show
        when={!noting()}
        fallback={<FootnoteCard note={note()} onInput={setNote} onAdd={addNote} onCancel={close} />}
      >
        <Menu
          label={m.line_menu_label()}
          open
          restoreFocus={false}
          onOpenChange={(next) => {
            // Swapping to the footnote card closes the menu; that is not a dismissal.
            if (!next && !noting()) close();
          }}
          side="bottom"
          align="start"
          fitViewport
          class="max-h-[80vh] w-80 overflow-y-auto [&_[role^=menuitem]]:font-semibold"
          trigger={<span class="block size-px" aria-hidden="true" />}
        >
          {/* Only over selected words: the panel's "Search words…" box is the way in otherwise. */}
          <Show when={picked !== ""}>
            <MenuItem data-testid="line-menu-find" icon={<Search size={20} />} onSelect={find}>
              <span class="min-w-0 flex-1 truncate text-start">
                {m.line_menu_find({ text: picked })}
              </span>
            </MenuItem>
          </Show>

          <Group id="content" label={m.line_menu_content()} count={5}>
            <MenuItem
              data-testid="line-menu-verse"
              icon={<Bookmark size={20} />}
              onSelect={() => {
                props.onClose();
                props.editor.addVerseAfter(props.at.offset);
              }}
            >
              {m.line_menu_verse()}
            </MenuItem>
            <KindRow
              markers={["q1", "q"]}
              icon={<PoetryIcon level="1" />}
              label={nameBlock("q1")}
            />
            <KindRow markers={["q2"]} icon={<PoetryIcon level="2" />} label={nameBlock("q2")} />
            <MenuItem
              data-testid="line-menu-style-wj"
              icon={<MessageSquareQuote size={20} />}
              onSelect={wordsOfJesus}
            >
              {m.line_menu_style_wj()}
            </MenuItem>
            {/* Footnote trades the menu for its own popover, in the same place. */}
            <button
              type="button"
              role="menuitem"
              tabindex={-1}
              aria-haspopup="dialog"
              data-testid="line-menu-footnote-open"
              class="flex min-h-12 w-full cursor-pointer items-center gap-3 p-3 text-start text-small font-semibold text-on-surface-primary outline-none hover:bg-surface-secondary focus-visible:bg-surface-secondary"
              onClick={() => setNoting(true)}
            >
              <MessageCirclePlus size={20} aria-hidden="true" />
              {m.line_menu_footnote()}
            </button>
          </Group>

          <Group id="titles" label={m.line_menu_titles()} count={2}>
            <KindRow markers={["d"]} icon={<Captions size={20} />} label={nameBlock("d")} />
            <KindRow markers={["s1", "s"]} icon={<Heading1 size={20} />} label={nameBlock("s1")} />
          </Group>

          <Group id="spacing" label={m.line_menu_spacing()} count={3}>
            <For
              each={
                [
                  {
                    action: "insert.paragraph",
                    icon: () => <ParagraphIcon />,
                    label: () => m.line_menu_add_paragraph(),
                  },
                  {
                    action: "insert.lineBreak",
                    icon: () => <LineBreakIcon />,
                    label: () => m.line_menu_add_line_break(),
                  },
                  {
                    action: "insert.margin",
                    icon: () => <TextAlignJustify size={20} />,
                    label: () => m.line_menu_add_margin(),
                  },
                ] as const
              }
            >
              {(row) => (
                <MenuItem
                  data-testid={`line-menu-${row.action}`}
                  icon={row.icon()}
                  onSelect={() => add(row.action)}
                >
                  {row.label()}
                </MenuItem>
              )}
            </For>
          </Group>
        </Menu>
      </Show>
    </div>
  );
}

/**
 * The Add footnote card (Thomas, 2026-11-13), where the menu was. A plain
 * card the menu owns rather than a second popover: swapping one floating
 * layer for another raced over focus and over the page's pointer lock.
 * Escape or a press outside cancels.
 */
function FootnoteCard(props: {
  readonly note: string;
  readonly onInput: (text: string) => void;
  readonly onAdd: () => void;
  readonly onCancel: () => void;
}) {
  let card: HTMLFormElement | undefined;
  const outside = (event: PointerEvent): void => {
    const target = event.target;
    if (card !== undefined && target instanceof Node && !card.contains(target)) props.onCancel();
  };
  // After the press that opened it, so that press is not taken for one outside.
  const timer = setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
  onCleanup(() => {
    clearTimeout(timer);
    document.removeEventListener("pointerdown", outside, true);
  });
  const empty = (): boolean => props.note.trim() === "";
  return (
    <form
      ref={(element) => {
        card = element;
        requestAnimationFrame(() => element.querySelector("input")?.focus());
      }}
      role="dialog"
      aria-label={m.line_menu_footnote_title()}
      data-testid="footnote-popover"
      class="w-[min(420px,92vw)] space-y-3 rounded-[12px] border border-surface-border bg-surface-primary p-4 text-small text-on-surface-primary shadow-large"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        props.onCancel();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty()) props.onAdd();
      }}
    >
      <h2 class="text-h4 font-semibold">{m.line_menu_footnote_title()}</h2>
      <Input
        aria-label={m.line_menu_footnote_placeholder()}
        placeholder={m.line_menu_footnote_placeholder()}
        value={props.note}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        wrapperClass="w-full"
        data-testid="line-menu-footnote-text"
      />
      <div class="grid grid-cols-2 gap-3">
        <Button type="submit" variant="primary" disabled={empty()} data-testid="line-menu-footnote">
          {m.line_menu_footnote_add()}
        </Button>
        <Button type="button" variant="accent" onClick={() => props.onCancel()}>
          {m.common_cancel()}
        </Button>
      </div>
    </form>
  );
}
