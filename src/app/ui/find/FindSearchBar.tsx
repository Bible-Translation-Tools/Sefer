import CaseSensitiveIcon from "lucide-solid/icons/case-sensitive";
import CodeIcon from "lucide-solid/icons/code";
import RegexIcon from "lucide-solid/icons/regex";
import SearchIcon from "lucide-solid/icons/search";
import WholeWordIcon from "lucide-solid/icons/whole-word";

import { m } from "#app/paraglide/messages";
import { Button, IconButton, Input } from "#app/ui/primitives";

import type { FindQuery } from "./createFindQuery";

export function FindSearchBar(props: { query: FindQuery; commit: () => void }) {
  return (
    <div class="flex items-center gap-2" data-tour="find-search">
      <Input
        ref={props.query.setBox}
        type="search"
        icon={<SearchIcon />}
        wrapperClass="min-w-0 flex-1"
        placeholder={m.common_find_in_project()}
        value={props.query.text()}
        onInput={(event) => props.query.setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") props.commit();
        }}
      />
      <div
        role="group"
        aria-label={m.find_match_options()}
        class="flex h-12 shrink-0 items-center gap-0.5 rounded-lg border border-surface-border bg-surface-secondary px-1.5"
      >
        <IconButton
          size="sm"
          label={m.find_match_case()}
          icon={<CaseSensitiveIcon />}
          aria-pressed={props.query.matchCase() ? "true" : "false"}
          onClick={() => props.query.setMatchCase((held) => !held)}
        />
        <IconButton
          size="sm"
          label={m.find_whole_word()}
          icon={<WholeWordIcon />}
          aria-pressed={props.query.wholeWord() ? "true" : "false"}
          onClick={() => props.query.setWholeWord((held) => !held)}
        />
        <IconButton
          size="sm"
          label={m.find_regular_expression()}
          icon={<RegexIcon />}
          aria-pressed={props.query.regex() ? "true" : "false"}
          onClick={() => props.query.setRegex((held) => !held)}
        />
        <IconButton
          size="sm"
          label={m.find_search_the_markup_not_the()}
          icon={<CodeIcon />}
          aria-pressed={props.query.markup() ? "true" : "false"}
          onClick={() => props.query.setMarkup((held) => !held)}
        />
      </div>
      <Button variant="primary" class="shrink-0" onClick={props.commit}>
        {m.common_find()}
      </Button>
    </div>
  );
}
