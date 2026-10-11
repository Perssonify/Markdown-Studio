import { mergeAttributes, Node } from "@tiptap/core";
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { useIsDarkTheme } from "../theme/useThemeMode";
import { useAssetSrc } from "../ui/shared/utils/asset-dom";
import { missingImageAlt, missingImageTitle } from "./AssetImages";

/**
 * `<picture>` support that is aware of the IN-APP theme, not just the OS.
 *
 * A native `<picture>` with `media="(prefers-color-scheme: …)"` sources only
 * follows the operating system, so it ignores the editor's Light/Dark/System
 * toggle. This node parses such a `<picture>`, remembers the light/dark sources,
 * and renders an `<img>` whose source tracks next-themes' resolved theme — so it
 * switches live with the app. It serializes back to a standard `<picture>` (via
 * renderHTML → turndown `keep`), so the Markdown round-trips unchanged and still
 * works anywhere GitHub-style `<picture>` is understood.
 *
 * The simpler `![](…#gh-light-mode-only)` / `#gh-dark-mode-only` form is handled
 * purely in CSS (styles.css) via ordinary Image nodes — no custom node needed.
 */

function pickSource(el: HTMLElement, wanted: "dark" | "light"): string | null {
  const sources = Array.from(el.querySelectorAll("source"));
  for (const s of sources) {
    const media = (s.getAttribute("media") || "").toLowerCase();
    if (media.includes(`prefers-color-scheme: ${wanted}`) || media.includes(`prefers-color-scheme:${wanted}`)) {
      return s.getAttribute("srcset") || s.getAttribute("src");
    }
  }
  return null;
}

function ThemeImageView(props: NodeViewProps) {
  const isDark = useIsDarkTheme();
  const { lightSrc, darkSrc, alt, title } = props.node.attrs as {
    lightSrc: string;
    darkSrc: string;
    alt: string;
    title: string | null;
  };
  const chosen = (isDark ? darkSrc : lightSrc) || lightSrc || darkSrc || "";
  // A source stored as an asset (A086) is shown through an object URL — a
  // `pf-asset:` reference must never reach a live <img>.
  const { src, missing } = useAssetSrc(chosen);
  return (
    <NodeViewWrapper as="span" className="theme-image" contentEditable={false}>
      <img
        src={src || undefined}
        alt={missing ? missingImageAlt(alt) : alt}
        title={missing ? missingImageTitle() : title || undefined}
        {...(missing ? { "data-pf-asset-missing": "" } : {})}
      />
    </NodeViewWrapper>
  );
}

export const ThemeImage = Node.create({
  name: "themeImage",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      lightSrc: { default: "" },
      darkSrc: { default: "" },
      alt: { default: "" },
      title: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "picture",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const img = el.querySelector("img");
          const dark = pickSource(el, "dark");
          const light = pickSource(el, "light");
          const fallback = img?.getAttribute("src") || "";
          // Only treat as a theme image when it actually carries two variants;
          // otherwise let it fall back to a plain image.
          if (!dark && !light) return false;
          return {
            lightSrc: light || fallback,
            darkSrc: dark || fallback,
            alt: img?.getAttribute("alt") || "",
            title: img?.getAttribute("title") || null,
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const { lightSrc, darkSrc, alt, title } = node.attrs as {
      lightSrc: string;
      darkSrc: string;
      alt: string;
      title: string | null;
    };
    const imgAttrs: Record<string, string> = { src: lightSrc || darkSrc, alt };
    if (title) imgAttrs["title"] = title;
    return [
      "picture",
      {},
      ["source", { media: "(prefers-color-scheme: dark)", srcset: darkSrc }],
      ["source", { media: "(prefers-color-scheme: light)", srcset: lightSrc }],
      ["img", mergeAttributes(imgAttrs)],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ThemeImageView);
  },
});
