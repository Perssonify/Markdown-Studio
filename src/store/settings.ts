/**
 * Editor settings — user-tunable preferences persisted under the storage
 * adapter's `__prefs` (key `markdownFeatures`). These control which Markdown
 * flavor/features are active and which rich renderers (math, diagrams, music,
 * emoji) are enabled. Threaded into the engine by `useMarkdownEngine`.
 */

export type MarkdownFlavor = "commonmark" | "gfm" | "markdown-extra";

export interface MarkdownFeatureSettings {
  /** Base flavor preset. Choosing one applies the preset's feature defaults. */
  flavor: MarkdownFlavor;

  // Core / GFM
  /** GFM pipe tables. */
  tables: boolean;
  /** `- [ ]` / `- [x]` task list items. */
  taskLists: boolean;
  /** `~~text~~` strikethrough. */
  strikethrough: boolean;
  /** Bare-URL autolinking. */
  autolink: boolean;

  // Markdown Extra
  /** `[^1]` footnotes. */
  footnotes: boolean;

  // Rich renderers (open-source, MIT)
  /** LaTeX math via KaTeX (`$…$`, `$$…$$`). */
  math: boolean;
  /** UML / diagrams via Mermaid (```mermaid fenced blocks). */
  diagrams: boolean;
  /** Music scores via abcjs (```abc fenced blocks). */
  music: boolean;
  /** `:shortcode:` emoji. */
  emoji: boolean;
  /** GitHub-style callouts/admonitions (`> [!NOTE]` … `> [!CAUTION]`). */
  callouts: boolean;
  /** Collapsible `<details><summary>` disclosure blocks. */
  details: boolean;
}

/** Feature defaults implied by each flavor preset. */
export const FLAVOR_PRESETS: Record<
  MarkdownFlavor,
  Pick<
    MarkdownFeatureSettings,
    "tables" | "taskLists" | "strikethrough" | "autolink" | "footnotes"
  >
> = {
  commonmark: {
    tables: false,
    taskLists: false,
    strikethrough: false,
    autolink: false,
    footnotes: false,
  },
  gfm: {
    tables: true,
    taskLists: true,
    strikethrough: true,
    autolink: true,
    footnotes: false,
  },
  "markdown-extra": {
    tables: true,
    taskLists: true,
    strikethrough: true,
    autolink: true,
    footnotes: true,
  },
};

export const DEFAULT_MARKDOWN_FEATURES: MarkdownFeatureSettings = {
  flavor: "gfm",
  ...FLAVOR_PRESETS.gfm,
  math: true,
  diagrams: true,
  music: true,
  emoji: true,
  callouts: true,
  details: true,
};

/** Apply a flavor preset over the current settings (keeps rich-renderer flags). */
export function applyFlavor(
  current: MarkdownFeatureSettings,
  flavor: MarkdownFlavor
): MarkdownFeatureSettings {
  return { ...current, flavor, ...FLAVOR_PRESETS[flavor] };
}

/** Coerce an unknown persisted value into a valid settings object. */
export function normalizeMarkdownFeatures(value: unknown): MarkdownFeatureSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_MARKDOWN_FEATURES };
  return { ...DEFAULT_MARKDOWN_FEATURES, ...(value as Partial<MarkdownFeatureSettings>) };
}
