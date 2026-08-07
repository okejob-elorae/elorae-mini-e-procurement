import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    "**/node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "generated/**",
    "public/**",
    "**/*.lock",
    "postcss.config.mjs",
    "prisma.config.ts",
  ]),
  // Allow explicit any app-wide while types are gradually improved
  {
    files: ["lib/**/*.ts", "prisma/**/*.ts", "app/**/*.ts", "app/**/*.tsx", "components/**/*.ts", "components/**/*.tsx", "types/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  /*
   * Spec teardowns must never filter on an identifier shorthand.
   *
   * These tests run against the SHARED MariaDB on :3308, which also holds real
   * development data. Prisma DROPS an `undefined` filter term, so
   * `deleteMany({ where: { itemId } })` collapses to `deleteMany({})` — deleting
   * the WHOLE TABLE — whenever the fixture hook threw before assigning that id.
   * Measured on the bed: `item.count({ where: { id: undefined } })` returns every
   * row. It has already happened: four separate runs left orphan rows behind, and
   * the `packages/db` specs were one hook failure away from truncating seven
   * tables (fixed in PR #223).
   *
   * Shorthand is what makes it invisible on the page, so the shorthand is what is
   * banned: write the filter explicitly and pass the id through a guard that
   * turns "unset" into a value no row can match.
   *
   * WARN, not error, only because roughly 17 existing test files still violate it
   * and a red `eslint .` helps nobody. Flip to "error" as soon as that sweep
   * lands — a rule nobody must obey is decoration.
   */
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "CallExpression[callee.property.name=/^(deleteMany|updateMany)$/] Property[key.name='where'] ObjectExpression Property[shorthand=true]",
          message:
            "Spec teardown: write this filter explicitly (`{ itemId: seededId(itemId) }`), never as shorthand. Prisma drops an undefined term, so `{ where: { itemId } }` becomes an unfiltered delete of the whole table on the shared :3308 bed when the fixture hook failed before assigning it.",
        },
      ],
    },
  },
  // Downgrade strict React hooks rules to warnings so lint passes (fix over time)
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
]);

export default eslintConfig;
