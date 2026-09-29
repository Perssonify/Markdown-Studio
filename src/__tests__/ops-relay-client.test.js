/**
 * A file too large for the import relay must be reported as exactly that.
 *
 * The relay now refuses anything over ~4 MB (a Vercel Function cannot return a
 * much larger body) with a 413 and a message that says what to do. The client
 * treated every non-2xx relay reply as "the relay is unavailable", so a user
 * importing a 6 MB Drive file was told something untrue and never learned the
 * actual limit.
 */
import { describe, expect, it } from "vitest";
import { TOO_LARGE_MESSAGE } from "../../api/import.js";
import { fetchImportResource } from "../store/url-import";

const DRIVE_VIEW = "https://drive.google.com/file/d/12a4D7oHxJ7bKlkJV6hpQMS5FX8iPXSnD/view?usp=sharing";

/** Direct fetch blocked by CORS; the relay answers with `relay`. */
const blockedThenRelay = (relay) => async (href) => {
  if (href.includes("/api/import")) return relay();
  throw new TypeError("Failed to fetch");
};

describe("URL import through the relay — oversized files", () => {
  it("surfaces the relay's own 413 message", async () => {
    const fetchImpl = blockedThenRelay(
      () => new Response(JSON.stringify({ error: TOO_LARGE_MESSAGE }), { status: 413, headers: { "content-type": "application/json" } }),
    );
    await expect(fetchImportResource(DRIVE_VIEW, { fetchImpl })).rejects.toThrow(TOO_LARGE_MESSAGE);
  });

  it("still names the size problem when the 413 body is not JSON", async () => {
    const fetchImpl = blockedThenRelay(() => new Response("Payload Too Large", { status: 413 }));
    await expect(fetchImportResource(DRIVE_VIEW, { fetchImpl })).rejects.toThrow(/too large for the import relay/i);
  });

  it("keeps the download-and-drop guidance for every other relay failure", async () => {
    const fetchImpl = blockedThenRelay(() => new Response(JSON.stringify({ error: "Upstream responded 500." }), { status: 502 }));
    await expect(fetchImportResource(DRIVE_VIEW, { fetchImpl })).rejects.toThrow(/Download the file and drag it in/i);
  });
});
