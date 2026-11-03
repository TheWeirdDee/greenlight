import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 90_000, // database suites boot an embedded PostgreSQL; several can start at once on a busy machine
    hookTimeout: 180_000,
    setupFiles: ["tests/helpers/setup.ts"],
  },
});
