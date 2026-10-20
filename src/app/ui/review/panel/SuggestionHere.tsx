import Check from "lucide-solid/icons/check";

import { t } from "../../../i18n";
import { EmptyState } from "../../primitives";

export function SuggestionHere() {
  return (
    <EmptyState
      icon={<Check size={20} />}
      title={t("Everything this suggestion offers is already in your editor.")}
      description={t(
        "You may have written it here, or taken it already. Save brings it into the shared project and closes the suggestion.",
      )}
    />
  );
}
