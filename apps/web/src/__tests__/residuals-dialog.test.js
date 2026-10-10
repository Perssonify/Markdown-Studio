import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { RESIDUAL_KINDS } from "../ui/ResidualsDialog";

/**
 * Import fidelity used to be a bare number in the status bar: "3 residuals",
 * with a tooltip saying some elements "could not be mapped to the current
 * schema" and no way to find out which — in an editor whose promise is that it
 * does not quietly change your document. The per-item detail was already being
 * recorded on every import; it simply had nowhere to be read.
 */
describe("residual reporting", () => {
  it("explains every residual type the ingest pipeline can produce", () => {
    // A type with no entry renders as its raw slug ("dropped-attribute"), which
    // is the jargon this dialog exists to replace. Adding a residual type to
    // ingest.ts means adding its plain-language heading here.
    const src = readFileSync(join(process.cwd(), "src/store/importExport/ingest.ts"), "utf8");
    const emitted = new Set();
    // Only the types pushed as residuals — not `type: "doc"`/`"paragraph"`,
    // which are ProseMirror node names in the same file.
    for (const m of src.matchAll(/residuals\.push\(\{\s*\n?\s*type:\s*"([a-z-]+)"/g)) {
      emitted.add(m[1]);
    }
    expect(emitted.size).toBeGreaterThan(0);
    for (const type of emitted) {
      expect(RESIDUAL_KINDS[type], `no plain-language heading for residual type "${type}"`).toBeTruthy();
    }
  });

  it("gives each kind both a heading and an explanation", () => {
    for (const [type, kind] of Object.entries(RESIDUAL_KINDS)) {
      expect(kind.title, type).toBeTruthy();
      expect(kind.blurb, type).toBeTruthy();
    }
  });
});
