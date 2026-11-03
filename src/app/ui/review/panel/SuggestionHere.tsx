import Check from "lucide-solid/icons/check";

import { m } from "#app/paraglide/messages";

import { EmptyState } from "../../primitives";

export function SuggestionHere() {
  return (
    <EmptyState
      icon={<Check size={20} />}
      title={m.review_everything_this_suggestion_offers_is()}
      description={m.review_you_may_have_written_it()}
    />
  );
}
