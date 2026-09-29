import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { NodeType } from "@tiptap/pm/model";
import { EMOJI_MAP } from "../engine/emoji-map";

/**
 * Lightweight, dependency-free `:shortcode:` autocomplete for the emoji node.
 *
 * When the user types `:` followed by letters, a small dropdown of matching
 * emoji appears at the caret. Arrow keys move, Enter/Tab select, Escape closes.
 * Selecting inserts the emoji node (so it round-trips like a typed `:name:`).
 * This complements the existing input rule — it does not replace it.
 */
const emojiSuggestionKey = new PluginKey("emojiSuggestion");

type Match = { name: string; char: string };

const ALL: Match[] = Object.entries(EMOJI_MAP).map(([name, char]) => ({ name, char }));

function search(query: string): Match[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const starts: Match[] = [];
  const contains: Match[] = [];
  for (const m of ALL) {
    if (m.name.startsWith(q)) starts.push(m);
    else if (m.name.includes(q)) contains.push(m);
    if (starts.length >= 8) break;
  }
  return [...starts, ...contains].slice(0, 8);
}

/** Find an active `:query` token immediately before the cursor (empty selection). */
function detect(view: EditorView): { from: number; to: number; query: string } | null {
  const { selection } = view.state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  const textBefore = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    "￼"
  );
  // `:` preceded by start-or-whitespace, then word chars, at the very end.
  const m = /(?:^|\s)(:([a-zA-Z0-9_+-]{1,30}))$/.exec(textBefore);
  if (!m) return null;
  const token = m[1]!; // ":query"
  const query = m[2]!;
  const to = selection.from;
  const from = to - token.length;
  return { from, to, query };
}

export function emojiSuggestionPlugin(getType: () => NodeType): Plugin {
  return new Plugin({
    key: emojiSuggestionKey,
    view(editorView) {
      let items: Match[] = [];
      let index = 0;
      let range: { from: number; to: number } | null = null;

      const box = document.createElement("div");
      box.className = "emoji-suggest";
      box.setAttribute("role", "listbox");
      // Marks a surface we attach to <body>, OUTSIDE the editor container. The
      // library stylesheet confines its reset to the editor's own subtrees, and
      // this attribute is how a detached surface stays inside them.
      box.setAttribute("data-pf-portal", "");
      box.style.cssText =
        // fixed (not absolute): absolutely-positioned on <body> it grew the document
        // height when placed low on screen, letting the h-dvh chrome scroll away.
        "position:fixed;z-index:2147483000;display:none;min-width:180px;max-height:220px;overflow-y:auto;" +
        "background:var(--popover,#fff);color:var(--foreground,#111);border:1px solid var(--border,#ccc);" +
        "border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;font-size:13px;";
      document.body.appendChild(box);

      const close = () => {
        box.style.display = "none";
        items = [];
        range = null;
      };

      const render = () => {
        if (!range || items.length === 0) {
          close();
          return;
        }
        box.innerHTML = "";
        items.forEach((it, i) => {
          const row = document.createElement("div");
          row.setAttribute("role", "option");
          row.setAttribute("aria-selected", String(i === index));
          row.style.cssText =
            "display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:5px;cursor:pointer;" +
            (i === index ? "background:color-mix(in srgb,var(--primary,#f59e0b) 18%,transparent);" : "");
          row.innerHTML = `<span style="font-size:16px">${it.char}</span><span style="opacity:.8">:${it.name}:</span>`;
          row.addEventListener("mousedown", (e) => {
            e.preventDefault();
            choose(i);
          });
          box.appendChild(row);
        });
        const coords = editorView.coordsAtPos(range.from);
        // Show first so it has a measurable size, then place it.
        box.style.display = "block";
        const bw = box.offsetWidth || 180;
        const bh = box.offsetHeight || 220;
        // Flip above the caret when there isn't room below, and keep it inside
        // the viewport horizontally.
        const below = coords.bottom + 4;
        const top = below + bh > window.innerHeight ? Math.max(4, coords.top - 4 - bh) : below;
        box.style.left = `${Math.max(4, Math.min(coords.left, window.innerWidth - bw - 4))}px`;
        box.style.top = `${top}px`;
      };

      const choose = (i: number) => {
        if (!range || !items[i]) return;
        const { from, to } = range;
        const type = getType();
        const node = type.create({ name: items[i]!.name, char: items[i]!.char });
        editorView.dispatch(editorView.state.tr.replaceRangeWith(from, to, node));
        close();
        editorView.focus();
      };

      // Expose current state to handleKeyDown via the plugin instance closure.
      (editorView as any).__emojiSuggest = {
        isOpen: () => box.style.display === "block" && items.length > 0,
        move: (delta: number) => {
          if (items.length === 0) return;
          index = (index + delta + items.length) % items.length;
          render();
        },
        accept: () => choose(index),
        close,
      };

      return {
        update(view) {
          const found = detect(view);
          if (!found) {
            if (range) close();
            return;
          }
          const next = search(found.query);
          if (next.length === 0) {
            close();
            return;
          }
          items = next;
          range = { from: found.from, to: found.to };
          if (index >= items.length) index = 0;
          render();
        },
        destroy() {
          box.remove();
          delete (editorView as any).__emojiSuggest;
        },
      };
    },
    props: {
      handleKeyDown(view, event) {
        const s = (view as any).__emojiSuggest;
        if (!s || !s.isOpen()) return false;
        if (event.key === "ArrowDown") { s.move(1); return true; }
        if (event.key === "ArrowUp") { s.move(-1); return true; }
        if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); s.accept(); return true; }
        if (event.key === "Escape") { s.close(); return true; }
        return false;
      },
    },
  });
}
