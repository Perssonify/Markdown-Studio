/**
 * The English catalog: the source of truth for every interface string.
 * `MessageKey` is derived from it, so a key that is not here is a type error
 * wherever it is used, and English needs no other file.
 *
 * Entries live in one module per area (`en/<area>.ts`, keys prefixed
 * `<area>.`), merged here. See docs/i18n.md.
 */
import { common } from "./en/common";
import { app } from "./en/app";
import { menu } from "./en/menu";
import { context } from "./en/context";
import { toolbar } from "./en/toolbar";
import { panes } from "./en/panes";
import { status } from "./en/status";
import { settings } from "./en/settings";
import { find } from "./en/find";
import { library } from "./en/library";
import { graph } from "./en/graph";
import { cards } from "./en/cards";
import { dialogs } from "./en/dialogs";
import { notices } from "./en/notices";
import { tour } from "./en/tour";
import { pages } from "./en/pages";
import { editor } from "./en/editor";
import { shortcuts } from "./en/shortcuts";

export const en = {
  ...common,
  ...app,
  ...menu,
  ...context,
  ...toolbar,
  ...panes,
  ...status,
  ...settings,
  ...find,
  ...library,
  ...graph,
  ...cards,
  ...dialogs,
  ...notices,
  ...tour,
  ...pages,
  ...editor,
  ...shortcuts,
};

export type MessageKey = keyof typeof en;
