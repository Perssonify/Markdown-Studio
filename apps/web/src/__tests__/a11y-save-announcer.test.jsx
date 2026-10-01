import { act, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useDocumentStore } from "../store/documentStore";
import {
  FAILURE_MESSAGES,
  INITIAL_ANNOUNCER,
  RECOVERED_MESSAGE,
  nextAnnouncement,
} from "../ui/save-announcer";
import { StatusBar } from "../ui/StatusBar";

/**
 * A096. The save indicator WAS the live region, and it walks
 * editing → saving → saved on every autosave: nine announcements in twelve
 * seconds of typing, each one interrupting whatever the user was listening to.
 * Only a failure — and the recovery from one — is news.
 */

/** Feed a sequence of [status, error] snapshots; return what would be spoken. */
function speak(seq) {
  let state = INITIAL_ANNOUNCER;
  const said = [];
  for (const [status, error = null] of seq) {
    const r = nextAnnouncement(state, { status, error });
    state = r.state;
    if (r.message) said.push(r.message);
  }
  return said;
}

const ROUTINE = [["editing"], ["saving"], ["saved"], ["ready"]];

describe("nextAnnouncement", () => {
  it("says nothing through any number of routine autosaves", () => {
    const seq = Array.from({ length: 9 }, () => ROUTINE).flat();
    expect(speak(seq)).toEqual([]);
  });

  it("announces a failure once, however many retries it takes", () => {
    // A failed autosave is routed error → editing (saveError kept) → saving →
    // error … on every retry.
    const E = "disk full";
    const retries = Array.from({ length: 4 }, () => [["editing", E], ["saving", E], ["error", E]]).flat();
    expect(speak([["saving"], ["error", E], ...retries])).toEqual([FAILURE_MESSAGES.error]);
  });

  it("announces recovery when a save finally lands — not on the retry's 'saving'", () => {
    const E = "disk full";
    expect(speak([["saving"], ["error", E], ["editing", E], ["saving", E]]))
      .toEqual([FAILURE_MESSAGES.error]);
    expect(speak([["saving"], ["error", E], ["editing", E], ["saving", E], ["saved"]]))
      .toEqual([FAILURE_MESSAGES.error, RECOVERED_MESSAGE]);
  });

  it("does not re-announce a conflict on every edit made while it stands", () => {
    // conflict and blocked keep their saveError through the next edit's
    // editing/saving, so an error-only snapshot is a CONTINUATION.
    const C = "Changed in another tab";
    const edits = Array.from({ length: 3 }, () => [["editing", C], ["saving", C], ["conflict", C]]).flat();
    expect(speak([["saving"], ["conflict", C], ...edits])).toEqual([FAILURE_MESSAGES.conflict]);
  });

  it("announces a DIFFERENT failure, and recovery from a blocked write", () => {
    expect(speak([["error", "x"], ["conflict", "y"]]))
      .toEqual([FAILURE_MESSAGES.error, FAILURE_MESSAGES.conflict]);
    const B = "Refused";
    expect(speak([["blocked", B], ["editing", B], ["saving", B], ["saved"]]))
      .toEqual([FAILURE_MESSAGES.blocked, RECOVERED_MESSAGE]);
  });

  it("remembers an unrecovered failure across healthy-but-unsaved states", () => {
    // Recovery is the first save that lands, even if the failure's own status
    // cleared first (a doc switch resets saveError to null with status ready).
    expect(speak([["conflict", "C"], ["ready"], ["editing"], ["saving"], ["saved"]]))
      .toEqual([FAILURE_MESSAGES.conflict, RECOVERED_MESSAGE]);
  });
});

describe("the status bar speaks through one quiet live region", () => {
  afterEach(() => {
    useDocumentStore.setState({ saveStatus: "ready", saveError: null });
  });

  function mount() {
    useDocumentStore.setState({ saveStatus: "ready", saveError: null });
    const utils = render(<StatusBar />);
    const regions = utils.container.querySelectorAll('[role="status"], [aria-live]');
    return { ...utils, regions };
  }

  const set = (saveStatus, saveError = null) =>
    act(() => { useDocumentStore.setState({ saveStatus, saveError }); });

  it("has exactly one live region, and it is not the visible indicator", () => {
    const { regions, container } = mount();
    expect(regions).toHaveLength(1);
    set("editing");
    // The visible text is still shown…
    expect(container.textContent).toContain("Unsaved changes");
    // …but the live region did not say it.
    expect(regions[0].textContent).toBe("");
  });

  it("stays silent through nine autosave cycles, then reports a failure", () => {
    const { regions } = mount();
    const heard = [];
    // Each announcement REPLACES the region's text node (it is keyed), which is
    // what makes a screen reader speak it — so a new node is one utterance.
    let node = regions[0].firstElementChild;
    const step = (s, e) => {
      set(s, e);
      const now = regions[0].firstElementChild;
      if (now !== node && now?.textContent) heard.push(now.textContent);
      node = now;
    };
    for (let i = 0; i < 9; i++) for (const [s] of ROUTINE) step(s);
    step("saving");
    step("error", "disk full");
    step("editing", "disk full");
    step("saving", "disk full");
    step("saved");
    expect(heard).toEqual([FAILURE_MESSAGES.error, RECOVERED_MESSAGE]);
  });
});
