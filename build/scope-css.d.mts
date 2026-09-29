/** Types for build/scope-css.mjs (plain ESM so node-run tests can import it). */
import type { Plugin } from "vite";

export const SCOPE_ROOTS: string[];
export function scopeSelector(selector: string): string | string[];
export function scopeBaseLayer(css: string): string;
export function scopeLibraryBaseLayer(): Plugin;
