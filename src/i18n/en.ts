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
import { status } from "./en/status";
import { settings } from "./en/settings";
import { graph } from "./en/graph";
import { cards } from "./en/cards";
import { dialogs } from "./en/dialogs";
import { notices } from "./en/notices";
import { pages } from "./en/pages";
import { shortcuts } from "./en/shortcuts";

export const en = {
  ...common,
  ...menu,
  ...context,
  ...toolbar,
  ...panes,
  ...status,
  ...settings,
  ...graph,
  ...cards,
  ...dialogs,
  ...notices,
  ...pages,
  ...shortcuts,
};

export type MessageKey = keyof typeof en;
