import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

/**
 * `globalThis.__sefer.design.…` left in application code.
 *
 * A real screen can borrow the design panel for an afternoon by registering
 * its own tweaks through the global — see
 * `documentation/architecture/design.md`. That is a good pattern for settling
 * a gutter width and a bad one to find six months later, and it cannot be
 * caught by the type system or by `pnpm boundaries`, because a global that
 * does not exist in production is not an import.
 *
 * ## Off by default, denied at release
 *
 * This rule is deliberately NOT enabled in `oxlint.config.ts`. Scaffolding is
 * legitimate while a question is open, and a squiggle under code somebody is
 * actively iterating with is how a rule teaches people to disable it.
 *
 * `pnpm lint:release` turns it on, and `tools/deploy/web.ts` runs that before
 * a PRODUCTION build only. Dev, and the design build the designer and the
 * product owner look at, never run it: those are exactly the builds where the
 * scaffolding is doing its job. By the time something is tagged for release,
 * the question it was answering should be settled.
 *
 * `src/dev` is exempt — that is where the surface itself lives, and every
 * reference there is the tool rather than scaffolding left in a screen.
 */
const isSeferGlobal = (node: ESTree.Node): boolean => {
  if (node.type === "Identifier") return node.name === "__sefer";
  if (node.type !== "MemberExpression") return false;
  const property = node.property;
  return (
    (property.type === "Identifier" && property.name === "__sefer") ||
    (property.type === "Literal" && property.value === "__sefer")
  );
};

const isDesignProperty = (node: ESTree.MemberExpression): boolean => {
  const property = node.property;
  if (node.computed) return property.type === "Literal" && property.value === "design";
  return property.type === "Identifier" && property.name === "design";
};

export const noDesignScaffoldingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Design-panel scaffolding (globalThis.__sefer.design) must not survive into a release build.",
    },
    messages: {
      scaffolding:
        "Design scaffolding left in application code. `globalThis.__sefer.design` is for settling a question, not for shipping — remove it, or move the screen into src/dev/design. See documentation/architecture/design.md.",
    },
    schema: [],
  },
  create(context) {
    // `src/dev` is the surface itself. Checked on the filename rather than
    // through an oxlint override so the rule is correct however it is invoked.
    const filename = context.filename.replaceAll("\\", "/");
    if (filename.includes("/src/dev/")) return {};

    return {
      MemberExpression(node: ESTree.MemberExpression) {
        if (!isDesignProperty(node)) return;
        if (!isSeferGlobal(node.object)) return;
        context.report({ node, messageId: "scaffolding" });
      },
    };
  },
});
