/**
 * Stylesheets imported for their side effects (`import "./styles.css"`).
 *
 * TypeScript 6 turned `noUncheckedSideEffectImports` on by default, so a
 * side-effect import must now resolve to something the checker can see; a
 * stylesheet has no types, and Vite's bundler handles it. Declaring the CSS
 * shapes here — rather than switching the check off — keeps it working for
 * every JavaScript module, where a mistyped side-effect import is a real bug.
 */
declare module "*.css";
// Font packages whose entry point is a stylesheet.
declare module "@fontsource-variable/geist";
declare module "@fontsource-variable/inter";
