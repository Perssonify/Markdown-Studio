/**
 * Shared manualChunks strategy for the standalone app and iframe embed builds.
 * Keeps vendor splitting consistent (and maintained in one place) across
 * vite.app.config.ts and vite.embed.config.ts.
 */

/** The slice of Rollup/Rolldown's ModuleInfo this strategy reads. */
interface ModuleInfoLike {
  isEntry: boolean;
  /** Modules that STATICALLY import this one (dynamic importers are separate). */
  importers: readonly string[];
  importedIds: readonly string[];
}
type GetModuleInfo = (id: string) => ModuleInfoLike | null | undefined;
type ManualChunks = (id: string, meta: { getModuleInfo: GetModuleInfo }) => string | undefined;

/**
 * Build a manualChunks function with its own build-scoped memo.
 *
 * The named chunks below are all EAGER: every one of them is `modulepreload`ed
 * by index.html. So a package may only be grouped into one of them if the
 * entry needs it synchronously — i.e. it is reachable from an entry through
 * STATIC imports alone. The old rule was the opposite: every node_modules
 * package not on a hand-written exclusion list fell into `vendor`, so each lazy
 * `await import()` whose dependency tree nobody had listed was silently
 * double-shipped into the startup bundle — mammoth and its whole tree, @zip.js,
 * and Mermaid's layout libraries all sat in a 976 KB eagerly-preloaded vendor
 * chunk while the code that uses them waited on a dynamic import. Reachability
 * is decided from the module graph, so a new lazy import is lazy by
 * construction instead of by remembering to extend a list.
 */
export function createManualChunks(): ManualChunks {
  // id → "is it statically reachable from an entry?". Valid for one build only.
  const eager = new Map<string, boolean>();
  // Rolldown asks about each module once per build, so a repeat means a NEW
  // build (watch mode, or a test driving a second graph): drop the memo rather
  // than answer from a graph that no longer exists. Clearing is always correct;
  // only the speed depends on this heuristic.
  const asked = new Set<string>();

  function isStaticallyReachable(id: string, getModuleInfo: GetModuleInfo): boolean {
    const known = eager.get(id);
    if (known !== undefined) return known;
    // Walk UP through static importers until an entry (or an ancestor already
    // known to be eager) turns up. `via` remembers how each node was reached so
    // the whole path can be marked eager once one is found.
    const via = new Map<string, string | null>([[id, null]]);
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      const hit = eager.get(cur);
      if (hit === false) continue; // nothing above it reaches an entry
      const info = hit === true ? null : getModuleInfo(cur);
      if (hit === true || (info && info.isEntry)) {
        for (let n: string | null = cur; n !== null; n = via.get(n) ?? null) eager.set(n, true);
        return true;
      }
      if (!info) continue;
      for (const importer of info.importers) {
        if (via.has(importer)) continue;
        via.set(importer, cur);
        queue.push(importer);
      }
    }
    // No static path from any entry. Everything visited statically imports
    // `id`, so none of it can be reachable either (or `id` would be).
    for (const n of via.keys()) eager.set(n, false);
    return false;
  }

  return function manualChunks(id, { getModuleInfo }) {
    if (!id.includes("node_modules")) return;
    if (asked.has(id)) {
      asked.clear();
      eager.clear();
    }
    asked.add(id);

    // Lazy-only packages are left to Rolldown, which keeps them in on-demand
    // async chunks next to the code that dynamically imports them.
    if (!isStaticallyReachable(id, getModuleInfo)) return undefined;

    if (id.includes("@codemirror") || id.includes("@lezer")) return "codemirror";
    if (id.includes("@tiptap") || id.includes("prosemirror")) return "tiptap";
    if (id.includes("lucide-react")) return "lucide";
    if (id.includes("marked") || id.includes("turndown")) return "markdown";
    if (
      id.includes("@base-ui") ||
      id.includes("sonner") ||
      id.includes("vaul") ||
      id.includes("next-themes")
    )
      return "ui";

    // Avoid a circular chunk (vendor -> react-vendor -> vendor): a module that
    // transitively imports React core must share the react-vendor chunk.
    const reactCorePackages = [
      "/react/",
      "/react-dom/",
      "/react-is/",
      "/scheduler/",
      "/use-sync-external-store/",
    ];
    const isReactCoreModule = (moduleId: string) =>
      reactCorePackages.some((pkg) => moduleId.includes(pkg));
    const importsReactCore = (moduleId: string, visited = new Set<string>()): boolean => {
      if (visited.has(moduleId)) return false;
      visited.add(moduleId);
      if (isReactCoreModule(moduleId)) return true;
      const info = getModuleInfo(moduleId);
      if (!info) return false;
      return info.importedIds.some((dep) => importsReactCore(dep, visited));
    };

    if (importsReactCore(id)) return "react-vendor";
    return "vendor";
  };
}

/** The strategy both configs use. */
export const manualChunks: ManualChunks = createManualChunks();
