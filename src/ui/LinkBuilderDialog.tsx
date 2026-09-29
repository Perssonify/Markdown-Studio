import React from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LinkBuilder } from "./LinkBuilder";

/**
 * Tools ▸ Share / embed link — a dialog wrapper around the shared
 * {@link LinkBuilder}. The builder itself also renders inline on the Help page,
 * so both surfaces offer exactly the same parameters; this file is only the
 * dialog chrome.
 */
function LinkBuilderDialogInner({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="default">
        <AlertDialogHeader>
          <AlertDialogTitle>Share / embed link</AlertDialogTitle>
          <AlertDialogDescription>
            Turn on the URL parameters you want, pick each value, and copy a link that opens the
            editor with exactly those settings — or an iframe snippet to embed it.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <LinkBuilder variant="dialog" />

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onOpenChange(false)}>Done</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Memoized: this stays MOUNTED while closed so its sheet/dialog can animate
// out, and without a memo it re-ran its whole body — and, for the settings
// sheet, ~26 store subscriptions — on every render of the editor shell,
// i.e. on every keystroke, to produce a tree nobody was looking at.
export const LinkBuilderDialog = React.memo(LinkBuilderDialogInner);
