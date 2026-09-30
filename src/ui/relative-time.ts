import { t } from "../i18n";

/**
 * "5m ago" for the library rows. One copy for both lists (it was defined
 * twice, identically, in FolderTree and WorkspacePanel).
 */
export function timeAgo(date: Date | number | string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return t("library.timeJustNow");
  const m = Math.floor(s / 60);
  if (m < 60) return t("library.timeMinutesAgo", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("library.timeHoursAgo", { count: h });
  const d = Math.floor(h / 24);
  if (d < 30) return t("library.timeDaysAgo", { count: d });
  const mo = Math.floor(d / 30);
  if (mo < 12) return t("library.timeMonthsAgo", { count: mo });
  return t("library.timeYearsAgo", { count: Math.floor(mo / 12) });
}
