/** Types for build/scope-css.mjs (plain ESM so node-run tests can import it). */
import type { Plugin } from "vite";

export const SCOPE_ROOTS: string[];
export const TOKEN_SCOPE: string;
export function scopeSelector(selector: string): string | string[];
export function scopeBaseLayer(css: string): string;
export function scopeTokenSelector(selector: string): string | string[];
export function scopePageSelector(selector: string): string;
export function scopeTokens(css: string): string;
export function scopeLibraryCss(css: string): string;
export function scopeLibraryStylesheet(): Plugin;
