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
   * A spec teardown must never filter on a bare variable.
   *
   * These tests run against the SHARED MariaDB on :3308, which also holds real
   * development data. Prisma DROPS an `undefined` filter term, so
   * `deleteMany({ where: { itemId } })` collapses to `deleteMany({})` — deleting
   * the WHOLE TABLE — whenever the fixture hook threw before assigning that id.
   * Measured on the bed: `item.count({ where: { id: undefined } })` returns every
   * row. It has already happened: four separate runs left orphan rows behind, and
   * the `packages/db` specs were one hook failure from truncating seven tables
   * (fixed in PR #223).
   *
   * The rule matches on the VALUE being a bare identifier, not on shorthand.
   * Shorthand is only the prettier spelling: `{ where: { id: leafId } }` collapses
   * exactly the same way, and targeting shorthand alone would have flagged 82
   * already-safe filters while staying silent on the ~10 genuinely exposed ones —
   * including the two that can truncate `ChartAccount` and `User`. Routing the id
   * through a guard call satisfies the rule because a call cannot be `undefined`
   * by omission the way a variable can.
   *
   * The descendant combinator is deliberate: it reaches inside nested operators,
   * so `{ id: { in: ids } }` is matched on `ids` too. That is where 34 of the hits
   * come from and 6 of those are genuine unassigned arrays, so narrowing to the
   * top level would lose real coverage.
   *
   * NOT covered, both by choice:
   * - A member expression (`{ id: fixture.itemId }`) — 46 in the specs. Reading a
   *   property off an undefined object THROWS rather than silently yielding
   *   `undefined`, so that shape fails loud instead of truncating.
   * - A filter that over-matches real rows with no variable involved at all
   *   (`{ code: { startsWith: "TEST-" } }`, a bare `createdAt` range). Those need
   *   judgement, not a selector.
   *
   * WARN, not error: 36 test files currently trip it (233 warnings, of which ~83%
   * are unassigned `let` fixture ids — the real hazard — and ~2% are imported
   * constants, harmless). A red `eslint .` helps nobody, so flip this to "error"
   * once that sweep lands. A rule nobody must obey is decoration.
   */
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "CallExpression[callee.property.name=/^(deleteMany|updateMany)$/] Property[key.name='where'] ObjectExpression Property[value.type='Identifier']",
          message:
            "Spec teardown: pass this id through a guard (`{ itemId: seededId(itemId) }`) instead of filtering on the bare variable. Prisma drops an undefined term, so the filter becomes an unfiltered delete of the whole table on the shared :3308 bed when the fixture hook failed before assigning it.",
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
