/**
 * The copy of a document that a live share publishes (app/publish), built
 * here so the share dialog's first publish and the sync engine's updates make
 * exactly the same thing. The flags a shared document carries are in
 * live-share-meta.ts.
 */
import { collectAssetRefs } from "../assets/asset-refs";
import { encodeEnvelopeAssets, type AssetPayload } from "../assets/assets";
import { toExportEnvelope } from "../importExport/import-export";
import { resolveDocTitle, type DocumentRecord } from "./document";

export * from "./live-share-meta";

/** What a live share holds: the document as the editor exports it, its images inline. */
export interface LiveDocument {
  /** The owner's revision (`updated`) it was made from. */
  revision: string;
  title: string;
  /** A `perssonify-document` envelope — without the owner's id, metadata or import history. */
  document: Record<string, unknown>;
}

/**
 * The copy of a document a live share publishes. What is the owner's own and
 * not the reader's business stays out: the document id (each follower makes
 * its own), its metadata (card colour, field values, this module's flags),
 * the import report and residuals. Images go inside, as in a JSON export.
 */
export async function buildLiveDocument(
  rec: DocumentRecord,
  getAsset: (hash: string) => Promise<AssetPayload | null>,
): Promise<LiveDocument> {
  const title = resolveDocTitle(rec, rec.canonical).title || "";
  const assets = new Map<string, AssetPayload>();
  for (const hash of collectAssetRefs(rec.canonical)) {
    try {
      const a = await getAsset(hash);
      if (a) assets.set(hash, a);
    } catch {
      /* an image this browser cannot read stays missing for readers too */
    }
  }
  const { id: _id, ingestReport: _report, residuals: _residuals, origin: _origin, ...envelope } = toExportEnvelope(
    { ...rec, metadata: {}, residuals: [] } as DocumentRecord,
    title,
    encodeEnvelopeAssets(assets),
  );
  return { revision: rec.updated, title, document: envelope };
}
