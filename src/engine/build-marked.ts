import { Marked } from "marked";
import { markedEmoji } from "marked-emoji";
import markedFootnote from "marked-footnote";
import type { MarkdownFeatureSettings } from "../store/settings";
import { EMOJI_MAP } from "./emoji-map";
import { mathBlockExtension, mathInlineExtension } from "./math-marked";

/**
 * Build a configured `marked` instance from the current feature settings.
 * Kept per-instance (not the global singleton) so flavor/feature toggles can
 * change at runtime by rebuilding. Extensions that render to the preview also
 * round-trip back to Markdown via matching rules in turndown-rules.ts.
 */
export function buildMarked(features: MarkdownFeatureSettings): Marked {
  const m = new Marked({
    gfm: features.flavor !== "commonmark",
    breaks: true,
  });

  // Emoji → `<span data-emoji="name">char</span>` so turndown can restore `:name:`.
  if (features.emoji) {
    m.use(
      markedEmoji({
        emojis: EMOJI_MAP,
        renderer: (token: { name: string; emoji: string }) =>
          `<span data-emoji="${token.name}">${token.emoji}</span>`,
      })
    );
  }

  if (features.footnotes) {
    m.use(markedFootnote());
  }

  // LaTeX math → data-attribute placeholders rendered live by the TipTap
  // MathInline/MathBlock nodes (lazy KaTeX). Round-trips via turndown rules.
  if (features.math) {
    m.use({ extensions: [mathBlockExtension, mathInlineExtension] });
  }

  // Per-feature disables (only meaningful when gfm is on). Overriding a
  // tokenizer to return undefined makes marked skip that construct.
  const tokenizer: Record<string, (this: any, src: string) => unknown> = {};
  if (!features.tables) tokenizer["table"] = () => undefined;
  if (features.strikethrough) {
    // marked's default GFM `del` ALSO matches a SINGLE `~…~`, so a stray tilde
    // (e.g. "~32 000") or an unpaired `~` elsewhere renders surrounding prose as
    // strikethrough. Restrict strikethrough to DOUBLE tilde `~~…~~` (GitHub's
    // actual rule); a single `~` stays literal text. (Sub/superscript round-trip
    // as `<sub>`/`<sup>` HTML — see turndown-rules — so no single-tilde meaning.)
    tokenizer["del"] = function (this: any, src: string) {
      const m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(src);
      if (!m) return undefined;
      return { type: "del", raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
    };
  } else {
    tokenizer["del"] = () => undefined;
  }
  if (!features.autolink) {
    tokenizer["url"] = () => undefined;
    tokenizer["autolink"] = () => undefined;
  }
  if (Object.keys(tokenizer).length > 0) {
    m.use({ tokenizer: tokenizer as never });
  }

  // Interactive task lists. marked (gfm) natively detects `- [ ]`/`- [x]` items
  // (its list tokenizer sets `task`/`checked`), so instead of a fragile HTML
  // preprocessor pass we override the RENDERER to emit TipTap-parseable markup —
  // `<ul data-type="taskList"><li data-type="taskItem" data-checked="…">…</li>`
  // (matches TaskList/TaskItem parseHTML). This preserves inline markdown inside
  // each item (bold/links/etc.) because the item body is still parsed by marked.
  // Gated on `taskLists`; when off we keep marked's default (a disabled checkbox),
  // which is the prior behavior. commonmark (gfm off) has no task detection.
  if (features.taskLists && features.flavor !== "commonmark") {
    m.use({
      renderer: {
        // Suppress the default disabled `<input>` — the TaskItem node view (or the
        // data-checked attr, on the headless serialize path) carries the state.
        checkbox() {
          return "";
        },
        listitem(text: string, task: boolean, checked: boolean) {
          if (task) {
            // The checkbox output (now "") was prepended to `text` with a space —
            // trim the leading whitespace so the item body is clean.
            const body = text.replace(/^\s+/, "");
            return `<li data-type="taskItem" data-checked="${checked ? "true" : "false"}">${body}</li>\n`;
          }
          return `<li>${text}</li>\n`;
        },
        list(body: string, ordered: boolean, start: number) {
          // A list is a task list iff its FIRST DIRECT child is a task item.
          // Checking `body.includes(...)` was wrong: a REGULAR list whose item
          // contains a NESTED task list would match the nested taskItem and get
          // mis-tagged as a taskList (putting a plain <li> inside a taskList).
          // The first direct <li> always opens at the start of the body, before
          // any nested list, so its tag alone is the reliable signal.
          const trimmed = body.replace(/^\s+/, "");
          if (!ordered && trimmed.startsWith('<li data-type="taskItem"')) {
            return `<ul data-type="taskList">\n${body}</ul>\n`;
          }
          let out = body;
          // TipTap's schema can't hold task items inside an <ol> (taskItem must live
          // in ul[data-type=taskList]) — a non-standard `1. [ ] x` would otherwise
          // coerce to an empty <ol> + a stray taskList. Demote such DIRECT ordered
          // task items to plain items with a literal [ ]/[x] prefix (survives + round-
          // trips as `1. [ ] x`). Guarded to the no-nested-taskList case so the global
          // replace can never touch a nested task list's items.
          if (
            ordered &&
            trimmed.startsWith('<li data-type="taskItem"') &&
            !out.includes('data-type="taskList"')
          ) {
            out = out.replace(
              /<li data-type="taskItem" data-checked="(true|false)">/g,
              (_m: string, c: string) => `<li>${c === "true" ? "[x] " : "[ ] "}`
            );
          }
          const type = ordered ? "ol" : "ul";
          const startAtt = ordered && start !== 1 ? ` start="${start}"` : "";
          return `<${type}${startAtt}>\n${out}</${type}>\n`;
        },
      } as never,
    });
  }

  // GitHub-style callouts/admonitions. `> [!NOTE]` is valid blockquote syntax, so
  // marked already parses it as a <blockquote> (inline markdown inside works). We
  // override the blockquote RENDERER (gated on `callouts`) to detect a leading
  // `[!TYPE]` marker in the first paragraph and emit `<div data-type="callout"
  // data-callout="type">…</div>` (TipTap Callout parseHTML). This mirrors GitHub's
  // rendering and is a single testable seam — no blockquote-tokenizer surgery.
  if (features.callouts) {
    const CALLOUT = /^\s*<p>\s*\[!(note|tip|important|warning|caution)\]\s*(?:<br\s*\/?>\s*)?/i;
    m.use({
      renderer: {
        blockquote(quote: string) {
          const mk = CALLOUT.exec(quote);
          if (mk) {
            const type = (mk[1] ?? "note").toLowerCase();
            // Strip the marker; if it occupied its own paragraph, drop the now-empty <p>.
            let body = quote.slice(mk[0].length).replace(/^\s*<\/p>\s*/, "");
            if (!/^\s*</.test(body) && body.trim()) body = `<p>${body}`;
            return `<div data-type="callout" data-callout="${type}">\n${body}</div>\n`;
          }
          return `<blockquote>\n${quote}</blockquote>\n`;
        },
      } as never,
    });
  }

  return m;
}
