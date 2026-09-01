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
  ]),
  {
    files: ["lib/format.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name=/^(Number|parseFloat|parseInt)$/]",
          message:
            "No float conversion in format.ts. Intl.NumberFormat.format accepts a decimal string and formats it exactly; Number(value) would construct the IEEE-754 double the backend's validator exists to exclude. No test can catch this -- within the money contract every value round-trips identically -- so the lint rule is the enforcement.",
        },
      ],
    },
  },
]);

export default eslintConfig;
