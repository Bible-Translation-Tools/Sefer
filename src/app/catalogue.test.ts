import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { catalogueFailureAttrs, catalogueVerdict, listTranslationNotes } from "./catalogue";
import { syncStatus } from "./syncStatus";

const answer = (body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))),
  );

const failureOf = async () => {
  try {
    await listTranslationNotes();
  } catch (cause) {
    return cause;
  }
  throw new Error("expected the catalogue read to fail");
};

// The gate is closed until the stored choice is read at start; these reads are online.
beforeEach(() => syncStatus.setWorkOffline(false));
afterEach(() => vi.unstubAllGlobals());

describe("the Language API's GraphQL errors", () => {
  it("says what the API said, and counts it as the API being unavailable", async () => {
    answer({
      errors: [{ message: "connection error", extensions: { path: "$", code: "postgres-error" } }],
    });
    const cause = await failureOf();
    expect(cause).toHaveProperty("message", "Language API error: connection error");
    expect(catalogueVerdict(cause)).toBe("unavailable");
    expect(catalogueFailureAttrs(cause)).toEqual({
      "catalogue.failure": "server",
      "graphql.code": "postgres-error",
    });
  });

  it("still calls a body it cannot read a payload failure", async () => {
    answer({ nothing: true });
    const cause = await failureOf();
    expect(cause).toHaveProperty(
      "message",
      expect.stringMatching(/^Language API payload not understood/),
    );
    expect(catalogueVerdict(cause)).toBe("failed");
  });
});
