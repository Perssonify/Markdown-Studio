import { defineConfig } from "drizzle-kit";

// `bun run db:generate` diffs src/schema against the migrations already in
// ./drizzle and writes the next one. Generating needs no database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
});
