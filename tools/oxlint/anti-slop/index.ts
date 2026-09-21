import { eslintCompatPlugin } from "@oxlint/plugins";

import { noDesignScaffoldingRule } from "./no-design-scaffolding.ts";
import { noModuleMockingRule } from "./no-module-mocking.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./require-safety-comment-for-type-assertion.ts";

/**
 * Two rules are on everywhere. The third, `no-design-scaffolding`, is
 * registered here but left OFF in `oxlint.config.ts` on purpose: design
 * scaffolding is legitimate while a question is open, and `pnpm lint:release`
 * is what turns it into an error — see the rule's own note.
 *
 * Broader unknown/type guard rules remain deferred until the codebase has a
 * concrete policy for them.
 */
export default eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-design-scaffolding": noDesignScaffoldingRule,
    "no-module-mocking": noModuleMockingRule,
    "require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertionRule,
  },
});
