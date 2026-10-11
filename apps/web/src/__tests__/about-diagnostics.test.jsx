/**
 * A009 — "Copy diagnostics" is reachable without a crash.
 *
 * The crash screens carry the button; a user whose problem is not a crash
 * (a save that keeps failing, an import that does nothing) needs the same
 * report to paste into a support request, so the About page offers it too.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AboutPage } from "../ui/pages/aboutPage";

afterEach(cleanup);

describe("About page", () => {
  it("offers the privacy-safe diagnostics report", () => {
    render(<AboutPage onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /copy diagnostics/i })).toBeTruthy();
  });
});
