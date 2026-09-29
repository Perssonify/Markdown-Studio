import type { GetModuleInfo } from "rollup";

/**
 * Shared manualChunks strategy for the standalone app and iframe embed builds.
 * Keeps vendor splitting consistent (and maintained in one place) across
 * vite.app.config.ts and vite.embed.config.ts.
 */
export function manualChunks(
  id: string,
  { getModuleInfo }: { getModuleInfo: GetModuleInfo }
): string | undefined {
  if (!id.includes("node_modules")) return;

  if (id.includes("@codemirror") || id.includes("@lezer")) return "codemirror";
  if (id.includes("@tiptap") || id.includes("prosemirror")) return "tiptap";
  if (id.includes("lucide-react")) return "lucide";
  if (id.includes("marked") || id.includes("turndown")) return "markdown";

  // Heavy, lazily-imported renderers/exporters (Mermaid, abcjs, KaTeX, docx,
  // fflate and their exclusive dep trees) must NOT be forced into an eager
  // named chunk — leaving them unassigned lets Rollup keep them in on-demand
  // async chunks. Forgetting one here silently double-ships it: KaTeX used to
  // exist both in the eager 1MB vendor chunk AND as its lazy chunk.
  if (
    id.includes("/mermaid") ||
    id.includes("abcjs") ||
    id.includes("/d3") ||
    id.includes("/dagre") ||
    id.includes("cytoscape") ||
    id.includes("khroma") ||
    id.includes("/dompurify") ||
    id.includes("/katex") ||
    id.includes("/docx") ||
    id.includes("/fflate")
  )
    return undefined;
  if (
    id.includes("@base-ui") ||
    id.includes("sonner") ||
    id.includes("vaul") ||
    id.includes("next-themes")
  )
    return "ui";

  // Avoid a circular chunk (vendor -> react-vendor -> vendor): a module that
  // transitively imports React core must share the react-vendor chunk.
  const reactCorePackages = new Set([
    "/react/",
    "/react-dom/",
    "/react-is/",
    "/scheduler/",
    "/use-sync-external-store/",
  ]);
  const isReactCoreModule = (moduleId: string) =>
    [...reactCorePackages].some((pkg) => moduleId.includes(pkg));
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
}
