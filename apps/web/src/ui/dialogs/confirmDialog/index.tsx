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
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve: (value: boolean) => void;
}

/**
 * Returns a `confirm(options)` async function and the `<ConfirmDialog />` element to render.
 * Usage:
 *   const { confirm, ConfirmDialog } = useConfirm();
 *   const ok = await confirm({ title: "Delete?", destructive: true });
 */
export function useConfirm() {
  const t = useT();
  const resolveRef = useRef<(value: boolean) => void>(() => { });
  const [state, setState] = useState<ConfirmState>({
    open: false,
    title: "",
    resolve: () => { },
  });

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({ ...options, open: true, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState(s => ({ ...s, open: false }));
    resolveRef.current(true);
  }, []);

  const handleCancel = useCallback(() => {
    setState(s => ({ ...s, open: false }));
    resolveRef.current(false);
  }, []);

  const ConfirmDialogElement = (
    <AlertDialog open={state.open} onOpenChange={(open) => { if (!open) handleCancel(); }}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{state.title}</AlertDialogTitle>
          {state.description && (
            <AlertDialogDescription>{state.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>
            {state.cancelLabel ?? t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={state.destructive ? "destructive" : "default"}
            onClick={handleConfirm}
          >
            {state.confirmLabel ?? t("dialogs.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, ConfirmDialog: ConfirmDialogElement };
}

export type UnsavedChangesResult = "save" | "discard" | "cancel";

/**
 * Three-way dialog for unsaved changes: Save / Discard / Cancel.
 * Returns "save", "discard", or "cancel".
 */
export function useUnsavedChangesConfirm() {
  const t = useT();
  const resolveRef = useRef<(value: UnsavedChangesResult) => void>(() => { });
  const [open, setOpen] = useState(false);

  const confirmUnsaved = useCallback((): Promise<UnsavedChangesResult> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setOpen(true);
    });
  }, []);

  const resolve = (result: UnsavedChangesResult) => {
    setOpen(false);
    resolveRef.current(result);
  };

  const UnsavedChangesDialog = (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) resolve("cancel"); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("dialogs.documentHasUnsavedChanges")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("dialogs.saveBeforeClosingItDoesn")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row gap-2 justify-end items-center mt-1">
          <AlertDialogCancel variant="ghost" size="icon-sm" onClick={() => resolve("cancel")} className="absolute top-2 right-2">
            <X />
          </AlertDialogCancel>
          <AlertDialogAction variant="destructive_soft" onClick={() => resolve("discard")}>
            {t("dialogs.discard")}
          </AlertDialogAction>
          <AlertDialogAction onClick={() => resolve("save")}>
            {t("common.save")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirmUnsaved, UnsavedChangesDialog };
}

/**
 * Prompt the user for a document title before creating a new document.
 * Returns the entered title string, or null if the user cancelled.
 */
export function useNewDocPrompt() {
  const t = useT();
  const resolveRef = useRef<(value: string | null) => void>(() => { });
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const promptNewDoc = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setValue("");
      setOpen(true);
    });
  }, []);

  useEffect(() => {
    if (open) {
      // Focus the input on the next frame after the dialog opens
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const handleConfirm = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setOpen(false);
    resolveRef.current(trimmed);
  };

  const handleCancel = () => {
    setOpen(false);
    resolveRef.current(null);
  };

  const NewDocDialog = (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) handleCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("dialogs.newDocument")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("dialogs.enterATitleForYour")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("dialogs.documentTitle")}
          className="mt-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
            if (e.key === "Escape") { e.preventDefault(); handleCancel(); }
          }}
        />
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel onClick={handleCancel}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={!value.trim()}>
            {t("dialogs.create")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { promptNewDoc, NewDocDialog };
}
