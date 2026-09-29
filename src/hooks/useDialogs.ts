import { useCallback, useState } from "react";

// --- Prompt Dialog ---

interface PromptState {
  open: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  type?: "text" | "password";
  resolve: ((value: string | null) => void) | null;
}

// --- Confirm Dialog ---

interface ConfirmState {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: ((confirmed: boolean) => void) | null;
}

// --- Equation Dialog (LaTeX with live KaTeX preview) ---

interface EquationState {
  open: boolean;
  title: string;
  description?: string;
  display: "inline" | "block";
  defaultValue?: string;
  confirmLabel?: string;
  resolve: ((value: string | null) => void) | null;
}

export interface EquationOptions {
  description?: string;
  display?: "inline" | "block";
  defaultValue?: string;
  confirmLabel?: string;
}

// --- Hook ---

export function useDialogs() {
  const [promptState, setPromptState] = useState<PromptState>({
    open: false,
    title: "",
    resolve: null,
  });

  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    title: "",
    resolve: null,
  });

  const [equationState, setEquationState] = useState<EquationState>({
    open: false,
    title: "",
    display: "block",
    resolve: null,
  });

  const prompt = useCallback(
    (
      title: string,
      opts?: { description?: string; placeholder?: string; defaultValue?: string; type?: "text" | "password" }
    ): Promise<string | null> =>
      new Promise((resolve) => {
        setPromptState({ open: true, title, resolve, ...opts });
      }),
    []
  );

  const confirm = useCallback(
    (
      title: string,
      opts?: { description?: string; confirmLabel?: string; cancelLabel?: string }
    ): Promise<boolean> =>
      new Promise((resolve) => {
        setConfirmState({ open: true, title, resolve, ...opts });
      }),
    []
  );

  const equation = useCallback(
    (title: string, opts?: EquationOptions): Promise<string | null> =>
      new Promise((resolve) => {
        setEquationState({
          open: true,
          title,
          display: opts?.display ?? "block",
          resolve,
          description: opts?.description,
          defaultValue: opts?.defaultValue,
          confirmLabel: opts?.confirmLabel,
        });
      }),
    []
  );

  const handlePromptClose = useCallback((value: string | null) => {
    setPromptState((s) => {
      s.resolve?.(value);
      return { ...s, open: false, resolve: null };
    });
  }, []);

  const handleEquationClose = useCallback((value: string | null) => {
    setEquationState((s) => {
      s.resolve?.(value);
      return { ...s, open: false, resolve: null };
    });
  }, []);

  const handleConfirmClose = useCallback((confirmed: boolean) => {
    setConfirmState((s) => {
      s.resolve?.(confirmed);
      return { ...s, open: false, resolve: null };
    });
  }, []);

  return {
    prompt,
    confirm,
    equation,
    promptState,
    confirmState,
    equationState,
    handlePromptClose,
    handleConfirmClose,
    handleEquationClose,
  };
}
