import { eslintCompatPlugin } from "@oxlint/plugins";

import { noDesignScaffoldingRule } from "./no-design-scaffolding.ts";
import { noModuleMockingRule } from "./no-module-mocking.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./require-safety-comment-for-type-assertion.ts";

export default eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-design-scaffolding": noDesignScaffoldingRule,
    "no-module-mocking": noModuleMockingRule,
    "require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertionRule,
  },
});
