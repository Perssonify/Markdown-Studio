import { cpSync, rmSync } from "node:fs";
import { defineConfig } from "rolldown";

// Two self-contained bundles, so neither a server nor a Lambda needs
// node_modules:
// - dist/server.mjs — the Node server (`bun run start`)
// - dist/lambda/{index,migrate}.mjs — the Lambda handlers infra deploys,
//   with packages/db/drizzle copied beside them for the migration handler.
//
// The AWS SDK is left out of the Lambda bundle: the Node.js runtime provides
// it. pg's optional native binding is never used.
rmSync("dist", { recursive: true, force: true });

// CommonJS dependencies (pg, undici's internals) call require() for Node
// built-ins; ESM output needs a real require for that.
const banner = 'import { createRequire as __pfCreateRequire } from "node:module";\nconst require = __pfCreateRequire(import.meta.url);';

const shared = {
  platform: "node" as const,
  external: [/^@aws-sdk\//, "pg-native"],
  output: { format: "esm" as const, banner, entryFileNames: "[name].mjs", chunkFileNames: "[name]-[hash].mjs", sourcemap: true },
};

export default defineConfig([
  { ...shared, input: { server: "src/server.ts" }, output: { ...shared.output, dir: "dist" } },
  {
    ...shared,
    input: { index: "src/lambda.ts", migrate: "src/migrate-lambda.ts" },
    output: { ...shared.output, dir: "dist/lambda" },
    plugins: [
      {
        name: "copy-migrations",
        writeBundle() {
          cpSync("../../packages/db/drizzle", "dist/lambda/drizzle", { recursive: true });
        },
      },
    ],
  },
]);
