// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Phase 2 flipped every jsx-a11y rule the preset actually enables to `error`:
// the primitives that fix the offending markup have landed and the count is
// zero. Rules the preset ships `off` (e.g. the deprecated `label-has-for`,
// superseded by `label-has-associated-control`) stay `off` — a blanket
// `Object.keys().map()` would arm those too.
const jsxA11yAsErrors = Object.fromEntries(
  Object.entries(jsxA11y.flatConfigs.recommended.rules)
    .filter(([, severity]) => {
      const level = Array.isArray(severity) ? severity[0] : severity;
      return level !== 'off' && level !== 0;
    })
    .map(([rule]) => [rule, 'error']),
);

// DEV-386 task 2 review, fix round 1: only VolumeFader.tsx may convert
// between a slider position and dB — that is what makes "unity at 0.75 of
// travel" a property of the code rather than a claim repeated at ~20 call
// sites. `no-restricted-imports` REPLACES the whole rule per matching file,
// it does not merge across config objects, so this single pattern is spread
// into every block below that already owns a `no-restricted-imports` entry
// (the three layering blocks) instead of living in one new block that would
// silently wipe those blocks' own bans for the folders they both match. A
// bare `**/gainUnits` group (no leading path) is what catches every import
// form actually in use — `@/utils/gainUnits`, `../utils/gainUnits` and the
// same-directory `./gainUnits` alike — verified empirically, not assumed.
const TAPER_CONVERSION_BAN = {
  group: ['**/gainUnits'],
  importNames: ['dbToSliderPos', 'sliderPosTodB'],
  message:
    'Only src/components/ui/VolumeFader.tsx converts a slider position <-> dB (DEV-386); import a dB value/handler instead.',
};

// The two bans that must reach EVERY file: React.FC (decision D1) and the
// `../../` deep-relative-import ban (decision D2). `no-restricted-syntax` is
// not additive — a config block that sets it REPLACES this entry for the files
// it matches — so every path-scoped block below that owns a
// `no-restricted-syntax` entry (`src/data/**`, `src/audio/**`) spreads this
// array in first. Both blocks used to re-declare it verbatim instead, and the
// `src/audio/**` block that DEV-387 added did not, which silently un-banned
// both decisions for the whole folder with `bun run eslint` staying green.
// Spreading one const is what makes that impossible to forget. The same
// replace-not-merge trap applies to `no-restricted-globals`, whose global entry
// the `src/data/**` block still re-declares by hand.
//
// Two or more `../` levels are banned; a single `../` is left alone.
// The native-prompt bans, same replace-not-merge story as
// GLOBAL_RESTRICTED_SYNTAX above: `no-restricted-globals` is set outright by
// the `src/data/**` block, so that block spreads this array in rather than
// re-declaring it. Native prompts block the main thread — the transport's
// clock lives there — and cannot be themed. Use ui/ConfirmDialog or ui/Modal.
// (`no-restricted-properties` bans the `window.`-qualified spellings; nothing
// overrides that rule per-folder, so it needs no const.)
const GLOBAL_RESTRICTED_GLOBALS = [
  { name: 'confirm', message: 'Use ui/ConfirmDialog — confirm() blocks the main thread and cannot be themed.' },
  { name: 'alert', message: 'Use an inline role="alert" notice — alert() blocks the main thread and cannot be themed.' },
  { name: 'prompt', message: 'Use ui/Modal with a form — prompt() blocks the main thread and cannot be themed.' },
];

const GLOBAL_RESTRICTED_SYNTAX = [
  {
    selector: "TSTypeReference[typeName.name='FC']",
    message: 'Use `export function X(props: XProps)` instead of React.FC (decision D1).',
  },
  {
    selector: "TSTypeReference[typeName.type='TSQualifiedName'][typeName.right.name='FC']",
    message: 'Use `export function X(props: XProps)` instead of React.FC (decision D1).',
  },
  {
    selector: "ImportDeclaration[source.value=/^\\.\\.\\/\\.\\.\\//]",
    message: 'Cross-folder imports use the `@/` alias (decision D2); relative paths only within one folder.',
  },
  {
    selector: "ExportNamedDeclaration[source.value=/^\\.\\.\\/\\.\\.\\//]",
    message: 'Cross-folder imports use the `@/` alias (decision D2); relative paths only within one folder.',
  },
  {
    selector: "ExportAllDeclaration[source.value=/^\\.\\.\\/\\.\\.\\//]",
    message: 'Cross-folder imports use the `@/` alias (decision D2); relative paths only within one folder.',
  },
];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ['**/*.{jsx,tsx}'],
    rules: jsxA11yAsErrors,
  },
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      complexity: ['warn', 20],
      // A hook called conditionally is a bug, not a style choice — error from day one.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Decision D1: `interface XProps`, never `type XProps = {...}`.
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      // Phase 2 moved this ban out of no-restricted-syntax: one rule id has one
      // severity, and that rule still carries the React.FC and ../../ bans,
      // which were `warn` at the time. Splitting the confirm ban into the two
      // rules below is what made it expressible at `error` on its own; the
      // split stands because the three bans still have separate lives.
      //
      'no-restricted-globals': [
        'error',
        ...GLOBAL_RESTRICTED_GLOBALS,
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'confirm', message: 'Use ui/ConfirmDialog — window.confirm blocks the main thread and cannot be themed.' },
        { object: 'window', property: 'alert', message: 'Use an inline role="alert" notice — window.alert blocks the main thread and cannot be themed.' },
        { object: 'window', property: 'prompt', message: 'Use ui/Modal with a form — window.prompt blocks the main thread and cannot be themed.' },
      ],
      // Per decision D5 both bans landed as `warn` and flipped to `error` in
      // the change that emptied them: there are zero React.FC components and
      // zero `../../` specifiers left, so a new one is a mistake, not a
      // leftover. The entries live in GLOBAL_RESTRICTED_SYNTAX because every
      // path-scoped block that sets this rule REPLACES them — see that const.
      'no-restricted-syntax': [
        'error',
        ...GLOBAL_RESTRICTED_SYNTAX,
      ],
    },
  },
  {
    // Layering rule 1: audio/ never imports store/ or components/.
    files: ['src/audio/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/store/**'], message: 'audio/ must not import store/ (layering rule 1)' },
            { group: ['**/components/**'], message: 'audio/ must not import components/ (layering rule 1)' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
  {
    // DEV-387 final review, must-fix 2: `src/audio/rng.ts`'s docblock claims to
    // be the one seam every `Math.random()` call in `src/audio/` that affects
    // rendered audio goes through — a claim nothing enforced. Ruling 10 spent a
    // whole extra task (8b) seeding that RNG specifically so a regenerated
    // catalogue is byte-identical and does not silently rewrite `measuredDbfs`/
    // `trimDb` for every noise voice; an un-routed `Math.random()` reappearing
    // in `src/audio/` would defeat that with `bun test` and `check:levels`
    // (hash-based) both staying green. Landed directly at `error` per D5: the
    // rule starts clean (zero call sites today), so there is nothing to phase
    // in a `warn` for. `Math` itself is not banned here — DSP code legitimately
    // uses `Math.floor`/`Math.PI`/etc. — only the one nondeterministic member.
    //
    // Second round (whole-branch re-review): a plain `CallExpression` selector
    // only caught the literal `Math.random()` call shape — `const { random } =
    // Math; random()`, `const r = Math.random; r()` and `Math['random']()` all
    // passed. Three selectors now cover the forms a person would actually
    // reach for: `Math.random` referenced in ANY position (not just as a call
    // callee, so an alias assignment is caught at the assignment, before it is
    // ever invoked), `Math['random']` (computed access), and `const { random }
    // = Math` (destructuring). None of the three mention `min`/`max`/`pow`/etc,
    // so every other `Math` member stays unrestricted. This is still not
    // exhaustive — see rng.ts's docblock for what remains uncoverable.
    files: ['src/audio/**/*.{ts,tsx}'],
    ignores: ['src/audio/rng.ts', 'src/audio/rng.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...GLOBAL_RESTRICTED_SYNTAX,
        {
          selector: "MemberExpression[object.name='Math'][computed=false][property.name='random']",
          message: 'src/audio/ routes randomness through src/audio/rng.ts (setRandomSource) so calibration renders stay reproducible — call the seam, not Math.random directly (also bans an alias assignment like `const r = Math.random`).',
        },
        {
          selector: "MemberExpression[object.name='Math'][computed=true][property.value='random']",
          message: "src/audio/ routes randomness through src/audio/rng.ts (setRandomSource) — Math['random'] is the same ban as Math.random, just spelled to dodge it.",
        },
        {
          selector: "VariableDeclarator[init.name='Math'] ObjectPattern > Property[key.name='random']",
          message: 'src/audio/ routes randomness through src/audio/rng.ts (setRandomSource) — destructuring `random` out of `Math` is the same ban as Math.random.',
        },
      ],
    },
  },
  {
    // Layering rule 2: store/ must not import components/.
    files: ['src/store/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/components/**'], message: 'store/ must not import components/ (layering rule 2)' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
  {
    // Layering rule 3: components are dumb views — no direct audio/engine.
    // Exceptions: the read-only analyser consumers (AudioVisualizer, the
    // transport VU meter in ui/VuMeter, AmbientBackdrop) and test files.
    // Routing their per-frame reads through the store would mean a store
    // write every animation frame and a re-render of every subscriber.
    //
    // VolumeFader.tsx is ALSO excluded here — not for the audio/engine
    // reason, but because it is the one file the taper ban below must not
    // reach. It gets its own block right after this one, re-declaring only
    // the audio/engine ban, so excluding it here does not quietly drop that
    // protection for it too.
    files: ['src/components/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/VolumeFader.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/audio/engine'], message: 'components must not import audio/engine (layering rule 3)' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
  {
    // VolumeFader.tsx: the one exception to the taper ban above, and the
    // reason it needs its own block rather than an `ignores` entry with no
    // replacement — it must keep layering rule 3's audio/engine ban.
    files: ['src/components/ui/VolumeFader.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/audio/engine'], message: 'components must not import audio/engine (layering rule 3)' },
          ],
        },
      ],
    },
  },
  {
    // Everything else that can import `gainUnits` but is not already covered
    // by one of the layering blocks above (which each carry their own copy
    // of TAPER_CONVERSION_BAN) or by src/data/ (banned from importing any
    // value at all, taper functions included, by its own block below).
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/audio/**/*.{ts,tsx}',
      'src/store/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/data/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [TAPER_CONVERSION_BAN] }],
    },
  },
  {
    // Layering rule 0: src/data/ holds literals and nothing else.
    //
    // Every file here is an INDEPENDENT LEAF — it imports nothing at runtime,
    // not even a sibling in this folder, so the folder has no evaluation graph
    // and no temporal-dead-zone failure mode. That is what lets a reviewer read
    // a 900-line table diff as content: nothing outside the open file can
    // influence what it evaluates to.
    //
    // Test files are excluded: a test necessarily imports bun:test at runtime,
    // and the rule is about the tables, not about what asserts on them.
    files: ['src/data/**/*.{ts,tsx}'],
    ignores: ['src/data/**/*.test.{ts,tsx}'],
    rules: {
      // The import ban. The base rule MUST be off for the TS-aware one to run —
      // measured: without this line the variant below never fires at all.
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**'],
              message: 'src/data/ holds literals: `import type` only.',
              allowTypeImports: true,
            },
          ],
        },
      ],

      // The impure-global ban. `no-restricted-globals` is scope-aware: it fires
      // on a GLOBAL reference and stays silent on a local binding that shadows
      // the name, so a table field or helper parameter called `performance` is
      // untouched. An `Identifier[name='Math']` syntax selector would flag both.
      // The list is a floor, not a ceiling — add to it rather than arguing
      // about whether a given global counts.
      //
      // This REPLACES the global no-restricted-globals entry, so
      // GLOBAL_RESTRICTED_GLOBALS is spread back in at the end.
      'no-restricted-globals': [
        'error',
        ...[
          'Math', 'Date', 'crypto', 'fetch', 'performance', 'process', 'globalThis',
          'localStorage', 'sessionStorage', 'window', 'document',
        ].map((name) => ({ name, message: 'src/data/ is pure: no impure globals.' })),
        ...GLOBAL_RESTRICTED_GLOBALS,
      ],

      // This REPLACES the global no-restricted-syntax entry above, so
      // GLOBAL_RESTRICTED_SYNTAX is spread back in first. That spread is
      // load-bearing: leaving it out would silently un-ban `../../` in the one
      // folder where every import is a type import.
      'no-restricted-syntax': [
        'error',
        ...GLOBAL_RESTRICTED_SYNTAX,
        {
          selector: 'NewExpression',
          message: 'src/data/ holds literals: write the literal, not a constructed object.',
        },
        {
          selector: 'FunctionDeclaration',
          message: 'src/data/ holds literals: only top-level `const` arrow helpers.',
        },
        {
          selector: 'FunctionExpression',
          message: 'src/data/ holds literals: only top-level `const` arrow helpers.',
        },
        { selector: 'ClassDeclaration', message: 'src/data/ holds literals, not classes.' },
        { selector: 'ClassExpression', message: 'src/data/ holds literals, not classes.' },
        // Two selectors, not one: `export let n = 0` is a child of
        // ExportNamedDeclaration, not of Program. Escalating `prefer-const`
        // does NOT substitute — it only fires on a binding that is never
        // reassigned, so `let n = 0; n++` is the one case it deliberately
        // allows, and that is the exact case this ban exists to catch.
        {
          selector: 'Program > VariableDeclaration[kind=/^(let|var)$/]',
          message: 'src/data/ is stateless: module-scope bindings must be `const`.',
        },
        {
          selector: 'ExportNamedDeclaration > VariableDeclaration[kind=/^(let|var)$/]',
          message: 'src/data/ is stateless: module-scope bindings must be `const`.',
        },
      ],
    },
  },
  {
    files: [
      'src/components/AudioVisualizer.tsx',
      'src/components/ui/AmbientBackdrop.tsx',
      'src/components/ui/VuMeter.tsx',
      // Reads audioEngine's DynamicsCompressorNode.reduction once a frame
      // through the shared meter scheduler. Routing that through the store
      // would be a store write per frame and a re-render of every subscriber —
      // the same reason the three above are exempt.
      'src/components/ui/GainReductionMeter.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
);
