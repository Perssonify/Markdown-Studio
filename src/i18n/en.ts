/**
 * The English catalog: the source of truth for every interface string.
 * `MessageKey` is derived from it, so a key that is not here is a type error
 * wherever it is used, and English needs no other file.
 *
 * Entries live in one module per area (`en/<area>.ts`, keys prefixed
 * `<area>.`), merged here. See docs/i18n.md.
 */
import { common } from "./en/common";
import { menu } from "./en/menu";
import { context } from "./en/context";
import { toolbar } from "./en/toolbar";
import { panes } from "./en/panes";
import { pages } from "./en/pages";
import { shortcuts } from "./en/shortcuts";

export const en = {
  ...common,
  ...menu,
  ...context,
  ...toolbar,
  ...panes,
  ...pages,
  ...shortcuts,
};

export type MessageKey = keyof typeof en;
