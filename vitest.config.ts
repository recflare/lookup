import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The Hyperdrive binding needs a local connection string even for tests that
// never touch the database. Wrangler reads it from this variable (set it in
// .env to run tests against the real database).
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??=
  "postgresql://test:test@127.0.0.1:5432/test";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
