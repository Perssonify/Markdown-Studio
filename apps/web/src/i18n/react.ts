/**
 * React bindings for the translation layer.
 *
 * `useT()` subscribes the component to the interface language and returns a
 * translate function. Its identity changes exactly when the language does,
 * so a `useMemo`/`useCallback` that lists `t` in its dependencies recomputes
 * on a switch — and because it still reads the language at call time, a
 * callback that captured an older one never shows stale text.
 *
 * `t.rich(key, parts)` is for a sentence that carries markup: the message
 * keeps the whole sentence (so a translator can reorder it) and marks the
 * spans — `"Press <kbd>{keys}</kbd> to save"` — and `parts` supplies the
 * elements. A tag's part is a function of the translated inner text; a
 * `{name}` part is a node or a plain value.
 */
import { createElement, Fragment, type ReactNode, useSyncExternalStore } from "react";
import {
  getLocale,
  localeDir,
  messageFor,
  formatMessage,
  selectForm,
  subscribeLocale,
  t as translate,
  type MessageKey,
  type Vars,
} from "./core";

export type RichPart = ReactNode | ((chunk: string) => ReactNode);
export type RichParts = Readonly<Record<string, RichPart>>;

export interface Translate {
  (key: MessageKey, vars?: Vars): string;
  /** A message with markup: `<tag>…</tag>` spans and `{name}` nodes. */
  rich(key: MessageKey, parts?: RichParts): ReactNode;
}

const TOKEN = /<(\w+)>([\s\S]*?)<\/\1>|\{(\w+)\}/g;

const isPlain = (v: unknown): v is string | number => typeof v === "string" || typeof v === "number";

const plainVars = (parts: RichParts): Record<string, string | number> => {
  const plain: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(parts)) if (isPlain(v)) plain[k] = v;
  return plain;
};

/** Render a catalog message with markup (see `t.rich`). */
export function translateRich(key: MessageKey, parts: RichParts = {}): ReactNode {
  return renderRich(selectForm(messageFor(key), plainVars(parts)["count"]), parts);
}

/**
 * Render a template with markup — a catalog message, or a paragraph from a
 * content module (`localizedContent`). The TEMPLATE is tokenised before any
 * value is inserted, so a value that happens to contain `<b>` or `{x}` (a
 * document title, say) is always text, never structure.
 */
export function renderRich(template: string, parts: RichParts = {}): ReactNode {
  const plain = plainVars(parts);
  const out: ReactNode[] = [];
  let text = "";
  let last = 0;
  const flush = () => {
    if (text) out.push(text);
    text = "";
  };
  for (const m of template.matchAll(TOKEN)) {
    text += template.slice(last, m.index);
    last = m.index + m[0].length;
    const [whole, tag, inner, name] = m;
    const part = parts[(tag ?? name) as string];
    if (tag !== undefined) {
      const chunk = formatMessage(inner ?? "", plain);
      if (typeof part === "function") {
        flush();
        out.push(part(chunk));
      } else {
        text += chunk; // no element supplied: keep the words, drop the markup
      }
    } else if (part === undefined || part === null || isPlain(part)) {
      text += part === undefined || part === null ? whole : String(part);
    } else {
      flush();
      out.push(typeof part === "function" ? part("") : part);
    }
  }
  text += template.slice(last);
  flush();
  if (out.length <= 1 && (out.length === 0 || typeof out[0] === "string")) return out[0] ?? "";
  return out.map((node, i) => createElement(Fragment, { key: i }, node));
}

/** The interface language; re-renders the caller when it changes. */
export function useLocale(): string {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

const bound = new Map<string, Translate>();

function translatorFor(locale: string): Translate {
  let fn = bound.get(locale);
  if (!fn) {
    fn = Object.assign((key: MessageKey, vars?: Vars) => translate(key, vars), {
      rich: (key: MessageKey, parts?: RichParts) => translateRich(key, parts),
    });
    bound.set(locale, fn);
  }
  return fn;
}

/** Translate function for a component; re-renders it on a language change. */
export function useT(): Translate {
  return translatorFor(useLocale());
}

/** `lang`/`dir` for an element that should follow the interface language. */
export function localeAttributes(locale: string = getLocale()): { lang: string; dir: "ltr" | "rtl" } {
  return { lang: locale, dir: localeDir(locale) };
}
