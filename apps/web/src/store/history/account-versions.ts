import { useSyncExternalStore } from "react";

/**
 * Version history's "In your account" section. The editor knows nothing of
 * accounts: the standalone app, while it syncs with one, registers what lists a
 * note's past versions there and brings one back into this browser's Version
 * history (app/cloud/versions.ts). Without it — the embed, the npm library, a
 * signed-out visitor — the section is not shown.
 */

export interface AccountVersion {
  id: string;
  /** When the account stored it (ms). */
  at: number;
}

export interface AccountVersionsProvider {
  /** A note's earlier versions in the account, newest first (the one synced now left out). */
  list(docId: string): Promise<AccountVersion[]>;
  /**
   * Copy one into this browser's Version history. Resolves to the snapshot
   * that now holds it, ready to restore — or null when there is nothing to
   * bring back (the account no longer has it, or version history is off).
   */
  bringBack(docId: string, versionId: string): Promise<number | null>;
}

let current: AccountVersionsProvider | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Register the provider; returns the function that removes it again. */
export function setAccountVersions(provider: AccountVersionsProvider): () => void {
  current = provider;
  emit();
  return () => {
    if (current !== provider) return;
    current = null;
    emit();
  };
}

export function getAccountVersions(): AccountVersionsProvider | null {
  return current;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAccountVersions(): AccountVersionsProvider | null {
  return useSyncExternalStore(subscribe, getAccountVersions, () => null);
}
