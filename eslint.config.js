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
        // one was. `no-restricted-syntax` is untouched by those blocks, so
        // this entry reaches every file, including src/audio, src/store and
        // src/components. Two or more `../` levels are banned; a single
        // `../` (same-folder-ish) is left alone.
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
