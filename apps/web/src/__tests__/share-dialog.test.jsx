/**
 * PL-51 — share types. The Share dialog chooses the layout a link opens in
 * (Split by default, Markdown, HTML) and what the recipient gets: an editable
 * copy, a read-only copy, or — for one document, where the host offers it — a
 * LIVE read-only copy that follows the owner's edits.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareDialog } from "../ui/share/shareDialog";

const doc = { kind: "doc", id: "d1", name: "Plan" };
const toast = () => ({ show: vi.fn() });

function setup(props = {}) {
  const onShareDoc = vi.fn(async () => true);
  const onShareFolder = vi.fn(async () => true);
  const onClose = vi.fn();
  const t = toast();
  const view = render(
    <ShareDialog target={doc} onClose={onClose} onShareDoc={onShareDoc} onShareFolder={onShareFolder} toast={t} {...props} />,
  );
  return { view, onShareDoc, onShareFolder, onClose, toast: t };
}

describe("the Share dialog", () => {
  let written;
  beforeEach(() => {
    written = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (s) => void written.push(s) } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("opens on Split and an editable copy, and copies that link", async () => {
    const { onShareDoc, onClose } = setup();
    expect(screen.getByRole("button", { name: "Split" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("radio", { name: /Editable copy/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Copy link/ }));
    await waitFor(() => expect(onShareDoc).toHaveBeenCalledWith("d1", { view: "split", readOnly: false }));
    expect(onClose).toHaveBeenCalled();
  });

  it("a read-only copy that opens in Markdown", async () => {
    const { onShareDoc } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    fireEvent.click(screen.getByRole("radio", { name: /Read-only copy/ }));
    fireEvent.click(screen.getByRole("button", { name: /Copy link/ }));
    await waitFor(() => expect(onShareDoc).toHaveBeenCalledWith("d1", { view: "md", readOnly: true }));
  });

  it("offers no live option where the host has none", () => {
    setup();
    expect(screen.queryByRole("radio", { name: /Live/ })).toBeNull();
  });

  it("publishes a live copy, opening in HTML, and copies its link", async () => {
    const liveShares = { publish: vi.fn(async (id, view) => `https://x/#live=ID&view=${view}`), unpublish: vi.fn(), linkFor: vi.fn(() => null) };
    const { onShareDoc, onClose } = setup({ liveShares });
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));
    fireEvent.click(screen.getByRole("radio", { name: /Live, read-only/ }));
    fireEvent.click(screen.getByRole("button", { name: /Copy live link/ }));
    await waitFor(() => expect(liveShares.publish).toHaveBeenCalledWith("d1", "html"));
    await waitFor(() => expect(written).toEqual(["https://x/#live=ID&view=html"]));
    expect(onShareDoc).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("says why when it cannot publish, and stays open", async () => {
    const liveShares = { publish: vi.fn(async () => { throw new Error("Too large"); }), unpublish: vi.fn(), linkFor: () => null };
    const { onClose, toast: t } = setup({ liveShares });
    fireEvent.click(screen.getByRole("radio", { name: /Live, read-only/ }));
    fireEvent.click(screen.getByRole("button", { name: /Copy live link/ }));
    await waitFor(() => expect(t.show).toHaveBeenCalledWith("Too large", "error"));
    expect(onClose).not.toHaveBeenCalled();
    expect(written).toEqual([]);
  });

  it("a document shared live already opens on it, with its link and a way to stop", async () => {
    const liveShares = { publish: vi.fn(), unpublish: vi.fn(async () => {}), linkFor: vi.fn((id, view) => `https://x/#live=ID${view ? `&view=${view}` : ""}`) };
    setup({ liveShares });
    expect(screen.getByRole("radio", { name: /Live, read-only/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText("Live link").value).toBe("https://x/#live=ID&view=split");
    fireEvent.click(screen.getByRole("button", { name: "Stop sharing live" }));
    await waitFor(() => expect(liveShares.unpublish).toHaveBeenCalledWith("d1"));
    await waitFor(() => expect(screen.getByRole("radio", { name: /Editable copy/ }).getAttribute("aria-checked")).toBe("true"));
  });

  it("a folder can be shared as copies, not live", async () => {
    const liveShares = { publish: vi.fn(), unpublish: vi.fn(), linkFor: vi.fn(() => null) };
    const { onShareFolder } = setup({ liveShares, target: { kind: "folder", id: "f1", name: "Work" } });
    const live = screen.getByRole("radio", { name: /Live, read-only/ });
    expect(live.disabled).toBe(true);
    expect(live.textContent).toMatch(/for a single document/);
    fireEvent.click(screen.getByRole("radio", { name: /Read-only copy/ }));
    fireEvent.click(screen.getByRole("button", { name: /Copy link/ }));
    await waitFor(() => expect(onShareFolder).toHaveBeenCalledWith("f1", { view: "split", readOnly: true }));
  });
});
