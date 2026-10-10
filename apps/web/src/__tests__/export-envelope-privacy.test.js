/**
 * Every export path writes the same envelope, and none carries the original
 * imported text.
 *
 * The crash screen's "Export my documents" (A009) built its own envelope: it
 * kept `origin.raw` and the clipboard copies of a paste — text the user may
 * have deleted since (A079) — and had no `schemaVersion`, so content from a
 * newer build restored into an older one could open blank (A021). The shared
 * envelope also kept `ingestReport.preIngestHtml`: up to 50 KB of the HTML
 * exactly as first imported, the same kind of payload.
 */
import { describe, expect, it } from "vitest";
import { toExportEnvelope } from "../store/importExport/import-export";
import { buildBackupFiles } from "../utils/emergency-backup";

const para = (text) => ({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text }] }] });
const record = {
  id: "a", title: "Plan", userTitle: null, titlePinnedByUser: false,
  canonical: para("Plan"),
  origin: { format: "html", source: "paste", raw: "<p>deleted secret</p>", alternates: { plain: "deleted secret" } },
  residuals: [],
  ingestReport: { originFormat: "html", preIngestHtml: "<p>deleted secret</p>", dropped: [] },
  metadata: {}, tags: [], created: "2026-01-01T00:00:00.000Z", updated: "2026-02-01T00:00:00.000Z",
};

describe("export envelope privacy", () => {
  it("the shared envelope drops the imported originals, keeping the provenance", () => {
    const env = toExportEnvelope(record);
    const text = JSON.stringify(env);
    expect(text).not.toContain("deleted secret");
    expect(env.origin.format).toBe("html");
    expect(env.ingestReport.originFormat).toBe("html");
    expect(typeof env.schemaVersion).toBe("number");
  });

  it("the crash screen's emergency backup writes that same envelope", async () => {
    const files = await buildBackupFiles({
      storage: { list: async () => [{ id: "a" }], get: async () => record },
      drafts: new Map(), folders: [], docParents: {},
    });
    const [json] = Object.values(files);
    expect(json).not.toContain("deleted secret");
    const env = JSON.parse(json);
    expect(typeof env.schemaVersion).toBe("number");
    expect(env._format).toBe("perssonify-document");
  });
});
