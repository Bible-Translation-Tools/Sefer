import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

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
