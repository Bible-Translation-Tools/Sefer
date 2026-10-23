import type { BookId } from "@sefer/text/book";
import { testamentOf } from "@sefer/text/location/canon";
import { Show } from "solid-js";

import { t } from "../../i18n";
import { Badge } from "./Badge";
import { MultiSelect } from "./MultiSelect";
import { SegmentedControl } from "./SegmentedControl";

export type BookScopeKind = "book" | "project" | "ot" | "nt" | "custom";

export interface BookScopeRow {
  readonly id: BookId;
  readonly name: string;
  readonly count?: number;
}

export const scopeBooks = (
  kind: BookScopeKind,
  books: readonly BookId[],
  focused: BookId | undefined,
  custom: readonly BookId[],
): readonly BookId[] | undefined => {
  if (kind === "book") return focused === undefined ? undefined : [focused];
  if (kind === "ot" || kind === "nt") return books.filter((id) => testamentOf(id) === kind);
  if (kind === "custom") return custom;
  return undefined;
};

export interface BookScopeProps {
  readonly value: BookScopeKind;
  readonly onChange: (kind: BookScopeKind) => void;
  readonly books: readonly BookScopeRow[];
  readonly custom: readonly BookId[];
  readonly onCustom: (books: readonly BookId[]) => void;
  readonly hasFocused: boolean;
  readonly disabled?: boolean;
}

export function BookScope(props: BookScopeProps) {
  const ids = (): readonly BookId[] => props.books.map((row) => row.id);
  const splits = (): boolean =>
    props.books.some((row) => testamentOf(row.id) === "ot") &&
    props.books.some((row) => testamentOf(row.id) === "nt");
  const off = (): boolean => props.disabled === true;

  return (
    <div class="flex flex-wrap items-center gap-2">
      <SegmentedControl<BookScopeKind>
        size="sm"
        label={t("Scope")}
        value={props.value}
        onChange={(next) => props.onChange(next)}
        items={[
          { value: "book", label: t("This book"), disabled: !props.hasFocused || off() },
          { value: "project", label: t("Whole project"), disabled: off() },
          ...(splits()
            ? [
                { value: "ot" as const, label: t("OT"), disabled: off() },
                { value: "nt" as const, label: t("NT"), disabled: off() },
              ]
            : []),
          { value: "custom", label: t("Custom"), disabled: off() },
        ]}
      />
      <Show when={props.value === "custom"}>
        <MultiSelect
          id="scope-books"
          label={t("Books")}
          summary={
            props.custom.length === 0
              ? t("none")
              : t("{kept} of {total}", { kept: props.custom.length, total: props.books.length })
          }
          narrowed={props.custom.length > 0}
          items={props.books}
          key={(row: BookScopeRow) => row.id}
          match={(row, query) =>
            `${row.id} ${row.name}`.toLowerCase().includes(query.toLowerCase())
          }
          selected={(row) => props.custom.includes(row.id)}
          onToggle={(row) => {
            const held = props.custom;
            props.onCustom(
              held.includes(row.id)
                ? held.filter((id) => id !== row.id)
                : ids().filter((id) => id === row.id || held.includes(id)),
            );
          }}
          clear={{ label: t("No books"), onClear: () => props.onCustom([]) }}
        >
          {(row) => (
            <>
              <span class="flex-1">{row.name}</span>
              <Show when={row.count !== undefined}>
                <Badge>{row.count}</Badge>
              </Show>
            </>
          )}
        </MultiSelect>
      </Show>
    </div>
  );
}
