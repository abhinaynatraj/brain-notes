import { defineConfig } from "vitest/config";

// Plain Node test runner for pure-logic tests (no Worker/D1 bindings).
// Used because @cloudflare/vitest-pool-workers cannot resolve module paths
// that contain a space (this project lives under ".../Brain Notes/").
// Worker-bound tests run via vitest.config.js through a space-free symlink
// (see the "test:workers" npm script).
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.js"],
  },
});
