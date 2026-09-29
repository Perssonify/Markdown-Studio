// Extended markdown preprocessor: {attr=val}content{/attr} → HTML

export interface PreprocessFeatures {
  frontmatter?: boolean;
  fieldBlocks?: boolean;
  transclusions?: boolean;
  blockIds?: boolean;
  wikiLinks?: boolean;
  taskLists?: boolean;
  curlyBraceFormatting?: boolean;
}

interface FieldEntry {
  key: string;
  value: string;
}

/** Parse key: value lines into field array (inlined from FieldBlock for zero-dep import) */
function parseFieldLines(text: string): FieldEntry[] {
  const lines = text.trim().split("\n");
  const fields: FieldEntry[] = [];
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) fields.push({ key, value });
  }
  return fields;
}

// HTML attribute escape
function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function preprocessMarkdown(
  md: string,
  features: PreprocessFeatures = {}
): string {
  const {
    frontmatter = false,
    fieldBlocks = false,
    transclusions = false,
    blockIds = false,
    wikiLinks = false,
    // taskLists: handled by the marked renderer override (build-marked.ts), not here.
    curlyBraceFormatting = true,
  } = features;

  // 0. YAML front matter: a leading ---\n…\n--- block → placeholder node. Only the
  // very first block at the document start is treated as front matter (anchored,
  // non-global) so it never captures a mid-document thematic break.
  if (frontmatter) {
    md = md.replace(
      /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/,
      (_m: string, body: string) => {
        const json = JSON.stringify(body).replace(/"/g, "&quot;");
        // Include the raw body as inner text so the element is never "blank"
        // (Turndown skips its custom rule for blank nodes) — the atom node ignores
        // this inner text on the way in and reads it back from the data attribute.
        // Collapse newlines in the inner text so a blank line inside the block
        // can't make marked split the HTML block; the data attribute keeps the
        // real (newline-preserving) body used for parsing and round-trip.
        return `<div data-type="frontmatter" data-frontmatter="${json}">${esc(body).replace(/\s*\n\s*/g, " ")}</div>\n\n`;
      }
    );
  }

  // 0a. Field blocks: :::fields ... ::: → HTML
  if (fieldBlocks) {
    md = md.replace(
      /^:::fields\n([\s\S]*?)^:::\s*$/gm,
      (_: string, body: string) => {
        const fields = parseFieldLines(body);
        const fieldsJson = JSON.stringify(fields).replace(/"/g, "&quot;");
        return `<div data-type="field-block" data-fields="${fieldsJson}"></div>`;
      }
    );
  }

  // Mask fenced + inline code so the semantic passes below (transclusions, wiki
  // links, task lists, curly-brace formatting) never rewrite code content — e.g.
  // `[[Doc]]` or `- [ ] todo` shown as code must stay literal, not be converted.
  // Restored verbatim just before returning.
  const codeStore: string[] = [];
  const stash = (m: string) => `@@PFCODE${codeStore.push(m) - 1}@@`;
  md = md
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, stash)
    .replace(/(`+)([\s\S]+?)\1/g, stash);

  // 0b. Transclusion: ![[target]] or ![[target#section]] or ![[target#^blockId]]
  // Must run BEFORE wiki links since ![[]] contains [[]]
  if (transclusions) {
    md = md.replace(/!\[\[([^\]]+)\]\]/g, (_: string, inner: string) => {
      let target = inner;
      let section: string | null = null;
      let blockId: string | null = null;
      const hashIdx = inner.indexOf("#");
      if (hashIdx >= 0) {
        target = inner.slice(0, hashIdx).trim();
        const after = inner.slice(hashIdx + 1).trim();
        if (after.startsWith("^")) {
          blockId = after.slice(1);
        } else {
          section = after;
        }
      }
      const attrs = [
        `data-type="transclusion"`,
        `data-target="${esc(target)}"`,
        section ? `data-section="${esc(section)}"` : "",
        blockId ? `data-block-id="${esc(blockId)}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<div ${attrs}></div>`;
    });
  }

  // 0c. Block IDs: strip ^block-id from end of lines (store in data attr)
  if (blockIds) {
    md = md.replace(
      /^(.+?)\s+\^([a-z0-9]{4,12})\s*$/gm,
      (_: string, content: string, blockId: string) =>
        `${content}<!-- block-id:${blockId} -->`
    );
  }

  // 0d. Task lists: intentionally NOT preprocessed here. marked's gfm list
  // tokenizer detects `- [ ]`/`- [x]` natively and our renderer override
  // (build-marked.ts, gated on `taskLists`) emits TaskList/TaskItem-parseable
  // markup while preserving inline markdown in each item. A regex pass here
  // would strip the `[ ]` before marked ever sees it.

  // 1a. Wiki links + heading anchors:
  //   [[Title]]                     → link to a document
  //   [[Title|Display]]             → link with custom text
  //   [[Title#Heading]]             → link to a heading within a document
  //   [[#Heading]]                  → link to a heading in the CURRENT document
  //   [[Title#Heading|Display]]     → any of the above with custom text
  // The part before an optional "|" is the reference; a "#" inside it splits
  // the document target from the heading anchor. Emitted as an <a> carrying
  // data-doc-link (empty = current doc) and data-anchor (the heading text).
  if (wikiLinks) {
    md = md.replace(/\[\[([^\]]+)\]\]/g, (_: string, inner: string) => {
      const pipeIdx = inner.indexOf("|");
      const ref = (pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner).trim();
      const explicitDisplay = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : null;
      const hashIdx = ref.indexOf("#");
      const target = (hashIdx >= 0 ? ref.slice(0, hashIdx) : ref).trim();
      const anchor = hashIdx >= 0 ? ref.slice(hashIdx + 1).trim() : "";
      const display = explicitDisplay ?? ref;
      const anchorAttr = anchor ? ` data-anchor="${esc(anchor)}"` : "";
      return `<a data-doc-link="${esc(target)}"${anchorAttr} class="wiki-link" href="#">${esc(display)}</a>`;
    });
  }

  // 1b+ Curly brace formatting (heading attrs + inline spans)
  // The `indexOf` is the point: this block runs several whole-document scans,
  // including a `while (regex.test(md))` loop that re-scans from the start each
  // time, and it cannot match anything without a brace in the text.
  if (curlyBraceFormatting && md.indexOf("{") !== -1) {
    md = md.replace(
      /^(#{1,6})(\s+)([^\n{}]+?)\s*\{([^}]+)\}\s*$/gm,
      (_: string, hashes: string, space: string, text: string, attrs: string) => {
        const firstKey = attrs.trim().split(/\s+/)[0]?.split("=")[0] ?? "";
        return `${hashes}${space}{${attrs}}${text}{/${firstKey}}`;
      }
    );
    // 2. Convert curly brace blocks → HTML (recursive, max 500 iterations)
    const regex = /\{([^{}]+)\}([\s\S]*?)\{\/([a-zA-Z0-9-]+)\}/m;
    let i = 0;
    while (regex.test(md) && i < 500) {
      md = md.replace(
        regex,
        (_: string, attrString: string, inner: string, _closingName: string) => {
          const attrs = attrString.trim().split(/\s+/).filter(Boolean);
          const styleParts: string[] = [];
          const otherAttrs: string[] = [];
          const blockKeys = [
            "align",
            "line-height",
            "margin-top",
            "margin-bottom",
            "margin-left",
            "margin-right",
            "padding",
          ];
          let firstKey: string | null = null;

          const namedSizes: Record<string, string> = {
            small: "12px",
            medium: "16px",
            large: "20px",
            "x-large": "24px",
            "xx-large": "32px",
          };

          attrs.forEach((item) => {
            const eqIdx = item.indexOf("=");
            const key = eqIdx > -1 ? item.slice(0, eqIdx).trim() : item.trim();
            let val = eqIdx > -1 ? item.slice(eqIdx + 1).trim() : "";
            if (/^["'].*["']$/.test(val)) val = val.slice(1, -1);
            if (!firstKey) firstKey = key;

            switch (key) {
              case "color":
                styleParts.push(`color: ${val}`);
                break;
              case "bg":
                styleParts.push(`background-color: ${val}`);
                break;
              case "size": {
                if (namedSizes[val]) {
                  styleParts.push(`font-size: ${namedSizes[val]}`);
                } else if (/^\d/.test(val) && !/[a-z%]/.test(val)) {
                  styleParts.push(`font-size: ${val}px`);
                } else {
                  styleParts.push(`font-size: ${val}`);
                }
                break;
              }
              case "align":
                styleParts.push(`text-align: ${val}`);
                break;
              case "line-height":
                styleParts.push(`line-height: ${val}`);
                break;
              case "letter-spacing":
                styleParts.push(`letter-spacing: ${val}`);
                break;
              case "margin-top":
              case "margin-bottom":
              case "margin-left":
              case "margin-right":
                styleParts.push(`${key}: ${val}`);
                break;
              case "padding":
                styleParts.push(`padding: ${val}`);
                break;
              case "font":
                styleParts.push(`font-family: ${val}`);
                break;
              case "style":
                styleParts.push(esc(val));
                break;
              case "id":
              case "class":
                otherAttrs.push(`${key}="${esc(val)}"`);
                break;
              default:
                // Only emit safe, non-event attributes; never pass through
                // `on*` handlers or arbitrary keys, and always escape the value.
                if (/^(data-[a-z0-9-]+|aria-[a-z]+|title|lang|dir|role)$/i.test(key)) {
                  otherAttrs.push(`${key}="${esc(val)}"`);
                }
                break;
            }
          });

          const styleStr = styleParts.length
            ? `style="${styleParts.join("; ")}"`
            : "";
          const attrStr = [styleStr, ...otherAttrs].filter(Boolean).join(" ");
          const isBlock = firstKey !== null && blockKeys.includes(firstKey);
          const tag = isBlock ? "div" : "span";
          return `<${tag} ${attrStr}>${inner}</${tag}>`;
        }
      );
      i++;
    }
  }

  // Restore masked code verbatim (see the mask step near the top).
  if (codeStore.length) {
    md = md.replace(/@@PFCODE(\d+)@@/g, (_m, i) => codeStore[Number(i)] ?? "");
  }

  return md;
}

// Whitespace normalizer for Turndown output.
//
// Fenced code is MASKED first, exactly as `preprocessMarkdown` masks it above.
// These passes collapse blank runs and strip trailing whitespace GLOBALLY, and
// they run on every rich→markdown projection — so without masking they quietly
// rewrote the user's code: blank lines inside a snippet collapsed, and trailing
// whitespace stripped from languages where it is significant (a Markdown
// two-space line break inside a fenced example, a diff/patch body, a here-doc).
// Code content must round-trip byte-for-byte.
export function normalizeMarkdown(md: string): string {
  const fences: string[] = [];
  // The mask is a multiline backtracking scan of the whole document. Most
  // documents have no fence at all, and this runs on every rich->markdown
  // projection, so look for a fence marker the cheap way before scanning for
  // one. Equivalent by construction: with no "```" and no "~~~" in the text,
  // the pattern cannot match.
  const hasFence = md.indexOf("```") !== -1 || md.indexOf("~~~") !== -1;
  const masked = hasFence
    ? md.replace(
        /^(?:[ \t]*)(?:```|~~~)[\s\S]*?(?:```|~~~)[ \t]*$/gm,
        (m) => `@@PFNORMCODE${fences.push(m) - 1}@@`
      )
    : md;

  const out = masked
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "\n")
    .replace(/ {2}\n\n/g, "\n\n");

  // Turndown escapes every "[" / "]" it doesn't recognize, which mangles wiki
  // links into \[\[Doc Title\]\] — broken in the raw pane and not portable to
  // Obsidian/Logseq. Restore the [[…]] syntax verbatim. Guarded on the literal
  // escaped opener: the pattern cannot match without it, and this is another
  // whole-document scan on every projection.
  const unescaped = out.indexOf("\\[\\[") === -1
    ? out
    : out.replace(/\\\[\\\[([^[\]\\\n]+)\\?\]\\?\]/g, "[[$1]]");

  return fences.length
    ? unescaped.replace(/@@PFNORMCODE(\d+)@@/g, (_, i) => fences[Number(i)] ?? "")
    : unescaped;
}
