import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    // vitest-pool-workers ≥0.22 (vitest 4) exposes the Workers runtime as a
    // plugin instead of test.poolOptions.workers.
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
    }),
  ],
  test: {
    include: ["src/__tests__/**/*.test.ts"],
  },
});
