/**
 * A diagram renderer that could not be DOWNLOADED is not a mistake in the
 * diagram. The preview used to print "mermaid error: Failed to fetch dynamically
 * imported module …" under the user's own source, which reads as a typo hunt.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("mermaid", () => ({
  get default() {
    throw new TypeError("Failed to fetch dynamically imported module: https://markdownstudio.com/assets/mermaid.core-abc.js");
  },
}));

import { DiagramPreview } from "../ui/DiagramPreview";

describe("DiagramPreview when the renderer chunk cannot be fetched", () => {
  it("says the renderer could not be loaded, not that the diagram is wrong", async () => {
    render(<DiagramPreview code={"flowchart TD\n  A-->B"} language="mermaid" />);
    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert).toHaveTextContent(/renderer couldn't be loaded/);
    expect(alert).toHaveTextContent(/offline/);
    expect(alert).not.toHaveTextContent(/Failed to fetch dynamically imported module/);
  });
});
