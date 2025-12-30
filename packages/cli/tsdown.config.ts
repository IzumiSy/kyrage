/// <reference types="node" />
import { defineConfig } from "tsdown";

const devOpts =
  process.env.NODE_ENV === "development"
    ? {
        minify: false,
        sourcemap: true,
        splitting: false,
      }
    : {};

export default defineConfig({
  format: ["esm"],
  entry: ["src/main.ts", "src/index.ts"],
  dts: true,
  minify: true,
  clean: true,
  ...devOpts,
});
