import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * Two CSS defects that had the same cause: a rule written where it could not do
 * the job it was written for.
 *
 * **E14 — the active-pane label never changed colour.** The label carried
 * `text-muted-foreground!` (Tailwind's important suffix) while the focus handler
 * did `classList.remove("text-muted-foreground")` — a DIFFERENT token, never
 * applied — and `classList.add("text-primary")`, which cannot beat `!important`.
 * Neither direction did anything, and the else branch accumulated a bogus class
 * on every blur. A 6px dot (which used an inline style, so it worked) was the
 * entire affordance.
 *
 * **D4 — exiting Focus mode snapped.** `transition: opacity 200ms` was declared
 * INSIDE the `.pf-focus` rule, so the transition existed only while the class
 * did: entering animated 1 → 0.25, exiting reverted with the selector no longer
 * matching, so there was nothing to animate with.
 */

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const panesRaw = readFileSync(join(process.cwd(), "src/ui/panes/editorPanes/index.tsx"), "utf8");

/** Comments stripped: every assertion below that an old shape is GONE would
 *  otherwise be satisfied by the comment explaining why it went — a check that
 *  reports failure for describing the fix. */
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const panes = codeOnly(panesRaw);

describe("E14 — the active-pane cue", () => {
  it("no longer races Tailwind specificity from JavaScript", () => {
    expect(panes).not.toContain('classList.add("text-primary")');
    expect(panes).not.toContain('classList.remove("text-muted-foreground")');
    expect(panes).not.toContain("text-muted-foreground!");
  });

  it("toggles one attribute the CSS keys off", () => {
    expect(panes).toContain('setAttribute("data-pane-focused"');
    expect(panes).toContain('removeAttribute("data-pane-focused")');
  });

  it("styles both the label and the dot from that attribute", () => {
    // The dot worked before only because it used an inline style; driving both
    // from one source is what stops them disagreeing again.
    expect(css).toContain("[data-pane-header][data-pane-focused] [data-pane-label]");
    expect(css).toContain("[data-pane-header][data-pane-focused] [data-pane-dot]");
  });

  it("gives the unfocused state a real declaration, not an absence", () => {
    expect(css).toContain("[data-pane-header] [data-pane-label]");
    expect(css).toContain("[data-pane-header] [data-pane-dot]");
  });
});

describe("D4 — focus mode dims and un-dims symmetrically", () => {
  it("declares the transition outside .pf-focus", () => {
    const block = css.slice(css.indexOf('[data-tour="menubar"],'));
    const unqualified = block.indexOf("transition: opacity 200ms ease;");
    const scoped = block.indexOf(".pf-focus [data-tour=\"menubar\"]");
    expect(unqualified).toBeGreaterThan(-1);
    // The transition must come BEFORE (i.e. outside) the .pf-focus rule; inside
    // it, it vanishes at the exact moment the exit animation would need it.
    expect(unqualified).toBeLessThan(scoped);
  });

  it("keeps only the dimmed opacity under .pf-focus", () => {
    const scoped = css.slice(css.indexOf('.pf-focus [data-tour="menubar"],'));
    const rule = scoped.slice(0, scoped.indexOf("}"));
    expect(rule).toContain("opacity: 0.25");
    expect(rule).not.toContain("transition:");
  });
});

describe("D3 — a theme swap is atomic rather than partly animated", () => {
  const main = codeOnly(readFileSync(join(process.cwd(), "src/main.tsx"), "utf8"));
  const embed = codeOnly(readFileSync(join(process.cwd(), "src/embed.tsx"), "utf8"));

  it("suppresses transitions during the class swap in both shells", () => {
    expect(main).toContain("disableTransitionOnChange");
    expect(embed).toContain("disableTransitionOnChange");
  });

  it("no longer declares a transition that cannot reach the background", () => {
    // body.pf-app's backdrop is painted by a `background-image` gradient
    // (--noise-bg); a `background-color` transition never touched it, so the
    // page snapped while `color` faded over 300ms.
    const body = css.slice(css.indexOf("body.pf-app {"));
    const rule = body.slice(0, body.indexOf("}"));
    expect(rule).not.toContain("transition: background-color");
  });
});
