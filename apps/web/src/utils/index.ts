// Script loader with global verification
export function loadScript(
  src: string,
  globalName?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (globalName && (window as unknown as Record<string, unknown>)[globalName]) {
      resolve();
      return;
    }
    if (document.querySelector(`script[src="${src}"]`)) {
      if (globalName) {
        let attempts = 0;
        const check = setInterval(() => {
          if ((window as unknown as Record<string, unknown>)[globalName]) {
            clearInterval(check);
            resolve();
          } else if (++attempts > 50) {
            clearInterval(check);
            reject(new Error(`${globalName} not available after loading ${src}`));
          }
        }, 100);
      } else {
        resolve();
      }
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => {
      if (globalName && !(window as unknown as Record<string, unknown>)[globalName]) {
        reject(new Error(`Script loaded but ${globalName} not found: ${src}`));
      } else {
        resolve();
      }
    };
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

// Parse rgb/rgba/hex to hex
export function rgbHex(rgb: string | null | undefined): string | null {
  if (!rgb) return null;
  if (rgb.startsWith("#")) return rgb;
  const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m
    ? "#" +
        [m[1]!, m[2]!, m[3]!]
          .map((n) => parseInt(n, 10).toString(16).padStart(2, "0"))
          .join("")
    : null;
}

// Simple fast hash for content comparison
export function quickHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

// Undo-friendly textarea replacement via execCommand("insertText")
export function taReplace(
  ta: HTMLTextAreaElement,
  start: number,
  end: number,
  newText: string
): void {
  ta.focus();
  ta.selectionStart = start;
  ta.selectionEnd = end;
  if (
    document.queryCommandSupported &&
    document.queryCommandSupported("insertText")
  ) {
    document.execCommand("insertText", false, newText);
  } else {
    const before = ta.value.substring(0, start);
    const after = ta.value.substring(end);
    ta.value = before + newText + after;
  }
}

// Replace entire textarea value preserving undo where possible
export function taSetValue(
  ta: HTMLTextAreaElement,
  newValue: string,
  cursorStart?: number,
  cursorEnd?: number
): void {
  taReplace(ta, 0, ta.value.length, newValue);
  if (cursorStart != null) {
    ta.selectionStart = Math.min(cursorStart, newValue.length);
    ta.selectionEnd = Math.min(cursorEnd ?? cursorStart, newValue.length);
  }
}

// Save and restore cursor position in contentEditable
export function saveCursorPosition(el: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return null;
  const range = sel.getRangeAt(0);
  const preRange = document.createRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

export function restoreCursorPosition(
  el: HTMLElement,
  offset: number | null | undefined
): void {
  if (offset == null || !el.childNodes.length) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const nodeLen = node.textContent?.length ?? 0;
    if (pos + nodeLen >= offset) {
      try {
        const sel = window.getSelection();
        if (!sel) return;
        const range = document.createRange();
        range.setStart(node, Math.min(offset - pos, nodeLen));
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {
        // ignore
      }
      return;
    }
    pos += nodeLen;
  }
}
