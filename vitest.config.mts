import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
  resolve: {
    // Mirror the tsconfig "@/*" -> "src/*" alias so tests import like app code.
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
});
