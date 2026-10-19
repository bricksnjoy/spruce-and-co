import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    // every file stands up its own in-memory Postgres; keep them apart
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
