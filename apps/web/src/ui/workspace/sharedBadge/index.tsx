import { Lock, Radio, RadioTower } from "lucide-react";
import type { DocumentSummary } from "@/store/documents/document";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

/** How a document shared with the user shows in the library (store/documents/live-share-meta.ts). */
export type SharedState = "live" | "live-updated" | "live-ended" | "read-only";

/** A primitive, so the memoized rows can take it as a prop. */
export function sharedStateOf(doc: Pick<DocumentSummary, "liveShare" | "readOnlyShare">): SharedState | undefined {
  if (doc.liveShare) return doc.liveShare.ended ? "live-ended" : doc.liveShare.unseen ? "live-updated" : "live";
  return doc.readOnlyShare ? "read-only" : undefined;
}

export function sharedStateLabel(state: SharedState): string {
  switch (state) {
    case "live": return t("library.sharedLive");
    case "live-updated": return t("library.sharedLiveUpdated");
    case "live-ended": return t("library.sharedLiveEnded");
    case "read-only": return t("library.sharedReadOnly");
  }
}

/**
 * The mark beside a shared document's title in both library lists: a live
 * copy (with a dot once the owner's update has arrived and until it is
 * opened), one whose owner stopped sharing it, or a read-only copy.
 */
export function SharedDocBadge({ state }: { state: SharedState }) {
  const label = sharedStateLabel(state);
  const Icon = state === "read-only" ? Lock : state === "live-ended" ? Radio : RadioTower;
  return (
    <span className="relative inline-flex shrink-0" title={label} data-shared-state={state}>
      <Icon
        aria-hidden
        className={cn("size-3", state === "live-updated" ? "text-primary-strong" : "text-muted-foreground")}
      />
      {state === "live-updated" && (
        <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary ring-1 ring-background" />
      )}
    </span>
  );
}
