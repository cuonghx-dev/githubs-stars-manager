import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests run in the node environment: pipeline code under scripts/ is pure
// Node, and app-side unit tests (schemas, codecs, reasons) need no DOM.
// No network in any test (NFR-10): fakes replace `gh` and the model.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: [
      "scripts/**/*.test.ts",
      "config/**/*.test.ts",
      "src/**/*.test.{ts,tsx}",
    ],
    passWithNoTests: true,
  },
});
