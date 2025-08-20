import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 50000,
    testTimeout: 20000,
  },
});
