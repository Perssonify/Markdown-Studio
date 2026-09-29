import { isDangerousUrl } from "../utils/url-safety";

export function cleanHtmlForTurndown(html: string): string {
  // Use DOMParser for robust cleaning instead of fragile regex chains
  try {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const body = doc.body;

    // Remove empty elements that contentEditable creates
    const removeEmpty = (el: Element): void => {
      const children = Array.from(el.querySelectorAll("p, div, span"));
      for (const child of children) {
        // Empty or only contains <br>
        const text = child.textContent?.trim() ?? "";
        const onlyBr =
          child.children.length === 1 &&
          child.children[0]?.tagName === "BR" &&
          !text;
        const isEmpty = !text && child.children.length === 0;
        if (
          (isEmpty || onlyBr) &&
          child.tagName !== "TD" &&
          child.tagName !== "TH"
        ) {
          // Don't remove if it's inside a table cell or list item
          if (
            !child.closest("td") &&
            !child.closest("th") &&
            !child.closest("li")
          ) {
            child.remove();
          }
        }
      }
    };
    removeEmpty(body);

    // Convert CSS-styled spans → semantic tags (process innermost first)
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 20) {
      changed = false;
      iterations++;
      const styledSpans = body.querySelectorAll("span[style]");
      for (const span of styledSpans) {
        // Skip if has styled-span children (process innermost first)
        if (span.querySelector("span[style]")) continue;

        const style = span.getAttribute("style") ?? "";
        let inner = span.innerHTML;
        let remaining = style;

        if (/font-weight:\s*(?:bold|[6-9]00)/i.test(remaining)) {
          inner = `<strong>${inner}</strong>`;
          remaining = remaining.replace(/font-weight:\s*[^;]+;?\s*/gi, "");
        }
        if (/font-style:\s*italic/i.test(remaining)) {
          inner = `<em>${inner}</em>`;
          remaining = remaining.replace(/font-style:\s*[^;]+;?\s*/gi, "");
        }
        if (/text-decoration:\s*underline/i.test(remaining)) {
          inner = `<u>${inner}</u>`;
          remaining = remaining.replace(
            /text-decoration:\s*underline[^;]*;?\s*/gi,
            ""
          );
        }
        if (/text-decoration:\s*line-through/i.test(remaining)) {
          inner = `<del>${inner}</del>`;
          remaining = remaining.replace(
            /text-decoration:\s*line-through[^;]*;?\s*/gi,
            ""
          );
        }
        remaining = remaining.replace(/;\s*$/, "").trim();

        // Only report a change when the span was ACTUALLY rewritten. Setting
        // `changed = true` for every styled span meant a document containing any
        // surviving colour/highlight/font span re-ran this whole pass — 20
        // full-document querySelectorAll sweeps — on every rich→markdown
        // projection, i.e. on every edit, forever, converging on nothing.
        const before = span.outerHTML;
        if (remaining) {
          span.setAttribute("style", remaining);
          span.innerHTML = inner;
          if (span.outerHTML !== before) changed = true;
          continue;
        }
        {
          // No remaining styles — unwrap the span
          const temp = doc.createElement("span");
          temp.innerHTML = inner;
          const parent = span.parentNode;
          if (parent) {
            while (temp.firstChild) {
              parent.insertBefore(temp.firstChild, span);
            }
          }
          span.remove();
          changed = true;
        }
      }
    }

    // Collapse multiple <br> to single
    body.querySelectorAll("br + br").forEach((br) => br.remove());

    // Remove trailing <br> before block-close
    body.querySelectorAll("p > br:last-child, div > br:last-child").forEach(
      (br) => {
        if (
          br.previousSibling &&
          (br.previousSibling.textContent?.trim() ?? "")
        )
          return; // has content before
        if (!br.nextSibling) br.remove(); // trailing br
      }
    );

    // Unwrap bare spans (no attributes). Preserve spans that carry semantic
    // data-* attributes (emoji shortcodes, inline math) so their turndown rules
    // can restore the source syntax.
    body
      .querySelectorAll(
        "span:not([style]):not([class]):not([data-emoji]):not([data-math-inline])"
      )
      .forEach((span) => {
        const parent = span.parentNode;
        if (parent) {
          while (span.firstChild) {
            parent.insertBefore(span.firstChild, span);
          }
        }
        span.remove();
      });

    return body.innerHTML.trim();
  } catch {
    // Fallback: return original with basic regex cleaning
    return html
      .replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, "")
      .replace(/<div>\s*<br\s*\/?>\s*<\/div>/gi, "")
      .replace(/<p>\s*<\/p>/gi, "")
      .replace(/<div>\s*<\/div>/gi, "")
      .replace(/(<br\s*\/?>){2,}/gi, "<br>")
      .trim();
  }
}

// Paste sanitizer: cleans external HTML before insertion
export function sanitizePastedHtml(html: string): string {
  let clean = html
    .replace(/<!--[\s\S]*?-->/g, "") // comments
    .replace(/<meta[^>]*>/gi, "") // meta tags
    .replace(/<link[^>]*>/gi, "") // link tags
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "") // title
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "") // style blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "") // script blocks
    .replace(/<\/?o:[^>]*>/gi, "") // Office namespace tags
    .replace(/<\/?v:[^>]*>/gi, "") // VML tags
    .replace(/<\/?xml[^>]*>/gi, "") // XML tags
    .replace(/class="[^"]*"/gi, "") // class attributes
    .replace(/id="[^"]*"/gi, "") // id attributes
    .replace(/data-[a-z-]+="[^"]*"/gi, "") // data attributes
    .replace(/lang="[^"]*"/gi, "") // lang attributes
    .replace(/dir="[^"]*"/gi, "") // dir attributes
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "") // on* handlers (double-quoted)
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "") // on* handlers (single-quoted)
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "") // on* handlers (unquoted)
    .replace(/(href|src)\s*=\s*"(?:javascript|vbscript):[^"]*"/gi, "") // js: URLs
    .replace(/(href|src)\s*=\s*'(?:javascript|vbscript):[^']*'/gi, ""); // js: URLs

  // DOM pass catches unquoted attributes and control-character-obfuscated URL schemes.
  try {
    const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, "text/html");
    doc.body.querySelectorAll("*").forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
        } else if ((name === "href" || name === "src" || name === "xlink:href") && isDangerousUrl(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
    });
    clean = doc.body.innerHTML;
  } catch {
    // Keep the regex-cleaned version if DOMParser is unavailable.
  }

  // Clean up styles: keep meaningful CSS, strip MS Office noise
  clean = clean.replace(/style="([^"]*)"/gi, (_match, styleContent: string) => {
    const kept = styleContent
      .split(";")
      .filter((dec) => {
        const prop = dec.split(":")[0]?.trim().toLowerCase() ?? "";
        // Keep these CSS properties
        return [
          "color",
          "background-color",
          "background",
          "font-size",
          "font-family",
          "font-weight",
          "font-style",
          "text-decoration",
          "text-align",
          "list-style-type",
          "margin-left",
          "padding-left",
          "vertical-align",
        ].includes(prop);
      })
      .join(";")
      .trim();
    return kept ? `style="${kept}"` : "";
  });

  // Collapse empty elements
  clean = clean
    .replace(/<span\s*>\s*<\/span>/gi, "")
    .replace(/<div\s*>\s*<\/div>/gi, "")
    .replace(/<p\s*>\s*<\/p>/gi, "");

  return clean.trim();
}

// Clean paste: convert CSS to semantic tags, strip all decorative styles.
export function cleanPasteHtml(html: string): string {
  // Start with the standard sanitizer (removes Office junk, keeps meaningful CSS)
  let clean = sanitizePastedHtml(html);

  // Step 1: Convert CSS formatting → semantic tags (before stripping styles)
  // Iterative inside-out: process innermost styled spans first, working outward.
  // This correctly handles Google Docs nested spans (e.g. bold > color > italic).
  const innermostStyledSpan =
    /<span\s+style="([^"]*)">((?:(?!<span\s+style=)[^])*?)<\/span>/gi;
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 20) {
    changed = false;
    iterations++;
    clean = clean.replace(
      innermostStyledSpan,
      (_match: string, style: string, inner: string) => {
        changed = true;
        let out = inner;
        if (/font-weight:\s*(?:bold|[6-9]00)/i.test(style))
          out = `<strong>${out}</strong>`;
        if (/font-style:\s*italic/i.test(style)) out = `<em>${out}</em>`;
        if (/text-decoration:\s*underline/i.test(style))
          out = `<u>${out}</u>`;
        if (/text-decoration:\s*line-through/i.test(style))
          out = `<del>${out}</del>`;
        return out;
      }
    );
  }

  // Also handle <b>/<i> tags from Google Docs (already semantic, keep them)

  // Step 2: Preserve text-align on block elements (structural intent)
  clean = clean.replace(/style="([^"]*)"/gi, (_match, styleContent: string) => {
    const kept = styleContent
      .split(";")
      .filter((dec) => {
        const prop = dec.split(":")[0]?.trim().toLowerCase() ?? "";
        // Only keep structural properties
        return ["text-align", "list-style-type", "vertical-align"].includes(
          prop
        );
      })
      .join(";")
      .trim();
    return kept ? `style="${kept}"` : "";
  });

  // Step 3: Clean up residual empty attributes and whitespace
  clean = clean
    .replace(/\s+style=""/gi, "") // remove empty style attrs
    .replace(/<span\s*>([\s\S]*?)<\/span>/gi, "$1") // unwrap bare spans
    .replace(/<span\s*>\s*<\/span>/gi, "") // remove empty spans
    .replace(/<div\s*>\s*<\/div>/gi, "") // remove empty divs
    .replace(/<p\s*>\s*<\/p>/gi, ""); // remove empty paragraphs

  return clean.trim();
}
