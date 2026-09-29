import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ResidualItem } from "../store/ingest";

/**
 * What "N residuals" in the status bar actually means.
 *
 * Import fidelity was reported as a bare count with a tooltip — the reader was
 * told a number of elements "could not be mapped to the current schema" and had
 * no way to find out WHICH, in an editor whose whole promise is that it does not
 * quietly change your document. The data was already recorded per item (type,
 * tag, attribute, reason, location); it just had nowhere to be read.
 */

/** Plain-language heading per residual type, so the list explains itself. */
export const RESIDUAL_KINDS: Record<string, { title: string; blurb: string }> = {
  "blocked-element": {
    title: "Removed for safety",
    blurb: "Scripts and other active content are never imported, whatever the source says.",
  },
  "unknown-element": {
    title: "No place in the document model",
    blurb: "The editor has no node for these tags, so their markup was not kept.",
  },
  "unknown-style": {
    title: "Inline style not carried over",
    blurb: "The editor stores formatting as marks, not as arbitrary CSS.",
  },
  "dropped-attribute": {
    title: "Attribute not kept",
    blurb: "The element was imported; this attribute on it was not.",
  },
  "noted-attribute": {
    title: "May not survive a round-trip",
    blurb: "Kept for now, but not guaranteed through every export format.",
  },
};

const describe = (r: ResidualItem): string => {
  const parts: string[] = [];
  if (r.tag) parts.push(`<${r.tag}>`);
  if (r.element && r.attribute) parts.push(`${r.attribute} on <${r.element}>`);
  else if (r.element) parts.push(`<${r.element}>`);
  else if (r.attribute) parts.push(r.attribute);
  if (r.property) parts.push(r.property);
  if (r.value) parts.push(`= ${r.value}`);
  if (!parts.length) parts.push(r.type);
  return parts.join(" ");
};

export function ResidualsDialog({
  open,
  onClose,
  residuals,
  docTitle,
}: {
  open: boolean;
  onClose: () => void;
  residuals: ResidualItem[];
  docTitle?: string;
}) {
  // Group by kind, preserving the order the types are first seen, so a long list
  // reads as a few explained categories rather than a flat wall of tags.
  const groups: { type: string; items: ResidualItem[] }[] = [];
  for (const r of residuals) {
    const g = groups.find((x) => x.type === r.type);
    if (g) g.items.push(r);
    else groups.push({ type: r.type, items: [r] });
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>What didn’t come through</AlertDialogTitle>
          <AlertDialogDescription>
            {docTitle ? <>When <strong>{docTitle}</strong> was imported, </> : "When this document was imported, "}
            {residuals.length} {residuals.length === 1 ? "thing" : "things"} in the source had no
            representation in the editor’s document model, so {residuals.length === 1 ? "it is" : "they are"} not
            part of the document. Nothing was changed in your original file.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 text-sm">
          {groups.map((g) => {
            const kind = RESIDUAL_KINDS[g.type];
            return (
              <section key={g.type}>
                <h3 className="font-medium text-foreground">
                  {kind?.title ?? g.type}{" "}
                  <span className="text-xs font-normal text-muted-foreground">({g.items.length})</span>
                </h3>
                {kind?.blurb && <p className="mt-0.5 text-xs text-muted-foreground">{kind.blurb}</p>}
                <ul className="mt-1.5 space-y-1">
                  {/* Capped: a badly-formed import can produce hundreds, and a
                      dialog that scrolls forever answers the question no better
                      than the count did. */}
                  {g.items.slice(0, 40).map((r, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 rounded-md bg-muted/50 px-2 py-1">
                      <code className="font-mono text-xs text-foreground">{describe(r)}</code>
                      {r.reason && <span className="text-xs text-muted-foreground">{r.reason}</span>}
                      {r.note && <span className="text-xs text-muted-foreground">{r.note}</span>}
                      {r.location && <span className="ml-auto text-[10px] text-muted-foreground/70">{r.location}</span>}
                    </li>
                  ))}
                </ul>
                {g.items.length > 40 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    …and {g.items.length - 40} more of the same kind.
                  </p>
                )}
              </section>
            );
          })}
        </div>

        {/* Honest about the list's own blind spot: on the HTML/paste path
            `sanitizeForIngest` runs BEFORE `analyzeHtml`, so blocked elements are
            already gone by the time anything is counted. Saying so beats a list
            that quietly implies it is exhaustive. */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          This covers what the importer could still see. Scripts, iframes and form
          controls are stripped for safety before the check runs on an HTML or
          pasted source, so they are removed without appearing here.
        </p>

        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>Close</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
