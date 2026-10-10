import { readFileSync } from "fs";
import { join } from "path";
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFolderStore } from "../store/documents/folders";
import { FolderTree } from "../ui/FolderTree";

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
 *
 * The folder tree is checked by RENDERING it. Its rows became memoized
 * components fed primitives (A082: a memo keyed on the summary object never
 * bailed out, because every save returns fresh ones), so the source spelling
 * this used to grep for (`title={doc.title || "Untitled"}`) no longer exists
 * there — the requirement does, and a rendered check is the stronger pin.
 */

const files = {
  "WorkspacePanel.tsx": readFileSync(join(process.cwd(), "src/ui/WorkspacePanel.tsx"), "utf8"),
};

const doc = (id, title) => ({
  id, title, updated: "2026-09-01T00:00:00Z", created: "2026-09-01T00:00:00Z",
  wordCount: 3, tags: [], hasResiduals: false, originFormat: "md",
});

function renderTree(documents) {
  useFolderStore.setState({
    folders: [{ id: "f1", name: "Quarterly planning notes for the whole team", parentId: null }],
    docParents: { a: "f1" },
    docOrder: {},
    expanded: { f1: true },
    lastCreatedFolderId: null,
  });
  const noop = () => {};
  return render(React.createElement(FolderTree, {
    documents, activeDocId: null, onSelect: noop, onRename: noop, onDelete: noop, onDuplicate: noop,
  }));
}

describe("library rows expose their full name", () => {
  it("the folder row titles its name", () => {
    const { container } = renderTree([doc("a", "Inside")]);
    expect(container.querySelector('button[title="Quarterly planning notes for the whole team"]')).not.toBeNull();
  });

  it("both document lists title their title", () => {
    // FolderTree's tree row and WorkspacePanel's flat search/select row show
    // the same names; fixing one and not the other means the tooltip appears
    // and disappears depending on whether you have typed in the search box.
    const { container } = renderTree([doc("a", "A document with a long title"), doc("b", "")]);
    expect(container.querySelector('span[title="A document with a long title"]')).not.toBeNull();
    expect(container.querySelector('span[title="Untitled"]')).not.toBeNull();
    expect(files["WorkspacePanel.tsx"]).toContain('title={doc.title || t("common.untitled")}');
  });
});
