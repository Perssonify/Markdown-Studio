import type { PromptOptions } from "../ui/DialogProvider";
import { mdLinkDestination } from "./md-format-utils";

/** What "Insert image" inserts: a source and its alternative text. */
export interface ImageInsert {
  src: string;
  /** Empty means decorative — a deliberate choice, not a forgotten one. */
  alt: string;
}

type Prompt = (title: string, options?: PromptOptions) => Promise<string | null>;

/**
 * Ask for an image's URL, then for its alt text (A096). Every insert path —
 * Insert ▸ Image…, the toolbar, the right-click menu — used to ask for the URL
 * only, so every inserted image reached screen-reader users as "image" with
 * nothing to say what it was. Cancelling either question inserts nothing; an
 * empty description is allowed and marks the image as decorative.
 */
export async function promptImage(prompt: Prompt): Promise<ImageInsert | null> {
  const src = (await prompt("Insert Image", {
    placeholder: "https://example.com/image.png",
    description: "Enter the URL of the image to insert.",
  }))?.trim();
  if (!src) return null;
  const alt = await prompt("Describe the image", {
    placeholder: "e.g. Bar chart of sign-ups by month",
    description:
      "Screen readers read this aloud, and it shows if the image cannot load. " +
      "Leave it empty only if the image is purely decorative.",
  });
  if (alt === null) return null;
  return { src, alt: alt.trim() };
}

/**
 * An insertImage value from any caller: the `{ src, alt }` the prompts produce,
 * or a bare URL string (the host API and older callers).
 */
export function toImageInsert(value: unknown): ImageInsert | null {
  if (typeof value === "string") return value.trim() ? { src: value.trim(), alt: "" } : null;
  if (value && typeof value === "object" && typeof (value as ImageInsert).src === "string") {
    const { src, alt } = value as ImageInsert;
    return src.trim() ? { src: src.trim(), alt: typeof alt === "string" ? alt : "" } : null;
  }
  return null;
}

/** The markdown for an image; `[`, `]` and `\` in the alt text are escaped. */
export function mdImage({ src, alt }: ImageInsert): string {
  return `![${alt.replace(/([\\[\]])/g, "\\$1")}](${mdLinkDestination(src)})`;
}
