export interface Theme {
  bg: string;
  bgAlt: string;
  surface: string;
  glass: string;
  nav: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  border: string;
  borderHover: string;
  hoverBg: string;
  activeBg: string;
  editorBg: string;
  editorBorder: string;
  toolbarBg: string;
  scrollTrack: string;
  scrollThumb: string;
  scrollThumbHover: string;
  accent: string;
  accentHover: string;
  accentBg: string;
  accentBorder: string;
  accentBorderHover: string;
  accentGradient: string;
  accentSolid: string;
  accentShadow: string;
}

const _themeCache: Record<string, Theme> = {};

export const createTheme = (isDark: boolean): Theme => {
  const key = isDark ? "dark" : "light";
  if (_themeCache[key]) return _themeCache[key];
  _themeCache[key] = _createThemeImpl(isDark);
  return _themeCache[key];
};

const _createThemeImpl = (isDark: boolean): Theme => ({
  bg: isDark ? "bg-gray-950" : "bg-gray-50",
  bgAlt: isDark ? "bg-gray-900" : "bg-white",
  surface: isDark ? "bg-gray-900/50" : "bg-white/70",
  glass: isDark
    ? "bg-gray-900/40 backdrop-blur-xl will-change-transform"
    : "bg-white/80 backdrop-blur-xl will-change-transform",
  nav: isDark ? "bg-gray-950/90 backdrop-blur-xl" : "bg-white/90 backdrop-blur-xl",
  text: isDark ? "text-gray-100" : "text-gray-900",
  textMuted: isDark ? "text-gray-400" : "text-gray-500",
  textSubtle: isDark ? "text-gray-500" : "text-gray-400",
  border: isDark ? "border-gray-800/60" : "border-gray-300/60",
  borderHover: isDark ? "border-gray-700" : "border-gray-400",
  hoverBg: isDark ? "hover:bg-gray-800/60" : "hover:bg-gray-100",
  activeBg: isDark ? "active:bg-gray-700/60" : "active:bg-gray-200",
  editorBg: isDark ? "bg-gray-950" : "bg-white",
  editorBorder: isDark ? "border-gray-800" : "border-gray-300",
  toolbarBg: isDark ? "bg-gray-900/80 backdrop-blur-md" : "bg-gray-100/90 backdrop-blur-md",
  scrollTrack: "transparent",
  scrollThumb: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
  scrollThumbHover: isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.22)",
  accent: "text-amber-400",
  accentHover: "hover:text-amber-300",
  accentBg: "bg-amber-500/10",
  accentBorder: "border-amber-500/20",
  accentBorderHover: "hover:border-amber-500/50",
  accentGradient: "from-amber-400 via-orange-400 to-rose-400",
  accentSolid: "bg-gradient-to-r from-amber-500 to-orange-500",
  accentShadow: isDark ? "shadow-amber-500/10" : "shadow-amber-500/20",
});
