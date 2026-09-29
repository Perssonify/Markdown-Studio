// Turndown configuration rules
import TurndownService from "turndown";

// Minimal interface for TurndownService (package has no types)
interface TurndownInstance {
  addRule(
    name: string,
    rule: {
      filter: string | string[] | ((node: Node) => boolean);
      replacement: (content: string, node?: Node) => string;
    }
  ): TurndownInstance;
  turndown(html: string): string;
}

interface FieldEntry {
  key: string;
  value?: string;
}

export function addBaseRules(td: TurndownInstance): TurndownInstance {
  // Math: <span data-math-inline="x"> → $x$ ; <div data-math-block="x"> → $$x$$.
  td.addRule("mathInline", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "SPAN" && el.getAttribute?.("data-math-inline") !== null;
    },
    replacement: (_content: string, node?: Node): string =>
      `$${(node as Element).getAttribute("data-math-inline") ?? ""}$`,
  });
  td.addRule("mathBlock", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "DIV" && el.getAttribute?.("data-math-block") !== null;
    },
    replacement: (_content: string, node?: Node): string =>
      `\n\n$$${(node as Element).getAttribute("data-math-block") ?? ""}$$\n\n`,
  });
  // Emoji: <span data-emoji="name">😄</span> → :name: (round-trips the shortcode).
  td.addRule("emoji", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "SPAN" && !!el.getAttribute?.("data-emoji");
    },
    replacement: (_content: string, node?: Node): string => {
      const el = node as Element;
      return `:${el.getAttribute("data-emoji")}:`;
    },
  });
  // Theme-aware images: <picture> with prefers-color-scheme sources round-trips
  // as raw HTML so it stays a real <picture> in the Markdown (GitHub-compatible).
  td.addRule("themeImagePicture", {
    filter: (node) => (node as Element).nodeName === "PICTURE",
    replacement: (_content: string, node?: Node): string => {
      const el = node as Element;
      // Normalize onto its own lines so marked treats it as an HTML block.
      return `\n\n${el.outerHTML}\n\n`;
    },
  });
  // Sized images keep their dimensions by serializing to an <img> HTML tag
  // (Markdown's ![](…) can't carry width/height). Plain images fall through to
  // Turndown's default image rule.
  td.addRule("sizedImage", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "IMG" && !!(el.getAttribute?.("width") || el.getAttribute?.("height"));
    },
    replacement: (_content: string, node?: Node): string => (node as Element).outerHTML,
  });
  td.addRule("underline", {
    filter: "u",
    replacement: (c) => `<u>${c}</u>`,
  });
  // Serialize sub/superscript as HTML tags (mirrors the <u> underline rule and
  // the MD pane's own <sub>/<sup> insertion). The old `~x~` / `^x^` output
  // collided with marked's strikethrough tokenizer — a subscript round-tripped
  // into <del>, and any stray `~` in prose was rendered as strikethrough.
  td.addRule("subscript", {
    filter: "sub",
    replacement: (c) => `<sub>${c}</sub>`,
  });
  td.addRule("superscript", {
    filter: "sup",
    replacement: (c) => `<sup>${c}</sup>`,
  });
  // Strikethrough. Turndown's CORE has no rule for <s>/<del>/<strike> — that
  // lives in turndown-plugin-gfm, which this project does not load — so the
  // element fell through to the default "keep the text, drop the tag" and the
  // formatting was SILENTLY DESTROYED on every rich→markdown projection.
  // TipTap's Strike renders <s>, so the toolbar's Strike button, ⌘⇧X and
  // Format ▸ Strikethrough all disappeared the moment the panes synced, and
  // fidelity.ts lists strike among the NATIVE marks, so nothing warned either.
  //
  // `~~` (never a single `~`) matches build-marked.ts, which deliberately
  // narrows marked's `del` tokenizer to the GitHub rule so a stray tilde in
  // prose is not strikethrough. An empty or whitespace-only body emits nothing:
  // `~~~~` would otherwise read as a code fence.
  td.addRule("strikethrough", {
    filter: ["s", "del", "strike"] as unknown as string[],
    replacement: (c: string) => (c.trim() ? `~~${c}~~` : c),
  });

  // True only when the <li> is ITSELF a task item — NOT when it merely CONTAINS a
  // nested task list. `querySelector` is recursive, so a plain parent `<li>` with a
  // nested taskList would otherwise match (and get a `- [ ]` marker / be excluded
  // from the tight-list rule). Prefer the authoritative `data-type="taskItem"`;
  // for pasted GFM (bare `<li><input type=checkbox>`), require the checkbox's
  // nearest ancestor `<li>` to be THIS element.
  const isTaskLi = (el: Element): boolean => {
    if (el.nodeName !== "LI") return false;
    if (el.getAttribute && el.getAttribute("data-type") === "taskItem") return true;
    const cb = el.querySelector && el.querySelector('input[type="checkbox"]');
    if (!cb) return false;
    const owner = (cb as Element).closest ? (cb as Element).closest("li") : el;
    return owner === el;
  };

  // Tiptap wraps every <li> content in <p> tags, which Turndown treats as "loose" lists
  // (adding blank lines between items). This rule produces tight list output instead.
  td.addRule("tightListItem", {
    filter: function (node: Node) {
      return (node as Element).nodeName === "LI" && !isTaskLi(node as Element);
    },
    replacement: function (content: string, node?: Node): string {
      const el = node as Element;
      // Strip leading/trailing whitespace and collapse internal blank lines
      content = content.replace(/^\n+/, "").replace(/\n+$/, "");
      content = content.replace(/\n{2,}/g, "\n");

      const parent = el.parentNode;
      let prefix = "- ";
      if (parent && (parent as Element).nodeName === "OL") {
        // Honor the list's `start` attribute so a list beginning at e.g. 5
        // round-trips as `5.` instead of resetting to `1.`.
        const startAttr = (parent as Element).getAttribute("start");
        const start = startAttr ? parseInt(startAttr, 10) : 1;
        const base = Number.isFinite(start) ? start : 1;
        const idx = Array.from((parent as Element).children).indexOf(el);
        prefix = base + idx + ". ";
      }

      // For multi-line content (e.g. nested paragraphs), indent continuation lines
      if (content.includes("\n")) {
        const indent = " ".repeat(prefix.length);
        content = content
          .split("\n")
          .map((line, i) => (i === 0 ? line : line.trim() ? indent + line : ""))
          .filter(Boolean)
          .join("\n");
      }

      return prefix + content + "\n";
    },
  });

  // Plain divs (no style/class) → treat as line break, not paragraph break
  td.addRule("plainDiv", {
    filter: (node) => {
      const el = node as Element;
      return (
        el.nodeName === "DIV" &&
        !el.getAttribute("style") &&
        !el.getAttribute("class") &&
        el.getAttribute("data-math-block") === null
      );
    },
    replacement: (content) => content + "\n",
  });

  // Task lists: TipTap TaskItem renders `<li data-type="taskItem"
  // data-checked="true|false"><label><input …><span/></label><div>…</div></li>`.
  // Prefer the authoritative `data-checked` attribute; fall back to a bare
  // `input[type=checkbox]` (pasted GFM). Nested task lists (nested:true) round-trip
  // by indenting continuation lines under the marker (mirrors tightListItem).
  td.addRule("taskListItem", {
    filter: (node) => isTaskLi(node as Element),
    replacement: (content: string, node?: Node): string => {
      const el = node as Element;
      const dataChecked = el.getAttribute("data-checked");
      const checkbox = el.querySelector('input[type="checkbox"]');
      const checked =
        dataChecked != null
          ? dataChecked === "true" || dataChecked === ""
          : Boolean(checkbox && (checkbox as HTMLInputElement).checked);
      let text = content
        .replace(/^\s*\[[ x]\]\s*/i, "")
        .replace(/^\n+/, "")
        .replace(/\n+$/, "")
        .replace(/\n{2,}/g, "\n");
      const marker = `- [${checked ? "x" : " "}] `;
      if (text.includes("\n")) {
        const indent = " ".repeat(marker.length);
        text = text
          .split("\n")
          .map((line, i) => (i === 0 ? line : line.trim() ? indent + line : ""))
          .filter(Boolean)
          .join("\n");
      }
      return marker + text + "\n";
    },
  });

  // Callouts: <div data-type="callout" data-callout="note">…</div> → > [!NOTE]\n> …
  // Added AFTER plainDiv so LIFO gives it priority (a callout div has no style/class,
  // so plainDiv's filter would otherwise capture it). The body is recursively
  // converted, then each line is blockquote-prefixed.
  td.addRule("callout", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "DIV" && el.getAttribute("data-type") === "callout";
    },
    replacement: (content: string, node?: Node): string => {
      const el = node as Element;
      const type = (el.getAttribute("data-callout") || "note").toUpperCase();
      const body = content.replace(/^\n+/, "").replace(/\n+$/, "").replace(/\n{3,}/g, "\n\n");
      const quoted = body
        .split("\n")
        .map((line) => (line.length ? `> ${line}` : ">"))
        .join("\n");
      return `> [!${type}]\n${quoted}\n\n`;
    },
  });

  // Collapsible <details><summary> — not Markdown, so round-trip as raw HTML.
  // marked passes a block-level <details>…</details> through untouched and the
  // Details/Summary nodes re-parse it. We emit the element's outerHTML verbatim
  // (like the <picture>/sized-image rules) so the disclosure structure + open
  // state survive losslessly; the MD pane shows the raw HTML for this block.
  td.addRule("detailsBlock", {
    filter: "details",
    replacement: (_content: string, node?: Node): string => {
      const el = node as Element;
      const html = el.outerHTML || "";
      return `\n\n${html}\n\n`;
    },
  });

  // Ordered list type preservation: <ol type="a"> → 1. (with comment noting type)
  td.addRule("orderedListType", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "OL" && !!el.getAttribute("type");
    },
    replacement: (content: string, node?: Node): string => {
      const el = node as Element;
      const type = el.getAttribute("type");
      return `<!-- list-type: ${type} -->\n${content}\n`;
    },
  });

  // Wiki links: <a data-doc-link="target">text</a> → [[target]] or [[target|text]]
  td.addRule("wikiLink", {
    filter: (node) => {
      const el = node as Element;
      // Presence, not truthiness: a same-document anchor ([[#Heading]]) has
      // data-doc-link="" (empty target), which is falsy but still a wiki link.
      return el.nodeName === "A" && (el.hasAttribute("data-doc-link") || el.hasAttribute("data-anchor"));
    },
    replacement: (content: string, node?: Node): string => {
      const el = node as Element;
      const target = el.getAttribute("data-doc-link") ?? "";
      const anchor = el.getAttribute("data-anchor") ?? "";
      // Reference reconstructs [[target#anchor]] / [[#anchor]] / [[target]].
      const ref = anchor ? `${target}#${anchor}` : target;
      const display = content.trim();
      if (display === ref) return `[[${ref}]]`;
      return `[[${ref}|${display}]]`;
    },
  });

  // Front matter: <div data-type="frontmatter" data-frontmatter="<json>"> → ---\n…\n---
  td.addRule("frontmatter", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "DIV" && el.getAttribute("data-type") === "frontmatter";
    },
    replacement: (_content: string, node?: Node): string => {
      const el = node as Element;
      let raw = "";
      try {
        const data = el.getAttribute("data-frontmatter");
        if (data) raw = JSON.parse(data) as string;
      } catch {
        // ignore
      }
      return `---\n${raw}\n---\n\n`;
    },
  });

  // Field blocks: <div data-type="field-block" data-fields="[...]"> → :::fields ... :::
  td.addRule("fieldBlock", {
    filter: (node) => {
      const el = node as Element;
      return (
        el.nodeName === "DIV" &&
        el.getAttribute("data-type") === "field-block"
      );
    },
    replacement: (_content: string, node?: Node): string => {
      const el = node as Element;
      let fields: FieldEntry[] = [];
      try {
        const raw = el.getAttribute("data-fields");
        if (raw) fields = JSON.parse(raw) as FieldEntry[];
      } catch {
        // ignore
      }
      if (!fields.length) return "\n\n:::fields\n:::\n\n";
      const lines = fields.map((f) => `${f.key}: ${f.value ?? ""}`);
      return "\n\n:::fields\n" + lines.join("\n") + "\n:::\n\n";
    },
  });

  // Transclusion: <div data-type="transclusion" data-target="..." ...> → ![[target#section]]
  td.addRule("transclusion", {
    filter: (node) => {
      const el = node as Element;
      return (
        el.nodeName === "DIV" &&
        el.getAttribute("data-type") === "transclusion"
      );
    },
    replacement: (_content: string, node?: Node): string => {
      const el = node as Element;
      const target =
        el.getAttribute("data-target") ??
        el.getAttribute("target") ??
        "?";
      const section =
        el.getAttribute("data-section") ?? el.getAttribute("section");
      const blockId =
        el.getAttribute("data-block-id") ?? el.getAttribute("blockid");
      let ref = target;
      if (section) ref += "#" + section;
      if (blockId) ref += "#^" + blockId;
      return "\n\n![[" + ref + "]]\n\n";
    },
  });

  // Block IDs in comments: <!-- block-id:xxx --> after content → append ^xxx
  td.addRule("blockIdComment", {
    filter: (node) => {
      if (node.nodeType === 8) {
        const data = (node as Comment).data?.trim() ?? "";
        return /^block-id:/.test(data);
      }
      return false;
    },
    replacement: (_content: string, node?: Node): string => {
      const data = (node as Comment).data ?? "";
      const id = data.replace("block-id:", "").trim();
      return id ? ` ^${id}` : "";
    },
  });

  // --- GFM TABLE RULES ---
  const getCellAlign = (node: Element): string => {
    const style = (node.getAttribute("style") ?? "").toLowerCase();
    const attr = (node.getAttribute("align") ?? "").toLowerCase();
    return (
      style.match(/text-align:\s*(left|center|right)/)?.[1] ?? attr ?? ""
    );
  };

  const escPipe = (s: string): string =>
    s.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();

  let miniTd: TurndownInstance | null = null;
  const cellToMd = (html: string): string => {
    try {
      if (!miniTd) {
        miniTd = new TurndownService({
          headingStyle: "atx",
          emDelimiter: "*",
        }) as unknown as TurndownInstance;
        miniTd.addRule("underline", {
          filter: "u",
          replacement: (c) => `<u>${c}</u>`,
        });
        miniTd.addRule("styledSpan", {
          filter: (node) => {
            const el = node as Element;
            return Boolean(
              (el.nodeName === "SPAN" || el.nodeName === "DIV") &&
              el.getAttribute?.("style")
            );
          },
          replacement: (content: string, node?: Node): string => {
            const el = node as Element;
            const tag = el.nodeName.toLowerCase();
            const style = el.getAttribute("style") ?? "";
            if (tag === "div")
              return `<div style="${style}">${content}</div>`;
            return `<span style="${style}">${content}</span>`;
          },
        });
        // Math / emoji inside table cells must round-trip too.
        miniTd.addRule("mathInline", {
          filter: (node) => {
            const el = node as Element;
            return el.nodeName === "SPAN" && el.getAttribute?.("data-math-inline") !== null;
          },
          replacement: (_c: string, node?: Node): string =>
            `$${(node as Element).getAttribute("data-math-inline") ?? ""}$`,
        });
        miniTd.addRule("emoji", {
          filter: (node) => {
            const el = node as Element;
            return el.nodeName === "SPAN" && Boolean(el.getAttribute?.("data-emoji"));
          },
          replacement: (_c: string, node?: Node): string =>
            `:${(node as Element).getAttribute("data-emoji")}:`,
        });
        // Sub/superscript round-trip as HTML (mirrors the main ruleset) so a
        // table cell like H<sub>2</sub>O isn't flattened to H2O.
        miniTd.addRule("subscript", { filter: "sub", replacement: (c) => `<sub>${c}</sub>` });
        miniTd.addRule("superscript", { filter: "sup", replacement: (c) => `<sup>${c}</sup>` });
        // Wiki links inside cells → [[target]] / [[target|text]] (else they'd
        // serialize as a broken [text](#) ordinary link).
        miniTd.addRule("wikiLink", {
          filter: (node) => {
            const el = node as Element;
            return el.nodeName === "A" && (el.hasAttribute("data-doc-link") || el.hasAttribute("data-anchor"));
          },
          replacement: (content: string, node?: Node): string => {
            const el = node as Element;
            const target = el.getAttribute("data-doc-link") ?? "";
            const anchor = el.getAttribute("data-anchor") ?? "";
            const ref = anchor ? `${target}#${anchor}` : target;
            const display = content.trim();
            return display === ref ? `[[${ref}]]` : `[[${ref}|${display}]]`;
          },
        });
      }
      return escPipe(miniTd.turndown(html));
    } catch {
      return escPipe(html.replace(/<[^>]+>/g, ""));
    }
  };

  td.addRule("gfmTable", {
    filter: "table",
    replacement: function (_content: string, node?: Node): string {
      const table = node as HTMLTableElement;
      const rows: string[][] = [];
      const alignments: string[] = [];

      table.querySelectorAll("tr").forEach((tr, ri) => {
        const cells: string[] = [];
        tr.querySelectorAll("th, td").forEach((cell, ci) => {
          cells.push(cellToMd(cell.innerHTML));
          if (ri === 0) alignments[ci] = getCellAlign(cell);
        });
        if (cells.length) rows.push(cells);
      });

      if (!rows.length) return "";

      const colCount = Math.max(...rows.map((r) => r.length));
      rows.forEach((row) => {
        while (row.length < colCount) row.push("");
      });
      while (alignments.length < colCount) alignments.push("");

      const widths = new Array(colCount).fill(3);
      rows.forEach((row) =>
        row.forEach((c, i) => {
          widths[i] = Math.max(widths[i], c.length);
        })
      );

      const sep = alignments.map((a, i) => {
        const w = widths[i];
        if (a === "center") return ":" + "-".repeat(Math.max(1, w - 2)) + ":";
        if (a === "right") return "-".repeat(Math.max(1, w - 1)) + ":";
        return "-".repeat(w);
      });

      const pad = (t: string, w: number): string =>
        t + " ".repeat(Math.max(0, w - t.length));
      const fmtRow = (r: string[]): string =>
        "| " + r.map((c, i) => pad(c, widths[i])).join(" | ") + " |";

      const lines: string[] = [];
      lines.push(fmtRow(rows[0]!));
      lines.push("| " + sep.join(" | ") + " |");
      for (let i = 1; i < rows.length; i++) lines.push(fmtRow(rows[i]!));

      return "\n\n" + lines.join("\n") + "\n\n";
    },
  });

  td.addRule("gfmTableSection", {
    filter: ["thead", "tbody", "tfoot", "caption", "colgroup", "col"],
    replacement: (c) => c,
  });
  td.addRule("gfmTableRow", { filter: "tr", replacement: () => "" });
  td.addRule("gfmTableCell", { filter: ["th", "td"], replacement: () => "" });

  return td;
}

export function addInlineStyleRule(td: TurndownInstance): TurndownInstance {
  td.addRule("styledElementsInline", {
    filter: (node) => {
      const el = node as Element;
      return Boolean(
        (el.nodeName === "SPAN" || el.nodeName === "DIV") &&
        el.getAttribute?.("style")
      );
    },
    replacement: (content: string, node?: Node): string => {
      const el = node as Element;
      const tag = el.nodeName.toLowerCase();
      const style = el.getAttribute("style") ?? "";
      if (tag === "div")
        return `<div style="${style}">\n${content}\n</div>\n`;
      return `<span style="${style}">${content}</span>`;
    },
  });
  return td;
}
