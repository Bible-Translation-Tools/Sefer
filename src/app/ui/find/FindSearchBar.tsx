import CaseSensitiveIcon from "lucide-solid/icons/case-sensitive";
import CodeIcon from "lucide-solid/icons/code";
import RegexIcon from "lucide-solid/icons/regex";
import SearchIcon from "lucide-solid/icons/search";
import WholeWordIcon from "lucide-solid/icons/whole-word";

import { t } from "#app/i18n";
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
        placeholder={t("Find in project")}
        value={props.query.text()}
        onInput={(event) => props.query.setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") props.commit();
        }}
      />
      <div
        role="group"
        aria-label={t("Match options")}
        class="flex h-12 shrink-0 items-center gap-0.5 rounded-lg border border-surface-border bg-surface-secondary px-1.5"
      >
        <IconButton
          size="sm"
          label={t("Match case")}
          icon={<CaseSensitiveIcon />}
          aria-pressed={props.query.matchCase() ? "true" : "false"}
          onClick={() => props.query.setMatchCase((held) => !held)}
        />
        <IconButton
          size="sm"
          label={t("Whole word")}
          icon={<WholeWordIcon />}
          aria-pressed={props.query.wholeWord() ? "true" : "false"}
          onClick={() => props.query.setWholeWord((held) => !held)}
        />
        <IconButton
          size="sm"
          label={t("Regular expression")}
          icon={<RegexIcon />}
          aria-pressed={props.query.regex() ? "true" : "false"}
          onClick={() => props.query.setRegex((held) => !held)}
        />
        <IconButton
          size="sm"
          label={t("Search the markup, not the reading")}
          icon={<CodeIcon />}
          aria-pressed={props.query.markup() ? "true" : "false"}
          onClick={() => props.query.setMarkup((held) => !held)}
        />
      </div>
      <Button variant="primary" class="shrink-0" onClick={props.commit}>
        {t("Find")}
      </Button>
    </div>
  );
}
