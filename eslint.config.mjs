import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build/runtime output of this repo (vinext bundles, worker state, docs output):
    "dist/**",
    ".vinext/**",
    ".wrangler/**",
    "outputs/**",
    "scraper/**",
  ]),
]);

export default eslintConfig;
