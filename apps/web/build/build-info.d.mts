/** Types for build/build-info.mjs (plain ESM so node-run tests can import it). */
export interface BuildInfo {
  branch: string | null;
  commit: string | null;
}
export function buildInfo(opts?: { env?: Record<string, string | undefined>; cwd?: string }): BuildInfo;
