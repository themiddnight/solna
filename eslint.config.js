// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

// Phase 1 of the hygiene plan lands every jsx-a11y rule the preset actually
// enables as `warn`; Phase 2 (the primitives that fix the offending markup)
// flips them to `error`. Rules the preset ships `off` (e.g. the deprecated
// `label-has-for`, superseded by `label-has-associated-control`) stay `off`
// — a blanket `Object.keys().map()` would arm those too.
const jsxA11yAsWarnings = Object.fromEntries(
  Object.entries(jsxA11y.flatConfigs.recommended.rules)
    .filter(([, severity]) => {
      const level = Array.isArray(severity) ? severity[0] : severity;
      return level !== 'off' && level !== 0;
    })
    .map(([rule]) => [rule, 'warn']),
);

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ['**/*.{jsx,tsx}'],
    rules: jsxA11yAsWarnings,
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
        {
          selector: "CallExpression[callee.name=/^(confirm|alert|prompt)$/]",
          message: 'Native prompts block the audio thread and cannot be styled — use a dialog component.',
        },
        {
          selector: "CallExpression[callee.object.name='window'][callee.property.name=/^(confirm|alert|prompt)$/]",
          message: 'Native prompts block the audio thread and cannot be styled — use a dialog component.',
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
