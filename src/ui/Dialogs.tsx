import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import React, { useEffect, useRef, useState } from "react";

// Lazy KaTeX (matches MathNodes.tsx) so the equation dialog doesn't pull KaTeX
// into the initial bundle. The CSS is imported globally in main/embed entries.
let katexPromise: Promise<typeof import("katex").default> | null = null;
function getKatex() {
  if (!katexPromise) {
    katexPromise = import("katex").then((m) => m.default);
    // Don't cache a REJECTED import (a transient network/CSP blip would otherwise
    // wedge every future equation-dialog open until a full reload) — allow retry.
    katexPromise.catch(() => {
      katexPromise = null;
    });
  }
  return katexPromise;
}

// --- Prompt Dialog ---

interface PromptDialogProps {
  open: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  type?: "text" | "password";
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title,
  description,
  placeholder,
  defaultValue = "",
  type = "text",
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      // Focus input after dialog animation settles
      const id = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(id);
    }
  }, [open, defaultValue]);

  const handleConfirm = () => {
    if (value.trim()) onConfirm(value.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConfirm();
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent size="default">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>

        <Input
          ref={inputRef}
          type={type}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="mt-1"
        />

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!value.trim()}
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- Confirm Dialog ---

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- Equation Dialog (LaTeX with live KaTeX preview) ---

interface EquationDialogProps {
  open: boolean;
  title: string;
  description?: string;
  display: "inline" | "block";
  defaultValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function EquationDialog({
  open,
  title,
  description,
  display,
  defaultValue = "",
  confirmLabel = "Insert",
  onConfirm,
  onCancel,
}: EquationDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset when (re)opened, and focus the input after the dialog settles.
  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      const id = setTimeout(() => textareaRef.current?.focus(), 80);
      return () => clearTimeout(id);
    }
  }, [open, defaultValue]);

  // Live KaTeX preview — re-render on every keystroke. `throwOnError:false` keeps
  // KaTeX from crashing on a partial expression; we surface the parse message
  // separately so the author sees why a formula is rejected.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const el = previewRef.current;
      // Clear a stale parse error the moment the input is emptied — the preview
      // <div> is unmounted when empty (previewRef.current is null), so this MUST
      // run before the `!el` early-return or the old red error line lingers under
      // an empty box.
      if (!value.trim()) {
        setError(null);
        if (el) el.textContent = "";
        return;
      }
      if (!el) return;
      try {
        const katex = await getKatex();
        if (cancelled || !previewRef.current) return;
        katex.render(value, previewRef.current, {
          throwOnError: true,
          displayMode: display === "block",
        });
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Invalid LaTeX");
        // Still show a best-effort render (KaTeX's own error markup) so the
        // preview area isn't blank while the author is mid-expression.
        try {
          const katex = await getKatex();
          if (cancelled || !previewRef.current) return;
          katex.render(value, previewRef.current, { throwOnError: false, displayMode: display === "block" });
        } catch {
          if (previewRef.current) previewRef.current.textContent = value;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value, display, open]);

  const submit = () => {
    const v = value.trim();
    if (v) onConfirm(v);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl+Enter submits (plain Enter inserts a newline for multi-line block math).
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent size="default">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>

        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            rows={display === "block" ? 3 : 1}
            placeholder={display === "block" ? "E = mc^2" : "x^2"}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="rounded-md border border-border bg-muted/30 px-3 py-3 min-h-14 flex items-center justify-center overflow-x-auto">
            {value.trim() ? (
              <div ref={previewRef} aria-live="polite" />
            ) : (
              <span className="text-xs text-muted-foreground">Preview appears here</span>
            )}
          </div>
          {error && (
            <p className="text-xs text-destructive break-words">{error}</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Press {navigator?.platform?.toLowerCase().includes("mac") ? "⌘" : "Ctrl"}+Enter to insert.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={submit} disabled={!value.trim()}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
