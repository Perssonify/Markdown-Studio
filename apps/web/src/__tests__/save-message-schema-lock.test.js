/**
 * A document from a newer build is not "empty".
 *
 * Two refusals share the terminal "blocked" save status: the blank-over-content
 * backstop, and the schema lock on a document this build cannot represent
 * (A021). ⌘S and the autosave toast both told the schema-locked user "the
 * editor is empty" — for a document that was intact and shown read-only.
 */
import { describe, expect, it } from "vitest";
import { describeUncommittedSave, SCHEMA_LOCK_ERROR } from "../store/documents/documentStore";

describe("describeUncommittedSave", () => {
  it("names the newer-version lock for what it is", () => {
    const { message } = describeUncommittedSave({ saveStatus: "blocked", saveError: SCHEMA_LOCK_ERROR });
    expect(message).toMatch(/newer version/i);
    expect(message).not.toMatch(/empty/i);
  });

  it("still explains the blank-over-content refusal", () => {
    const { message } = describeUncommittedSave({ saveStatus: "blocked", saveError: null });
    expect(message).toMatch(/empty/i);
  });
});
