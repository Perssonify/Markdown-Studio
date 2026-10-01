import { describe, expect, it } from "vitest";
import { computeActiveHeadingIndex } from "../hooks/useActiveHeading.ts";

// The active-heading tracker's pure core: given each heading's top offset
// relative to the scroll container, pick the "current" heading (last one at or
// above the activation line). The hook wraps this with read-only scroll/resize
// observation — never writing scrollTop (respects the scroll-sync echo guard).

describe("computeActiveHeadingIndex", () => {
  it("returns null when the reader is above the first heading", () => {
    // Every heading sits below the activation line (positive, > threshold).
    expect(computeActiveHeadingIndex([200, 500, 900], 88)).toBeNull();
  });

  it("picks the first heading once it reaches the activation line", () => {
    expect(computeActiveHeadingIndex([10, 400, 800], 88)).toBe(0);
  });

  it("picks the LAST heading scrolled past the line (current section)", () => {
    // Headings 0 and 1 are above the line (negative/small); 2 is still below.
    expect(computeActiveHeadingIndex([-300, -20, 300], 88)).toBe(1);
  });

  it("picks the deepest heading when several are above the line", () => {
    expect(computeActiveHeadingIndex([-500, -300, -100, 50, 600], 88)).toBe(3);
  });

  it("returns the last index when everything is scrolled past", () => {
    expect(computeActiveHeadingIndex([-900, -600, -300, -50], 88)).toBe(3);
  });

  it("returns null for an empty heading list", () => {
    expect(computeActiveHeadingIndex([], 88)).toBeNull();
  });

  it("respects a custom threshold", () => {
    // top=120 counts as active only when the line is ≥120.
    expect(computeActiveHeadingIndex([120], 88)).toBeNull();
    expect(computeActiveHeadingIndex([120], 150)).toBe(0);
  });
});
