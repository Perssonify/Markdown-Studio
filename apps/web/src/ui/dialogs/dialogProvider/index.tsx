import { createContext, useContext } from "react";
import type { UnsavedChangesResult } from "../confirmDialog";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface PromptOptions {
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  /** Input type — use "password" to mask the value (e.g. encrypted-ZIP prompt). */
  type?: "text" | "password";
}

export interface EquationOptions {
  description?: string;
  /** Block ($$…$$) vs inline ($…$) rendering in the live preview. Default block. */
  display?: "inline" | "block";
  defaultValue?: string;
  confirmLabel?: string;
}

/**
 * One dialog surface for the whole app. Replaces the four separate ad-hoc
 * systems (per-component `useConfirm`, `useDialogs`, `useUnsavedChangesConfirm`,
 * and the native `window.prompt`). The provider (PerssonifyEditor) owns the
 * single set of dialog elements and hands these functions down; components call
 * `useDialog()` instead of instantiating their own dialogs.
 */
export interface DialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (title: string, options?: PromptOptions) => Promise<string | null>;
  /** LaTeX authoring dialog with a live KaTeX preview; resolves to the LaTeX or null. */
  equation: (title: string, options?: EquationOptions) => Promise<string | null>;
  confirmUnsaved: () => Promise<UnsavedChangesResult>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error("useDialog must be used within a DialogContext provider");
  }
  return ctx;
}

export const DialogProvider = DialogContext.Provider;
