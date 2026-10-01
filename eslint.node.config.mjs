// ESLint for the Node packages (apps/api, packages/db, infra): the stock
// `@eslint/js` + `typescript-eslint` recommended sets, the same base the
// frontend uses (apps/web/eslint.config.js adds the React hook rules on top).
// Each package re-exports this from its own eslint.config.js, so `eslint .`
// works from the package directory, which is where Turbo runs it.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["**/dist/", "**/cdk.out/", "**/drizzle/", "**/coverage/"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      // `_`-prefixed names are deliberately unused (a handler's unused argument).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
