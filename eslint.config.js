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
      '@typescript-eslint/consistent-type-definitions': ['warn', 'interface'],
      // Phase 2 moved this ban out of no-restricted-syntax: one rule id has one
      // severity, and that rule still carries the React.FC and ../../ bans,
      // which stay `warn` until Phase 3. Splitting the confirm ban into the two
      // rules below is what makes it expressible at `error` on its own.
      //
      // Native prompts block the main thread — the transport's clock lives
      // there — and cannot be themed. Use ui/ConfirmDialog or ui/Modal.
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: 'Use ui/ConfirmDialog — confirm() blocks the main thread and cannot be themed.' },
        { name: 'alert', message: 'Use an inline role="alert" notice — alert() blocks the main thread and cannot be themed.' },
        { name: 'prompt', message: 'Use ui/Modal with a form — prompt() blocks the main thread and cannot be themed.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'confirm', message: 'Use ui/ConfirmDialog — window.confirm blocks the main thread and cannot be themed.' },
        { object: 'window', property: 'alert', message: 'Use an inline role="alert" notice — window.alert blocks the main thread and cannot be themed.' },
        { object: 'window', property: 'prompt', message: 'Use ui/Modal with a form — window.prompt blocks the main thread and cannot be themed.' },
      ],
      'no-restricted-syntax': [
        'warn',
        {
          selector: "TSTypeReference[typeName.name='FC']",
          message: 'Use `export function X(props: XProps)` instead of React.FC (decision D1).',
        },
        {
          selector: "TSTypeReference[typeName.type='TSQualifiedName'][typeName.right.name='FC']",
          message: 'Use `export function X(props: XProps)` instead of React.FC (decision D1).',
        },
        // Decision D2, `../../` ban: the path-scoped layering blocks below
        // override only `no-restricted-imports` for their files, so a second
        // copy of that rule here would be shadowed the same way the original
        // one was.
        //
        // `no-restricted-syntax` reaches every file EXCEPT `src/data/**`. That
        // one block sets the rule itself, and `no-restricted-syntax` is not
        // additive — a block that sets it REPLACES this entry — so the data
        // block re-declares all five objects below verbatim, at 'error'. The
        // same is true of `no-restricted-globals` above. If you add an entry
        // here, add it there too; nothing checks that for you except
        // src/data/dataLayerPurity.test.ts.
        //
        // Two or more `../` levels are banned; a single `../` is left alone.
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
          ],
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
    files: ['src/components/**/*.{ts,tsx}'],
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
      // This REPLACES the global no-restricted-globals entry (:46-51), so its
      // three native-prompt bans are re-declared verbatim at the end.
      'no-restricted-globals': [
        'error',
        ...[
          'Math', 'Date', 'crypto', 'fetch', 'performance', 'process', 'globalThis',
          'localStorage', 'sessionStorage', 'window', 'document',
        ].map((name) => ({ name, message: 'src/data/ is pure: no impure globals.' })),
        { name: 'confirm', message: 'Use ui/ConfirmDialog — confirm() blocks the main thread and cannot be themed.' },
        { name: 'alert', message: 'Use an inline role="alert" notice — alert() blocks the main thread and cannot be themed.' },
        { name: 'prompt', message: 'Use ui/Modal with a form — prompt() blocks the main thread and cannot be themed.' },
      ],

      // This REPLACES the global no-restricted-syntax entry (:58-87), so its
      // React.FC and `../../` bans are re-declared verbatim first — at 'error'
      // here, where the global entry is 'warn'. Neither is reachable in
      // practice (no JSX in a table, and `@/` covers cross-folder), but leaving
      // them out would silently un-ban `../../` in the one folder where every
      // import is a type import.
      'no-restricted-syntax': [
        'error',
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
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
);
