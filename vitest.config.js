import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Worker-bound tests (D1, bindings). Run via the "test:workers" npm script,
// which invokes vitest through a space-free symlink path — the pool-workers
// runtime (workerd) cannot resolve module paths containing a space, and this
// project's real path (".../Brain Notes/") has one. Pure-logic tests use
// vitest.config.node.js instead.
export default defineWorkersConfig({
  test: {
    include: ["test/workers/**/*.test.js"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: ["DB"],
        },
      },
    },
  },
});
