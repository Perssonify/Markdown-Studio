import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * A5. A `truncate` class with no `title` leaves a clipped name with no way to
 * read it — and in a library these are the strings that identify the thing you
 * are looking for. It bites hardest exactly where it matters: folder names nest,
 * so the deeper ones are clipped soonest, and the workspace panel is resizable
 * down to 240px.
 *
 * The rule this pins is narrow on purpose — every element that truncates a
 * DOCUMENT OR FOLDER NAME must carry a title. It does not claim to cover every
 * truncated string in the app.
 */

const files = {
  "FolderTree.tsx": readFileSync(join(process.cwd(), "src/ui/FolderTree.tsx"), "utf8"),
  "WorkspacePanel.tsx": readFileSync(join(process.cwd(), "src/ui/WorkspacePanel.tsx"), "utf8"),
};

describe("library rows expose their full name", () => {
  it("the folder row titles its name", () => {
    expect(files["FolderTree.tsx"]).toContain("title={node.folder.name}");
  });

  it("both document lists title their title", () => {
    // FolderTree's tree row and WorkspacePanel's flat search/select row show
    // the same names; fixing one and not the other means the tooltip appears
    // and disappears depending on whether you have typed in the search box.
    for (const [name, src] of Object.entries(files)) {
      expect(src, name).toContain('title={doc.title || "Untitled"}');
    }
  });
});
