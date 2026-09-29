/**
 * Types for `turndown` 7.x, which ships none.
 *
 * Declared here rather than taken from `@types/turndown` so the type gate needs
 * no extra dependency. Without it the import was an implicit `any`, which is
 * why `noImplicitAny` could not be switched on. It covers turndown's whole
 * public surface (the constructor, six methods and `options`), not only what
 * the engine calls today, so a new rule or a `keep()` does not have to come
 * back here first. Source of truth: the JSDoc in
 * node_modules/turndown/lib/turndown.es.js.
 */
declare module "turndown" {
  namespace TurndownService {
    /** A DOM node as turndown hands it to a rule, with the flags it computes. */
    type Node = HTMLElement & {
      isBlock?: boolean;
      isCode?: boolean;
      isBlank?: boolean;
      flankingWhitespace?: { leading: string; trailing: string };
    };

    type FilterFunction = (node: HTMLElement, options: Options) => boolean;
    /** A tag name (lower case), a list of them, or a predicate. */
    type Filter = string | string[] | FilterFunction;
    type ReplacementFunction = (content: string, node: Node, options: Options) => string;

    interface Rule {
      filter: Filter;
      replacement?: ReplacementFunction;
    }

    type Plugin = (service: TurndownService) => void;

    interface Options {
      headingStyle?: "setext" | "atx";
      hr?: string;
      bulletListMarker?: "-" | "+" | "*";
      codeBlockStyle?: "indented" | "fenced";
      fence?: "```" | "~~~";
      emDelimiter?: "_" | "*";
      strongDelimiter?: "__" | "**";
      linkStyle?: "inlined" | "referenced";
      linkReferenceStyle?: "full" | "collapsed" | "shortcut";
      br?: string;
      preformattedCode?: boolean;
      blankReplacement?: ReplacementFunction;
      keepReplacement?: ReplacementFunction;
      defaultReplacement?: ReplacementFunction;
    }
  }

  class TurndownService {
    constructor(options?: TurndownService.Options);
    options: TurndownService.Options;
    /** Convert an HTML string, or an element / document / fragment node. */
    turndown(input: string | HTMLElement | Document | DocumentFragment): string;
    use(plugins: TurndownService.Plugin | TurndownService.Plugin[]): this;
    addRule(key: string, rule: TurndownService.Rule): this;
    keep(filter: TurndownService.Filter): this;
    remove(filter: TurndownService.Filter): this;
    escape(text: string): string;
  }

  export = TurndownService;
}
