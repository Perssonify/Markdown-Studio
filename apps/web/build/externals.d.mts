/** Types for build/externals.mjs (plain ESM so node-run tests can import it). */
export interface ManifestLike {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}
export function libraryExternals(pkg: ManifestLike): RegExp[];
