import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import pluginQuery from '@tanstack/eslint-plugin-query'
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments'
import pluginLingui from 'eslint-plugin-lingui'
import pluginI18next from 'eslint-plugin-i18next'
import boundaries from 'eslint-plugin-boundaries'
import { globalIgnores } from 'eslint/config'
import path from 'path'
import { fileURLToPath } from 'url'
import typeSafetyBaseline from './eslint.type-safety-baseline.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default tseslint.config([
  globalIgnores(['dist', '.claude/', 'playwright-report/', 'test-results/', 'coverage/', 'src/locales/**/*.js', 'poc/']),
  ...pluginQuery.configs['flat/recommended'],
  {
    // Ratchet rule: bare eslint-disable is forbidden in source files.
    // Test files are excluded here; their bare disables will be resolved in DEV-161 Phase 2.
    files: [
      'src/**/*.ts',
      'src/**/*.tsx',
    ],
    ignores: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
      'src/**/__tests__/**',
      'src/test/**',
    ],
    plugins: { 'eslint-comments': eslintComments },
    rules: {
      'eslint-comments/no-unlimited-disable': 'error',
      // TR-27 ratchet: disabling type-safety rules is forbidden in new code.
      // The cast/disable combo is how the ghost-room bug hid for months
      // (FAILURE_PATTERNS.md Pattern 7). Pre-existing debt is exempted via
      // eslint.type-safety-baseline.mjs — that list may only shrink.
      'eslint-comments/no-restricted-disable': [
        'error',
        '@typescript-eslint/no-explicit-any',
        '@typescript-eslint/no-unsafe-*',
      ],
    },
  },
  // TR-20 god-file ratchet: two tiers, lint-enforced via the core `max-lines`
  // rule. Logic files (default tier, below) hard-cap at 800 lines; data/
  // declarative files (constants dirs, constants.ts, *Presets.ts — next block)
  // get a looser 2000-line cap since splitting a data table doesn't improve
  // cohesion. Test files are exempt entirely (excluded via `ignores` below,
  // same pattern as the bare-disable ratchet above) — test length tracks
  // scenario count, not architectural health.
  // Pre-existing violations are grandfathered in eslint-suppressions.json
  // (bunx eslint --suppress-rule) — a SHRINK-ONLY ratchet, same pattern as
  // eslint.type-safety-baseline.mjs for TR-27: entries may only be removed
  // after a file is split, never added to.
  {
    files: [
      'src/**/*.ts',
      'src/**/*.tsx',
    ],
    ignores: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
      'src/**/__tests__/**',
      'src/test/**',
      'src/test-utils/**',
    ],
    rules: {
      'max-lines': ['error', { max: 800, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    // TR-20 data tier — pure data/declarative files get a looser cap.
    files: [
      'src/**/constants/**/*.ts',
      'src/**/constants/**/*.tsx',
      'src/**/constants.ts',
      'src/**/*Presets.ts',
      'src/**/*.data.ts',
    ],
    ignores: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
      'src/**/__tests__/**',
      'src/test/**',
      'src/test-utils/**',
    ],
    rules: {
      'max-lines': ['error', { max: 2000, skipBlankLines: false, skipComments: false }],
    },
  },
  // Room/Engine re-layering (relayering 3-G) — full four-layer boundary gate.
  //
  // Layering (top imports bottom, never the reverse):
  //   shell (src/pages/**)     — route shells only (TR-37)
  //     -> feature, driver, engine, shared
  //   feature (src/features/**)
  //     -> feature (same-tier), driver, engine, shared
  //   driver (src/drivers/**)
  //     -> engine, shared
  //   engine (src/engine/**)   — room-agnostic core
  //     -> engine, shared
  //   shared (src/shared/**)   — leaf; must not reach upward into app layers
  //     -> shared
  //
  // `default: 'disallow'` + an explicit `allow` rule per `from` type is what
  // makes this a real matrix (not a `default: allow` + spot-disallow list,
  // which only catches edges we thought to name). Any edge between two
  // CLASSIFIED elements that isn't in the allow-list below is a violation.
  //
  // This default only ever applies to edges between two CLASSIFIED elements:
  // the plugin's dependency rule skips evaluation entirely for dependencies
  // that resolve to an unknown/unclassified local path (`checkUnknownLocals`
  // defaults to false) or to an external/bare-specifier import
  // (`checkAllOrigins` defaults to false) — see node_modules/eslint-plugin-
  // boundaries dist/Rules/Dependencies.js. So src/app-config, src/types,
  // src/test, src/test-utils, src/locales, and every npm package import pass
  // through unexamined without needing extra allow-list entries here.
  // Verified empirically: no unclassified-dir or external-package import is
  // flagged.
  //
  // `eslint-suppressions.json` (bunx eslint --suppress-rule) grandfathers the
  // pre-existing layer-inversions found when this matrix went from Phase-1's
  // engine-only guard to the full chain. It is a SHRINK-ONLY ratchet, same
  // pattern as eslint.type-safety-baseline.mjs for TR-27 — entries may only be
  // removed as debt is paid down, never added to. Tracked in
  // docs/architecture/ROOM_ENGINE_RELAYERING_BACKLOG.md.
  //
  // The engine's inbound invariant from Phase 1 (engine ⊄ feature/driver) is
  // SUBSUMED here, not weakened: engine's allow-list below only ever lists
  // `engine` and `shared` as valid `to` types, so any engine -> feature/driver
  // edge is still a hard violation with zero suppression entries permitted.
  // See .superpowers/sdd/task-1b.5-brief.md (Phase 1) and
  // .superpowers/sdd/slice-G-report.md (this slice).
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
      'src/**/__tests__/**',
      'src/test/**',
    ],
    plugins: { boundaries },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.app.json',
        },
      },
      'boundaries/elements': [
        { type: 'shell', pattern: 'src/pages/**' },
        { type: 'engine', pattern: 'src/engine/**' },
        { type: 'driver', pattern: 'src/drivers/**' },
        { type: 'shared', pattern: 'src/shared/**' },
        // Room sub-features are architectural silos (FC-1: perform = live jam,
        // arrange = DAW). Declared BEFORE the generic feature pattern so the
        // more specific match wins. room-common is the orchestration layer
        // (useRoom, room switching) and may reach into both silos; the silos
        // must never import each other.
        { type: 'room-perform', pattern: 'src/features/rooms/perform/**' },
        { type: 'room-arrange', pattern: 'src/features/rooms/arrange/**' },
        { type: 'room-common', pattern: 'src/features/rooms/shared/**' },
        { type: 'feature', pattern: 'src/features/**' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            {
              from: { type: 'shell' },
              allow: { to: { type: ['feature', 'room-perform', 'room-arrange', 'room-common', 'driver', 'engine', 'shared'] } },
            },
            {
              from: { type: 'feature' },
              allow: { to: { type: ['feature', 'room-perform', 'room-arrange', 'room-common', 'driver', 'engine', 'shared'] } },
            },
            // Perform and Arrange are separate room architectures (FC-1) and
            // must never import each other. Both may use ordinary features
            // (effects, instruments, audio) and the room-common orchestration layer.
            {
              from: { type: 'room-perform' },
              allow: { to: { type: ['room-perform', 'room-common', 'feature', 'driver', 'engine', 'shared'] } },
            },
            {
              from: { type: 'room-arrange' },
              allow: { to: { type: ['room-arrange', 'room-common', 'feature', 'driver', 'engine', 'shared'] } },
            },
            // room-common orchestrates both silos (useRoom, room switch, session
            // conversion) — the only element allowed to see perform AND arrange.
            {
              from: { type: 'room-common' },
              allow: { to: { type: ['room-common', 'room-perform', 'room-arrange', 'feature', 'driver', 'engine', 'shared'] } },
            },
            {
              from: { type: 'driver' },
              allow: { to: { type: ['engine', 'shared'] } },
            },
            {
              from: { type: 'engine' },
              allow: { to: { type: ['engine', 'shared'] } },
            },
            {
              from: { type: 'shared' },
              allow: { to: { type: ['shared'] } },
            },
          ],
          message:
            '{{from.type}} must not import from {{to.type}} — see the room/engine layering matrix in eslint.config.js',
        },
      ],
    },
  },
  // TR-27 baseline exemption — legacy files only; remove entries as they are cleaned.
  // When the list is empty the block is omitted (flat-config requires files to be non-empty).
  ...(typeSafetyBaseline.length > 0
    ? [{
        files: typeSafetyBaseline,
        plugins: { 'eslint-comments': eslintComments },
        rules: {
          'eslint-comments/no-restricted-disable': 'off',
        },
      }]
    : []),
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'eslint-comments': eslintComments,
      lingui: pluginLingui,
      i18next: pluginI18next,
    },
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: [
          './tsconfig.app.json',
          './tsconfig.node.json',
          './tsconfig.server.json',
          './tsconfig.test.json',
          './tsconfig.e2e.json',
          './tsconfig.scripts.json',
        ],
      },
    },
    rules: {
      // ===== Lingui i18n rules =====
      'lingui/t-call-in-function': 'error',

      // ===== i18n literal check rules =====
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': {
            exclude: [
              'className',
              'styleName',
              'style',
              'type',
              'key',
              'id',
              'width',
              'height',
              'to',
              'href',
              'src',
              'icon',
              'role',
              'aria-.*',
              // Kit convention: non-translatable identifier props mirroring the
              // native aria-*/data-* attributes (e.g. Select.Simple).
              'ariaLabel',
              'dataTestId',
              // Test-ID props — never user-facing, always stable identifiers.
              'testId',
              'splitterTestId',
              // SplitTabWorkspaceShell tab identity props — stable TabId union
              // values (matched against tab ids / used for conflict resolution),
              // never user-facing copy. `conflictFallbacks` holds { top, bottom }
              // TabId values (the rule descends into the object literal).
              'defaultTopTab',
              'defaultBottomTab',
              'conflictFallbacks',
              // Radix kit identity prop (Tabs/Select/RadioGroup item values) —
              // a stable internal key, never user-facing copy.
              'value',
              'boxClassName',
              'okButtonClassName',
              'contentClassName',
              'overlayClassName',
              'labelClassName',
              'size',
              'color',
              'variant',
              'placement',
              'offset',
              'align',
              'ref',
              'data-.*',
              'okText',
              'cancelText',
              // SVG / Konva presentation attributes
              'stroke',
              'fill',
              'strokeWidth',
              'strokeDasharray',
              'fontStyle',
              'fontSize',
              'fontFamily',
              'fontWeight',
              'textAnchor',
              'verticalAlign',
              'listening',
              'text',
              // Storage keys & technical identifiers
              'storageKey',
            ],
          },
          'jsx-components': {
            exclude: ['Trans', 'Link', 'Icon'],
          },
        },
      ],

      // ===== Strict type safety =====
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // ===== Promise safety =====
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: false },
      ],

      // ===== Template safety =====
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],

      // ===== Exhaustiveness & dead code =====
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        { allowConstantLoopConditions: true },
      ],

      // ===== Strict boolean handling =====
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
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
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',

      // ===== Code quality =====
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/member-ordering': 'error',

      // ===== Naming conventions =====
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: { regex: '^I[A-Z]', match: false },
        },
        { selector: 'typeAlias', format: ['PascalCase'] },
        { selector: 'enum', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        { selector: 'class', format: ['PascalCase'] },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        {
          selector: 'variable',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'variable',
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'should', 'has', 'can', 'did', 'will'],
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'memberLike', format: ['camelCase'] },
        {
          selector: 'property',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        {
          // Quote-required keys carry their own naming domain: CSS custom
          // properties (`--sheet-drag-offset`), data-/aria- attributes, etc.
          // Covers both object literals (`{ "aria-hidden": true }`) and type
          // literal members (`type Props = { "aria-hidden"?: boolean }`).
          selector: ['objectLiteralProperty', 'typeProperty'],
          format: null,
          modifiers: ['requiresQuotes'],
        },
      ],
    },
  },
  {
    // Generated data files keyed by an external catalog's own IDs (DEV-311's
    // trimTable.data.ts: GM/soundfont instrument IDs, snake_case, mirrored
    // verbatim as object keys) — same rationale as the `scripts/**/*.ts`
    // override further below for the Iconify API's `not_found` field: the
    // naming domain is the external source's, not this codebase's. Placed
    // after the main naming-convention block above so it actually wins
    // (flat config: later entries override earlier ones for the same file).
    files: ['src/**/*.data.ts'],
    rules: {
      '@typescript-eslint/naming-convention': 'off',
    },
  },
  {
    files: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
      'src/**/__tests__/**/*.ts',
      'src/**/__tests__/**/*.tsx',
      'src/test/**/*',
      'e2e/**/*.ts',
      'e2e/**/*.tsx',
    ],
    rules: {
      'no-console': 'off',
      // Relax strict-boolean-expressions in tests — expect(...).toBeTruthy() is idiomatic
      '@typescript-eslint/strict-boolean-expressions': 'off',
    },
  },
  // UDF guard — components must read via selectors and write via store actions.
  // Enforced as 'error' repo-wide since Phase 4 (test files exempted below; this.setState exempted via selector).
  // Spans two blocks: .tsx (reads + writes, below) and .ts (writes only, next block).
  // See docs/adr/2026-07-05-frontend-unidirectional-data-flow.md
  {
    files: ['src/**/*.tsx'],
    ignores: [
      'src/**/*.test.tsx',
      'src/**/*.spec.tsx',
      'src/**/__tests__/**',
      'src/test/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='getState']",
          message:
            'UDF: components read stores via selector hooks. Move getState() into a store action, service, or feature hook.',
        },
        {
          selector: "CallExpression[callee.property.name='setState'][callee.object.type!='ThisExpression']",
          message:
            'UDF: components mutate stores via actions only. Move setState() into a named store action.',
        },
      ],
    },
  },
  // Companion sync boundary — perform components must write companion state via
  // usePerformCompanionActions (which pairs the broadcast), never a raw roomStore
  // companion setter. Prevents the "set locally, forget to broadcast" desync (TR-36).
  // Only these four optimistic setters are the leak surface: the other companion
  // setters are inbound-sync-only (setCompanions/setCompanionState/setCompanionChordState)
  // or broadcast-only commands with echo-driven local state (setCompanionChordLength),
  // none of which a component pairs with a hand-written broadcast.
  // See docs/superpowers/archive/2026-07/specs/2026-07-05-perform-companion-sync-facade-design.md
  {
    files: ['src/features/rooms/perform/components/**/*.tsx'],
    ignores: [
      'src/**/*.test.tsx',
      'src/**/*.spec.tsx',
      'src/**/__tests__/**',
      'src/test/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='getState']",
          message:
            'UDF: components read stores via selector hooks. Move getState() into a store action, service, or feature hook.',
        },
        {
          selector: "CallExpression[callee.property.name='setState'][callee.object.type!='ThisExpression']",
          message:
            'UDF: components mutate stores via actions only. Move setState() into a named store action.',
        },
        {
          selector:
            "MemberExpression[property.name=/^(updateCompanion|setCompanionChordProgression|setCompanionProgressionFlavor|setCompanionPresetControls)$/]",
          message:
            'Companion boundary: write companion state via usePerformCompanionActions (it pairs the broadcast), not a raw roomStore setter. See the perform companion sync facade spec.',
        },
      ],
    },
  },
  // UDF guard (.ts) — hooks must write via named actions, not anonymous setState.
  // getState() is intentionally NOT restricted here: ADR rule 2 permits it inside
  // store actions, services, and feature hooks. Stores and services legitimately
  // call setState (e.g. projectSerializer) and are exempt.
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      'src/**/__tests__/**',
      'src/test/**',
      'src/**/stores/**',
      'src/**/services/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='setState'][callee.object.type!='ThisExpression']",
          message:
            'UDF: write store state through a named action, not an anonymous setState from a .ts hook.',
        },
      ],
    },
  },
  // Restricted imports (two guards share one block because ESLint flat config
  // replaces — not merges — a rule's options across overlapping `files`):
  //   1. Central icon layer (DEV-239/DEV-248) — only src/shared/ui/icon may
  //      import @iconify/react directly; everything else uses the Icon primitive.
  //   2. NoteDispatch epic (DEV-251/DEV-255) — instrument engines are created
  //      ONLY by InstrumentEnginePool, and notes play through NoteDispatch. No
  //      caller may import createEngine to build engines by hand again (the
  //      companion regression this epic removed). The pool + engine barrel reach
  //      the factory via relative paths, so this alias guard never blocks them.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/shared/ui/icon/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@iconify/react',
              message:
                'Import { Icon } from "@/shared/ui" instead. Register new icons in src/shared/ui/icon/registry.ts. (DEV-239)',
            },
            {
              name: '@/engine/instruments/shared/engineFactory',
              importNames: ['createEngine'],
              message:
                'Do not build engines by hand. Create them via InstrumentEnginePool (getOrCreateEngine) and play notes through NoteDispatch. (DEV-251)',
            },
            {
              name: '@/engine/instruments',
              importNames: ['createEngine'],
              message:
                'Do not build engines by hand. Create them via InstrumentEnginePool (getOrCreateEngine) and play notes through NoteDispatch. (DEV-251)',
            },
          ],
        },
      ],
    },
  },
  // DEV-350 Task 6 anti-regression guard — occupancy-elementId test fixtures
  // must be built from the real collaborationLocks builders, never a
  // hand-picked string. `region:`/`chord_block:` are impossible prefixes:
  // getRegionLockId(regionId)/getChordBlockLockId(blockId) are identity
  // mappings (see shared/src/constants/elementKindRegistry.ts's "there is
  // deliberately no region:/chord_block: prefix row" note) — no builder in
  // the codebase can ever emit either prefix. A fixture carrying one is by
  // definition testing a key production can't produce (DEV-350 round 2,
  // task-6-report.md). Scoped to test files only — production code never
  // has a reason to hardcode either prefix in the first place.
  {
    files: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
      'src/**/__tests__/**/*.ts',
      'src/**/__tests__/**/*.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^region:/]',
          message:
            "No builder ever produces a 'region:'-prefixed elementId — getRegionLockId(regionId) in arrange/utils/collaborationLocks.ts is an identity mapping (bare id, classified `container` only via elementKindRegistry's bare-id default). Call getRegionLockId(...) instead of hardcoding this string.",
        },
        {
          selector: 'Literal[value=/^chord_block:/]',
          message:
            "No builder ever produces a 'chord_block:'-prefixed elementId — getChordBlockLockId(blockId) in arrange/utils/collaborationLocks.ts is an identity mapping (bare id, classified `container` only via elementKindRegistry's bare-id default). Call getChordBlockLockId(...) instead of hardcoding this string.",
        },
        // A `Literal` node is a quoted string only: `` `region:r1` `` (backticks, no
        // interpolation) is a TemplateLiteral and slipped straight through the two rules
        // above — proven by probe in the DEV-350 final fix wave (finding 9). An
        // interpolated template (`` `region:${id}` ``) is deliberately NOT matched here:
        // its cooked value isn't statically known, and the `expressions.length=0` guard
        // keeps the rule to what it can actually prove.
        {
          selector: 'TemplateLiteral[expressions.length=0][quasis.0.value.cooked=/^region:/]',
          message:
            "No builder ever produces a 'region:'-prefixed elementId — getRegionLockId(regionId) in arrange/utils/collaborationLocks.ts is an identity mapping (bare id, classified `container` only via elementKindRegistry's bare-id default). Call getRegionLockId(...) instead of hardcoding this template literal.",
        },
        {
          selector: 'TemplateLiteral[expressions.length=0][quasis.0.value.cooked=/^chord_block:/]',
          message:
            "No builder ever produces a 'chord_block:'-prefixed elementId — getChordBlockLockId(blockId) in arrange/utils/collaborationLocks.ts is an identity mapping (bare id, classified `container` only via elementKindRegistry's bare-id default). Call getChordBlockLockId(...) instead of hardcoding this template literal.",
        },
      ],
    },
  },
  {
    // Production frontend server (Bun runtime, not the browser bundle).
    files: ['server.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // TS + @types/bun already validate identifiers; no-undef misfires on Bun.
      'no-undef': 'off',
      // A server entrypoint legitimately logs its startup state.
      'no-console': 'off',
    },
  },
  {
    // Build/maintenance CLI scripts (Bun runtime, DEV-250 icon bundling +
    // validation). Not part of the browser bundle.
    files: ['scripts/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // CLI scripts report progress/results to stdout.
      'no-console': 'off',
      // The Iconify HTTP API returns a snake_case `not_found` field; the
      // response interface must mirror that external wire shape verbatim.
      '@typescript-eslint/naming-convention': 'off',
    },
  },
  {
    // Dev-only playback telemetry surface (DEV-353). Console output IS its interface; the
    // whole module is behind import.meta.env.DEV and never reaches the production bundle.
    files: ['src/features/rooms/arrange/utils/playbackTelemetry.ts'],
    rules: {
      'no-console': 'off',
    },
  },
])
