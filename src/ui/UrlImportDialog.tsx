import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  FolderArchiveIcon,
  InfoIcon,
  Loader2Icon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildImportShareLink,
  detectUrlFormat,
  fetchImportResource,
  UrlImportError,
  type ImportResource,
} from "@/store/url-import";
import { ArchiveEncryptedError, ArchiveWrongPasswordError } from "@/store/archive";
import { useDialog } from "./DialogProvider";

interface UrlImportDialogProps {
  open: boolean;
  /** Pre-fill the URL field (e.g. from a ?import_url= deep link). */
  initialUrl?: string;
  /** When true (with initialUrl), fetch immediately on open. */
  autoStart?: boolean;
  /** Import the (selected) resource. For archives, selectedPaths lists the entry
   *  paths the user kept; for a single text doc it is undefined. */
  onImport: (resource: ImportResource, selectedPaths?: string[]) => Promise<void> | void;
  onCancel: () => void;
}

type Phase = "input" | "loading" | "preview" | "importing";

/**
 * "Import from URL" with provider-aware normalization (Google Drive, GitHub,
 * Dropbox), a preview + per-item selection step (archives), a shareable-link
 * generator, and a co-equal paste fallback for URLs the browser can't fetch
 * cross-origin (CORS).
 */
export function UrlImportDialog({
  open,
  initialUrl,
  autoStart,
  onImport,
  onCancel,
}: UrlImportDialogProps) {
  const dialog = useDialog();
  const [url, setUrl] = useState("");
  const [paste, setPaste] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [error, setError] = useState<string | null>(null);
  const [resource, setResource] = useState<ImportResource | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl ?? "");
      setPaste("");
      setError(null);
      setPhase("input");
      setResource(null);
      setSelected(new Set());
      setCopied(false);
      autoStartedRef.current = false;
    }
  }, [open, initialUrl]);

  const runFetch = useCallback(async (target: string, password?: string) => {
    setError(null);
    setPhase("loading");
    try {
      const res = await fetchImportResource(target, password ? { password } : {});
      setResource(res);
      if (res.kind === "archive") {
        setSelected(new Set(res.entries.map((e) => e.path)));
      }
      setPhase("preview");
    } catch (e) {
      // Password-protected archive: prompt (masked) and retry with the password.
      if (e instanceof ArchiveEncryptedError || e instanceof ArchiveWrongPasswordError) {
        const pw = await dialog.prompt(
          e instanceof ArchiveWrongPasswordError ? "Incorrect password — try again" : "Enter password",
          { description: "This archive is password-protected.", placeholder: "Password", type: "password" },
        );
        if (pw) { void runFetch(target, pw); return; }
        setPhase("input");
        return;
      }
      const msg =
        e instanceof UrlImportError
          ? e.message
          : "Import failed. Try pasting the content instead.";
      setError(msg);
      setPhase("input");
    }
  }, [dialog]);

  // ?import_url= deep links PRE-FILL the URL field (done in the open effect
  // above) but do NOT auto-fetch: a shared link must not force the visitor's
  // browser to hit an attacker-chosen URL on page load. The user reviews the
  // pre-filled URL and clicks Fetch — one deliberate action — before any request
  // leaves their machine. (`autoStart`/`autoStartedRef` retained for compat.)
  void autoStart; void autoStartedRef;

  const handlePrimary = async () => {
    if (phase === "loading" || phase === "importing") return;

    // Paste wins when the URL is empty — the always-works path.
    if (!url.trim() && paste.trim()) {
      setPhase("importing");
      try {
        const format = detectUrlFormat(null, "", paste);
        await onImport({
          kind: "text",
          name: "Imported",
          format,
          text: paste,
          sourceUrl: "",
          provider: "paste",
          viaProxy: false,
        });
      } finally {
        setPhase("input");
      }
      return;
    }

    if (url.trim()) {
      await runFetch(url.trim());
      return;
    }
    setError("Enter a URL, or paste content below.");
  };

  const confirmImport = async () => {
    if (!resource) return;
    setPhase("importing");
    try {
      if (resource.kind === "archive") {
        await onImport(resource, [...selected]);
      } else {
        await onImport(resource);
      }
    } finally {
      setPhase("input");
    }
  };

  const toggle = (path: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const shareLink =
    resource && resource.sourceUrl
      ? buildImportShareLink(
          typeof location !== "undefined" ? location.origin + location.pathname : "",
          resource.sourceUrl,
        )
      : null;

  const copyShare = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; ignore */
    }
  };

  const busy = phase === "loading" || phase === "importing";
  const canStart = (url.trim().length > 0 || paste.trim().length > 0) && !busy;
  const selectedCount = selected.size;
  // The preview (and its confirm button) stays mounted while importing so the
  // footer doesn't flip back to the input form mid-import.
  const showPreview = !!resource && (phase === "preview" || phase === "importing");

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      <AlertDialogContent size="default">
        <AlertDialogHeader>
          <AlertDialogTitle>Import from URL</AlertDialogTitle>
          <AlertDialogDescription>
            {phase === "preview"
              ? "Review what will be imported, then confirm."
              : "Paste a link to a Markdown/HTML/text file or a .zip. Google Drive, GitHub, and Dropbox share links work. If a site blocks browser access, paste its content instead."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!showPreview && (
          <div className="flex min-w-0 flex-col gap-3">
            <Input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePrimary();
              }}
              placeholder="https://example.com/notes.md  ·  Drive/GitHub/Dropbox link"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />

            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
              <span className="h-px flex-1 bg-border" />
              or paste content
              <span className="h-px flex-1 bg-border" />
            </div>

            <Textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="# Paste Markdown or HTML here…"
              className="min-h-24 max-h-48 text-xs font-mono"
              spellCheck={false}
              disabled={busy}
            />

            {error && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}

            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              Trouble with a link? Some hosts (e.g. Google Drive) block direct browser
              access — we retry via the app's server relay automatically. If it still fails,
              download the file and drag it in (or use <span className="font-medium">Import file</span>).
            </p>
          </div>
        )}

        {showPreview && resource && (
          <div className="flex min-w-0 flex-col gap-3">
            {resource.kind === "text" ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">{resource.name}</span>
                <span className="ml-auto shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {resource.format}
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FolderArchiveIcon className="size-4 shrink-0" />
                  <span className="truncate font-medium text-foreground">{resource.name}</span>
                  <span className="ml-auto shrink-0">
                    {selectedCount} of {resource.entries.length} selected
                  </span>
                </div>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setSelected(new Set(resource.entries.map((e) => e.path)))}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:underline"
                    onClick={() => setSelected(new Set())}
                  >
                    Deselect all
                  </button>
                </div>
                <ScrollArea className="max-h-56 rounded-md border border-border">
                  <ul className="divide-y divide-border">
                    {resource.entries.map((e) => (
                      <li key={e.path}>
                        <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted/50">
                          <input
                            type="checkbox"
                            checked={selected.has(e.path)}
                            onChange={() => toggle(e.path)}
                            className="size-3.5 shrink-0 accent-[var(--primary)]"
                          />
                          <span className="truncate text-xs" title={e.path}>
                            {e.path}
                          </span>
                          <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                            {e.format}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </>
            )}

            {resource.viaProxy && (
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  This host blocks direct browser access, so it was fetched via the app's own
                  server relay (first-party — not a third-party proxy).
                </span>
              </p>
            )}

            {shareLink && (
              <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/30 p-2">
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  Shareable import link
                </span>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-[11px]" title={shareLink}>
                    {shareLink}
                  </code>
                  <Button type="button" size="sm" variant="outline" onClick={copyShare} className="shrink-0 gap-1">
                    {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  Anyone who opens this link will be prompted to import the same source.
                </span>
              </div>
            )}

            {error && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={busy}>
            Cancel
          </AlertDialogCancel>
          {showPreview && resource ? (
            <Button
              onClick={confirmImport}
              disabled={busy || (resource.kind === "archive" && selectedCount === 0)}
              className="gap-1.5"
            >
              {busy && <Loader2Icon className="size-3.5 animate-spin" />}
              {resource.kind === "archive"
                ? `Import ${selectedCount} document${selectedCount === 1 ? "" : "s"}`
                : "Import"}
            </Button>
          ) : (
            <Button onClick={() => handlePrimary()} disabled={!canStart} className="gap-1.5">
              {busy && <Loader2Icon className="size-3.5 animate-spin" />}
              {phase === "loading" ? "Fetching…" : phase === "importing" ? "Importing…" : "Continue"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
