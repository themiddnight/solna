import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import path from "path";
import { fileURLToPath } from "url";
import typeSafetyBaseline from "./eslint.type-safety-baseline.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default tseslint.config([
  globalIgnores([
    "dist",
    "coverage",
    "logs",
    "bun.lockb",
    "node_modules",
    "temp/**",
    "public/**",
    "tests/setup.d.ts",
  ]),
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
        ...globals.jest,
      },
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: [
          "./tsconfig.json",
          "./tsconfig.tests.json",
          "./tsconfig.scripts.json",
        ],
      },
    },
    rules: {
      // ===== Strict type safety =====
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-empty-object-type": "off",

      // ===== Promise safety =====
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: false },
      ],

      // ===== Template safety =====
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],

      // ===== Exhaustiveness & dead code =====
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unnecessary-condition": [
        "error",
        { allowConstantLoopConditions: true },
      ],

      // ===== Strict boolean handling =====
      // Prevent truthy/falsy footguns — force explicit comparisons
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: true,
          allowNullableBoolean: true,
          allowNullableString: true,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],

      // ===== Import hygiene =====
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/consistent-type-exports": "error",

      // ===== Code quality =====
      "prefer-const": "error",
      "no-empty": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/member-ordering": "error",

      // ===== Naming conventions =====
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "interface",
          format: ["PascalCase"],
          custom: { regex: "^I[A-Z]", match: false },
        },
        { selector: "typeAlias", format: ["PascalCase"] },
        { selector: "enum", format: ["PascalCase"] },
        { selector: "enumMember", format: ["PascalCase"] },
        { selector: "class", format: ["PascalCase"] },
        { selector: "function", format: ["camelCase", "PascalCase"] },
        {
          selector: "variable",
          format: ["camelCase", "PascalCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        {
          selector: "variable",
          types: ["boolean"],
          format: ["PascalCase"],
          prefix: ["is", "should", "has", "can", "did", "will"],
        },
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        { selector: "memberLike", format: ["camelCase"] },
        {
          selector: "property",
          format: ["camelCase", "PascalCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
      ],
    },
  },
  {
    files: [
      "scripts/**/*.ts",
      "tests/**/*.ts",
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
      "src/**/__tests__/**/*.ts",
    ],
    rules: {
      "no-console": "off",
      // Relax strict-boolean-expressions in tests — expect(...).toBeTruthy() is idiomatic
      "@typescript-eslint/strict-boolean-expressions": "off",
    },
  },
  {
    // TR-27 ratchet: disabling type-safety rules is forbidden in new runtime code.
    // The cast/disable combo is how the ghost-room bug hid for months
    // (docs/FAILURE_PATTERNS.md Pattern 7). Pre-existing debt is exempted via
    // eslint.type-safety-baseline.mjs — that list may only shrink.
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/**/__tests__/**"],
    plugins: { "eslint-comments": eslintComments },
    rules: {
      "eslint-comments/no-restricted-disable": [
        "error",
        "@typescript-eslint/no-explicit-any",
        "@typescript-eslint/no-unsafe-*",
      ],
    },
  },
  {
    // TR-27 baseline exemption — legacy files only; remove entries as they are cleaned.
    files: typeSafetyBaseline,
    plugins: { "eslint-comments": eslintComments },
    rules: {
      "eslint-comments/no-restricted-disable": "off",
    },
  },
  // TR-20 god-file ratchet: two tiers, lint-enforced via the core `max-lines`
  // rule. Logic files (default tier, below) hard-cap at 800 lines; data/
  // declarative files (constants dirs, constants.ts, *Presets.ts — next block)
  // get a looser 2000-line cap since splitting a data table doesn't improve
  // cohesion. Test files are exempt entirely — scoping to `src/**/*.ts` with
  // the same `ignores` as the TR-27 ratchet above naturally excludes
  // `tests/**` and `scripts/**` (separate lint invocations) plus in-src
  // `*.test.ts` / `*.spec.ts` / `__tests__/**` / `src/testing/**`.
  // Pre-existing violations are grandfathered in eslint-suppressions.json
  // (bunx eslint --suppress-rule) — a SHRINK-ONLY ratchet, same pattern as
  // eslint.type-safety-baseline.mjs for TR-27: entries may only be removed
  // after a file is split, never added to.
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
      "src/**/__tests__/**",
      "src/testing/**",
    ],
    rules: {
      "max-lines": ["error", { max: 800, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    // TR-20 data tier — pure data/declarative files get a looser cap.
    files: [
      "src/**/constants/**/*.ts",
      "src/**/constants.ts",
      "src/**/*Presets.ts",
    ],
    ignores: [
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
      "src/**/__tests__/**",
      "src/testing/**",
    ],
    rules: {
      "max-lines": ["error", { max: 2000, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    // Sockets join the PLAIN roomId (RoomJoinEmitter), so `socket.to(namespace.name)`
    // targets a room nobody is in and is silently dropped. Eight voice broadcasts
    // shipped with this bug before it was found — keep it from returning.
    files: ["src/**/*.ts"],
    ignores: [
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
      "src/**/__tests__/**",
      "src/testing/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='to'][arguments.0.type='MemberExpression'][arguments.0.property.name='name']",
          message:
            "Broadcast to the joined room key (session.roomId), not `namespace.name`. Sockets join the plain roomId, so `socket.to(namespace.name)` reaches nobody. See docs/WS_CONTRACT.md §5.",
        },
      ],
    },
  },
  {
    // FAILURE_PATTERNS Pattern 15 (DEV-350 Task 6) — occupancy-elementId test fixtures must
    // use a shape production can actually emit. `region:`/`chord_block:` prefixes are
    // impossible: the FE builders `getRegionLockId`/`getChordBlockLockId` are identity
    // mappings, so region and chord-block ids reach the server BARE and are classified
    // `container` by `elementKindRegistry`'s bare-id default (there is deliberately no
    // `region:`/`chord_block:` prefix row). A fixture carrying one tests a key that cannot
    // occur at runtime.
    //
    // Mirrors the identical rule in `app/frontend/eslint.config.js` — Pattern 15's claim is
    // not scoped to one package, and the occupancy service itself lives HERE (DEV-350 final
    // fix wave, finding 9). Test files only; production code never hardcodes an elementId.
    // Both `Literal` (quoted) and zero-expression `TemplateLiteral` (backticked) forms are
    // covered — the backticked form was a proven hole in the frontend rule.
    files: [
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
      "src/**/__tests__/**/*.ts",
      "tests/**/*.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^region:/]",
          message:
            "No builder ever produces a 'region:'-prefixed elementId — region ids arrive bare (getRegionLockId is an identity mapping) and resolve to `container` via elementKindRegistry's bare-id default. Use a bare id (e.g. 'region-1') so the fixture matches what production sends.",
        },
        {
          selector: "Literal[value=/^chord_block:/]",
          message:
            "No builder ever produces a 'chord_block:'-prefixed elementId — chord-block ids arrive bare (getChordBlockLockId is an identity mapping) and resolve to `container` via elementKindRegistry's bare-id default. Use a bare id (e.g. 'block-1') so the fixture matches what production sends.",
        },
        {
          selector: "TemplateLiteral[expressions.length=0][quasis.0.value.cooked=/^region:/]",
          message:
            "No builder ever produces a 'region:'-prefixed elementId — region ids arrive bare (getRegionLockId is an identity mapping) and resolve to `container` via elementKindRegistry's bare-id default. Use a bare id (e.g. 'region-1') so the fixture matches what production sends.",
        },
        {
          selector: "TemplateLiteral[expressions.length=0][quasis.0.value.cooked=/^chord_block:/]",
          message:
            "No builder ever produces a 'chord_block:'-prefixed elementId — chord-block ids arrive bare (getChordBlockLockId is an identity mapping) and resolve to `container` via elementKindRegistry's bare-id default. Use a bare id (e.g. 'block-1') so the fixture matches what production sends.",
        },
      ],
    },
  },
]);
