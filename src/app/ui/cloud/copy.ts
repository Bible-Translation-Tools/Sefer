import type { CombineRefusal, CombineState, ReceiveRefusal, SyncState } from "#core/sync";

import { m } from "../../paraglide/messages";
import type { SendOutcome } from "../../syncActions";
import type { BadgeTone } from "../primitives";

export interface StateCopy {
  readonly chip: string;
  readonly headline: string;
  readonly detail: string;
  readonly tone: BadgeTone;
}

export interface StateContext {
  readonly sendRefused?: boolean | undefined;
  readonly signedIn?: boolean | undefined;
  readonly inCopy?: boolean;
}

type QuietState = "checking" | "detached" | "unpublished" | "attached-clean" | "ahead";

const accessCopy = (state: "offline" | "unauthorized", context: StateContext): StateCopy => {
  switch (state) {
    case "offline":
      return {
        chip: m.cloud_offline(),
        headline: m.cloud_youre_offline(),
        detail:
          context.sendRefused === true
            ? m.cloud_saved_on_this_device_not()
            : m.cloud_your_work_is_still_saved(),
        tone: "muted",
      };
    case "unauthorized":
      if (context.signedIn === true)
        return {
          chip: m.cloud_cant_send(),
          headline: m.cloud_this_account_cant_send_to(),
          detail: m.cloud_saved_on_this_device_not_sent(),
          tone: "warning",
        };
      return {
        chip: m.cloud_sign_in_again(),
        headline: m.cloud_sign_in_to_keep_sharing(),
        detail:
          context.sendRefused === true
            ? m.cloud_saved_on_this_device_not_sent_sign()
            : m.cloud_sending_and_receiving_updates_is(),
        tone: "error",
      };
  }
};

const troubleCopy = (state: Exclude<SyncState, QuietState>, context: StateContext): StateCopy => {
  switch (state) {
    case "behind":
      return {
        chip: m.cloud_updates_to_receive(),
        headline: m.cloud_there_are_updates_to_receive(),
        detail: m.cloud_the_shared_project_has_versions(),
        tone: "warning",
      };
    case "diverged":
      return {
        chip: m.cloud_needs_review(),
        headline: m.cloud_both_sides_have_moved(),
        detail: m.cloud_you_and_the_shared_project(),
        tone: "warning",
      };
    case "conflicted":
      return {
        chip: m.cloud_unfinished(),
        headline: m.cloud_a_transfer_stopped_part_way(),
        detail: m.cloud_your_work_is_still_here(),
        tone: "error",
      };
    default:
      return accessCopy(state, context);
  }
};

export const stateCopy = (state: SyncState, context: StateContext = {}): StateCopy => {
  switch (state) {
    case "checking":
      return {
        chip: m.cloud_checking_2(),
        headline: m.cloud_checking_the_shared_project(),
        detail: m.cloud_sefer_is_asking_the_shared(),
        tone: "muted",
      };
    case "detached":
      return {
        chip: m.cloud_not_shared(),
        headline:
          context.signedIn === true ? m.sync_local_headline() : m.sync_local_headline_signed_out(),
        detail: context.signedIn === true ? m.sync_local_detail_signed_in() : m.sync_local_detail(),
        tone: "neutral",
      };
    case "unpublished":
      return {
        chip: m.cloud_nothing_sent_yet(),
        headline: m.cloud_the_shared_project_is_still(),
        detail: m.cloud_nothing_has_been_sent_yet(),
        tone: "brand",
      };
    case "attached-clean":
      if (context.inCopy === true)
        return {
          chip: m.cloud_up_to_date_2(),
          headline: m.cloud_your_copy_has_all_your(),
          detail: m.cloud_offer_your_changes_to_the(),
          tone: "success",
        };
      return {
        chip: m.cloud_up_to_date_2(),
        headline: m.cloud_up_to_date_with_the(),
        detail: m.cloud_your_project_is_stored_safely(),
        tone: "success",
      };
    case "ahead":
      if (context.inCopy === true)
        return {
          chip: m.cloud_changes_to_send(),
          headline: m.cloud_you_have_work_your_copy(),
          detail: m.cloud_send_it_to_your_copy(),
          tone: "warning",
        };
      return {
        chip: m.cloud_changes_to_send(),
        headline: m.cloud_you_have_work_the_shared(),
        detail: m.cloud_send_it_when_you_are(),
        tone: "warning",
      };
    default:
      return troubleCopy(state, context);
  }
};

export const receiveRefusal = (refusal: ReceiveRefusal, books: readonly string[] = []): string => {
  switch (refusal) {
    case "review":
      return m.cloud_you_and_the_shared_project_both({ books: books.join(", ") });
    case "diverged":
      return m.cloud_this_device_has_versions_the();
    case "no-cloud-copy":
      return m.cloud_the_shared_project_has_no();
    case "no-shared-version":
      return m.cloud_this_project_and_the_shared();
    case "unrecorded":
      return m.cloud_some_files_the_shared_project();
    case "moved":
      return m.cloud_a_book_changed_while_the();
    case "no-branch":
      return m.cloud_there_is_nothing_here_to();
  }
};

export const combineRefusal = (refusal: CombineRefusal): string => {
  switch (refusal) {
    case "contested":
      return m.cloud_you_and_the_shared_project_both_changed();
    case "no-cloud-copy":
      return m.cloud_the_shared_project_has_no();
    case "no-shared-version":
      return m.cloud_this_project_and_the_shared();
    case "not-diverged":
      return m.cloud_only_one_side_has_moved();
    case "deletion":
      return m.cloud_the_shared_project_deleted_a();
    case "moved":
      return m.cloud_a_book_changed_while_the_two();
    case "no-branch":
    case "no-work-here":
      return m.cloud_there_is_nothing_here_to_combine();
  }
};

export const combineTrouble = (state: CombineState): string => {
  switch (state) {
    case "untouched":
      return m.cloud_nothing_was_changed_on_this();
    case "restored":
      return m.cloud_this_device_was_put_back();
    case "recorded":
      return m.cloud_your_work_and_the_shared();
    case "stranded":
      return m.cloud_this_device_is_part_way();
  }
};

type SendCopy = ReturnType<typeof sendOutcomeCopy>;

const refusedCopy = (
  outcome: Extract<SendOutcome, { kind: "refused" }>,
  state?: SyncState,
): SendCopy => {
  switch (outcome.reason) {
    case "Rejected":
      if (outcome.toCopy === true)
        return {
          tone: "warning",
          title: m.cloud_saved_here_not_sent_your(),
          detail: m.cloud_they_came_from_another_device(),
        };
      if (outcome.description !== undefined)
        return {
          tone: "warning",
          title: m.cloud_saved_here_not_sent_to(),
          detail: m.cloud_your_work_is_safe_on({
            description: outcome.description,
          }),
        };
      return {
        tone: "warning",
        title: m.cloud_saved_here_not_sent_the(),
        detail:
          state === "behind" || state === "diverged"
            ? m.cloud_it_has_versions_you_have()
            : m.cloud_the_shared_project_would_not(),
      };
    case "Network":
    case "Unavailable":
      return {
        tone: "warning",
        title: m.cloud_saved_here_not_sent_the_shared(),
        detail: m.cloud_you_may_be_offline_your(),
      };
    case "Unauthorized":
      if (outcome.noWrite === true)
        return {
          tone: "warning",
          title: m.cloud_saved_here_not_sent_no_write(),
          detail:
            outcome.description === undefined
              ? m.cloud_no_write_send_again()
              : m.cloud_no_write_copy_failed({ description: outcome.description }),
        };
      return {
        tone: "warning",
        title: m.cloud_saved_here_not_sent_sign(),
        detail: m.cloud_your_sign_in_has_expired(),
      };
  }
};

export const sendOutcomeCopy = (
  outcome: SendOutcome,
  state?: SyncState,
): {
  readonly tone: "success" | "warning" | "muted";
  readonly title: string;
  readonly detail: string;
} => {
  switch (outcome.kind) {
    case "sent":
      return outcome.toCopy === true
        ? {
            tone: "success",
            title:
              outcome.ownCopy === undefined
                ? m.cloud_sent_to_your_copy()
                : m.cloud_sent_to_your_own_copy_name({ copy: outcome.ownCopy }),
            detail: m.cloud_offer_your_changes_from_the(),
          }
        : {
            tone: "success",
            title: m.cloud_sent_to_the_shared_project(),
            detail: m.cloud_your_team_gets_it_the(),
          };
    case "detached":
      return {
        tone: "muted",
        title: m.cloud_kept_on_this_device(),
        detail: m.cloud_this_project_is_not_connected(),
      };
    case "held":
      return {
        tone: "muted",
        title: m.cloud_kept_on_this_device_not(),
        detail: m.cloud_this_project_does_not_send(),
      };
    case "refused":
      return refusedCopy(outcome, state);
  }
};

export const offerRefusalCopy = (needed: {
  readonly copy: boolean;
}): { readonly title: string; readonly message: string } =>
  needed.copy
    ? {
        title: m.cloud_your_copy_has_changes_this_device(),
        message: m.cloud_compare_with_your_copy_and(),
      }
    : {
        title: m.cloud_the_shared_project_has_changes(),
        message: m.cloud_compare_the_changes_and_choose(),
      };
