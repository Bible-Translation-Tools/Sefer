import CheckCheck from "lucide-solid/icons/check-check";
import Ellipsis from "lucide-solid/icons/ellipsis";
import { Show } from "solid-js";

import { m } from "#app/paraglide/messages";
import type { Finding } from "#core/findings/finding";

import { useShell } from "../../ProjectContext";
import { checkSwitchOf } from "../../sousSettings";
import {
  allow,
  bringBack,
  checkLabel,
  fineHere,
  flaggedText,
  turnOff,
} from "../../suppressAnswers";
import { Button, IconButton, Menu, MenuItem } from "../primitives";

function MoreMenu(props: { readonly finding: Finding; readonly everywhere: boolean }) {
  const shell = useShell();
  const flagged = (): string => flaggedText(shell, props.finding);
  const check = (): string => checkLabel(props.finding) ?? "";

  return (
    <Menu
      label={m.findings_more_ways_to_answer_this()}
      side="bottom"
      align="end"
      class="w-80"
      trigger={
        <IconButton
          label={m.common_more()}
          size="sm"
          icon={<Ellipsis />}
          data-tour="finding-more"
        />
      }
    >
      <Show when={props.everywhere}>
        <MenuItem onSelect={() => allow(shell, props.finding)} data-testid="suppress-allow">
          <span class="flex flex-col gap-0.5">
            <span>{m.common_always_allow_text({ text: flagged() })}</span>
            <span class="text-smallest font-normal text-on-surface-tertiary">
              {m.findings_never_flag_this_in_this({
                check: check(),
              })}
            </span>
          </span>
        </MenuItem>
      </Show>
      <Show when={checkSwitchOf(props.finding.code) !== undefined}>
        <MenuItem onSelect={() => turnOff(shell, props.finding)} data-testid="suppress-turn-off">
          <span class="flex flex-col gap-0.5">
            <span>{m.common_turn_off_check({ check: check() })}</span>
            <span class="text-smallest font-normal text-on-surface-tertiary">
              {m.findings_stop_this_check_in_every()}
            </span>
          </span>
        </MenuItem>
      </Show>
    </Menu>
  );
}

export function SuppressActions(props: { readonly finding: Finding }) {
  const shell = useShell();

  const hidden = () => shell.suppressedBy(props.finding);

  return (
    <Show
      when={hidden() === undefined}
      fallback={
        <Button
          size="sm"
          variant="tertiary"
          title={
            hidden() === "everywhere"
              ? m.findings_allowed_everywhere_in_this_project()
              : m.findings_marked_fine_here_2()
          }
          onClick={() => bringBack(shell, props.finding)}
        >
          {hidden() === "everywhere" ? m.findings_stop_allowing() : m.findings_show_again()}
        </Button>
      }
    >
      <Show when={props.finding.suppression}>
        {(keys) => (
          <>
            <Button
              size="sm"
              variant="tertiary"
              icon={<CheckCheck />}
              data-tour="fine-here"
              title={m.findings_hide_this_one_it_comes()}
              onClick={() => fineHere(shell, props.finding)}
            >
              {m.common_fine_here()}
            </Button>
            <Show
              when={
                keys().everywhere !== undefined || checkSwitchOf(props.finding.code) !== undefined
              }
            >
              <MoreMenu finding={props.finding} everywhere={keys().everywhere !== undefined} />
            </Show>
          </>
        )}
      </Show>
    </Show>
  );
}
