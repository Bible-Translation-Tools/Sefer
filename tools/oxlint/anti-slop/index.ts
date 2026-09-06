import { eslintCompatPlugin } from "@oxlint/plugins";

import { noModuleMockingRule } from "./no-module-mocking.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./require-safety-comment-for-type-assertion.ts";

/**
 * Keep only the two agreed anti-slop rules. Broader unknown/type guard rules
 * remain deferred until the codebase has a concrete policy for them.
 */
export default eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-module-mocking": noModuleMockingRule,
    "require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertionRule,
  },
});
