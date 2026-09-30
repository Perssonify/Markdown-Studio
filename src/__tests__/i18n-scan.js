/**
 * The hard-coded-string scanner behind `i18n-scanner.test.js` (A099).
 *
 * It parses each file with the TypeScript compiler (the same parser the
 * lookbehind guard in converter-escape.test.js uses) and reports every
 * literal that would reach the screen without going through `t()`:
 *
 *  - JSX text with words in it, except inside <code>/<kbd>/<samp>/<pre>,
 *    which hold code and key glyphs, not prose;
 *  - the attributes a user reads or hears: aria-label, aria-description,
 *    title, placeholder, alt — as a string, or as a string inside `{…}`;
 *  - string and template literals in JSX children (`{open ? "Close" : "Open"}`);
 *  - the message of a toast (`toast.show("…")`, `toastSonner.success("…")`)
 *    and its `description`;
 *  - the title and texts handed to the dialog API (`confirm({ title: "…" })`,
 *    `prompt("…", { description: "…" })`).
 *
 * "Words" means two letters in a row in any script, so glyphs (⌘, ·, ×) and
 * single-letter toolbar faces (B, I, U) pass.
 */
import { createRequire } from "module";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const WORDS = /\p{L}{2,}/u;
const CODE_TAGS = new Set(["code", "kbd", "samp", "pre", "style", "script"]);
export const SCANNED_ATTRIBUTES = new Set(["aria-label", "aria-description", "title", "placeholder", "alt"]);
const TOAST_METHODS = /(^|\.)(show|success|error|warning|info|loading|message)$/;
const DIALOG_CALLS = /(^|\.)(confirm|prompt|equation)$/;
const DIALOG_PROPS = new Set(["title", "description", "confirmLabel", "cancelLabel", "placeholder", "message"]);

/** Collapse JSX text the way the JSX transform does, for readable reports. */
function jsxTextValue(raw) {
  return raw.replace(/\s*\n\s*/g, " ").trim();
}

function inCode(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isJsxElement(p)) {
      const tag = p.openingElement.tagName.getText();
      if (CODE_TAGS.has(tag)) return true;
    }
    if (ts.isJsxAttribute(p)) return false;
  }
  return false;
}

/**
 * Every user-visible literal in `source`. Returns `{ line, kind, text }[]`.
 * `file` only selects the parser (.tsx vs .ts).
 */
export function scanSource(source, file = "x.tsx") {
  const kind = file.endsWith(".tsx") || file.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const add = (node, what, text) => {
    found.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, kind: what, text });
  };
  const literalText = (e) => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) return [e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join("…");
    return null;
  };
  // String leaves of an expression that can become the rendered value.
  const leaves = (e, out = []) => {
    if (!e) return out;
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return leaves(e.expression, out);
    if (literalText(e) !== null) out.push(e);
    else if (ts.isConditionalExpression(e)) {
      leaves(e.whenTrue, out);
      leaves(e.whenFalse, out);
    } else if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) leaves(e.right, out);
      else if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.PlusToken) {
        leaves(e.left, out);
        leaves(e.right, out);
      }
    }
    return out;
  };
  const report = (e, what) => {
    for (const leaf of leaves(e)) {
      const text = literalText(leaf);
      if (text !== null && WORDS.test(text)) add(leaf, what, text);
    }
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const text = jsxTextValue(node.getText(sf));
      if (WORDS.test(text) && !inCode(node)) add(node, "jsx-text", text);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (SCANNED_ATTRIBUTES.has(name) && node.initializer) {
        const init = node.initializer;
        if (ts.isStringLiteral(init)) {
          if (WORDS.test(init.text)) add(init, `attr:${name}`, init.text);
        } else if (ts.isJsxExpression(init)) report(init.expression, `attr:${name}`);
      }
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent) && !inCode(node)) {
      report(node.expression, "jsx-expression");
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      const isToast = /toast/i.test(callee) && (TOAST_METHODS.test(callee) || /^toast(Sonner)?$/.test(callee));
      const isDialog = DIALOG_CALLS.test(callee) && !/^window\./.test(callee);
      if (isToast || isDialog) {
        node.arguments.forEach((arg, i) => {
          if (i === 0) report(arg, isToast ? "toast" : "dialog");
          if (ts.isObjectLiteralExpression(arg)) {
            for (const p of arg.properties) {
              if (!ts.isPropertyAssignment(p)) continue;
              const pname = p.name.getText(sf);
              if ((isToast && pname === "description") || (isDialog && DIALOG_PROPS.has(pname))) report(p.initializer, isToast ? "toast" : "dialog");
            }
          }
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Every .ts/.tsx file under the given roots (paths relative to `root`). */
export function sourceFiles(root, entries) {
  const out = [];
  const walk = (abs) => {
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const f of readdirSync(abs)) walk(join(abs, f));
    } else if (/\.tsx?$/.test(abs) && !/\.d\.ts$/.test(abs)) out.push(relative(root, abs).split(sep).join("/"));
  };
  for (const e of entries) walk(join(root, e));
  return out.sort();
}

export function scanFiles(root, files) {
  const out = [];
  for (const file of files) {
    for (const hit of scanSource(readFileSync(join(root, file), "utf8"), file)) out.push({ file, ...hit });
  }
  return out;
}
