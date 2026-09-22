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

// DEV-394: confines `tonal` to src/musicCore/tonalAdapter.ts, the one Tonal
// adapter file — see
// docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md
// (updated by DEV-394). `paths` (not `patterns`) is used because this bans
// one exact bare package specifier, not a glob over path shapes.
const TONAL_IMPORT_BAN = {
  name: 'tonal',
  message:
    "DEV-394: 'tonal' is confined to src/musicCore/tonalAdapter.ts — import from '@/musicCore' instead of 'tonal' directly.",
};

// `@tonaljs/*` scoped subpackages (`@tonaljs/core`, `@tonaljs/chord`, etc.) are
// real, separately-importable packages Tonal itself documents — the bare
// `tonal` ban above does not touch them, so this closes the same door for the
// scoped form. `patterns` (a glob group), not `paths` (an exact specifier),
// because this bans a whole namespace of subpaths rather than one bare
// specifier. Spread into the same `patterns` arrays TONAL_IMPORT_BAN's `paths`
// entry sits beside; only `src/musicCore/tonalAdapter.ts`'s block omits both.
const TONAL_SCOPED_PACKAGE_BAN = {
  group: ['@tonaljs/*'],
  message:
    "DEV-394: '@tonaljs/*' scoped subpackages are confined to the same one file as the bare 'tonal' import, src/musicCore/tonalAdapter.ts — import from '@/musicCore' instead.",
};

// DEV-399: the ENGINE — src/audio/engine.ts, src/audio/synth/**, and the two
// other DSP runtimes beside them — receives already-resolved playable events
// and takes no key, scale, chord, spelling or notation decision. It therefore
// imports no music-domain module. The controllers in src/audio/playback/ and
// the theory modules beside them (arpeggiator.ts, bassPatterns.ts,
// chordProgressions.ts, leadMelody.ts) are deliberately NOT in this block's
// file set: resolving a pitch is their job, and this ban would be wrong there.
//
// `@/utils/musicTheory` is split rather than banned whole, because that module
// holds timing helpers too (STEPS_PER_BAR, stepDurationSec) and an engine
// legitimately reads those. `allowImportNames` is an ALLOWLIST on purpose: a
// music-domain export added to musicTheory.ts later is banned here on the day
// it is written, with no edit to this file. The allowlist is narrower than
// "every timing export" — musicTheory.ts also exports timing values like
// `sixteenthNoteMs`, `MIN_BPM` and `MAX_BPM` that stay BANNED here, because the
// engine has never needed them; the four names below are exactly what
// `src/audio/engine.ts` and its neighbours actually read today, not a claim
// about the module's shape.
//
// `**/leadStepRecord` bans `noteOctave`, a hand-rolled note-name parser living
// beside the sequencer's step-record helpers — the same kind of thing as the
// banned `@/musicCore` `octaveOfNote`, just not routed through Music Core.
// Nothing in the engine's file set imports it today; it is named here so it
// stays that way rather than becoming a silent second door into note-name
// parsing.
//
// Every audio-side theory module below — `arpeggiator.ts`, `bassPatterns.ts`,
// `chordProgressions.ts`, `chordRhythms.ts`, `leadMelody.ts`, plus
// `leadStepRecord.ts` above — lives directly inside `src/audio/`, a sibling of
// `engine.ts`, `drumSynth.ts` and `masterRack.ts`, so every one of them is
// banned by a BARE pattern (`**/arpeggiator`, not `**/audio/arpeggiator`). A
// prefixed pattern only matches an import path that literally contains an
// `audio/` segment — true for the `@/`-aliased form (`@/audio/arpeggiator`)
// but never true for the relative form a sibling file actually writes
// (`./arpeggiator` from `engine.ts`, `../arpeggiator` from
// `src/audio/synth/**`) — neither contains `audio/` at all, because the
// traversal never leaves the `src/audio/` directory. A first pass at this
// list used the prefixed form for these five and shipped a real gap, caught
// only by testing the relative form on-disk rather than trusting the pattern;
// `**/leadStepRecord` was fixed the same way one round earlier and is the
// precedent this generalizes. `**/bassPatterns`, `**/chordProgressions` and
// `**/chordRhythms` also subsume the separate `**/data/*` entries those three
// names used to need below — a data-layer catalog and an audio-side resolver
// share a basename for each of the three, and one bare pattern now bans both
// copies, so the redundant `**/data/*` entries were removed rather than kept
// duplicated.
//
// Both import forms are covered for every entry in this list: the
// `@/`-aliased one a reader reaches for by habit and the `../`/`../../`/`./`
// relative one the engine files actually use today (`src/audio/engine.ts`
// imports `'../utils/musicTheory'`). A DEV-397 re-review found a real gate
// that had closed only the aliased form for one entry; this DEV-399 guard's
// own review found the same hole across six.
//
// `**/playback/**` (+ `**/playback`, for the folder-index form) closes the
// last route back to a note name: DEV-397's planners (`src/audio/playback/
// plan/**`) export shapes carrying note names — `ArmedChordPlan`'s
// `chordNotes`/`bassNotes`/`bassFullHold.noteName`, `chordPlayback.ts`'s
// `BarInvariantEvent`/`StepEvent` — and the controllers under
// `src/audio/playback/` that the message above tells an author to write live
// there too — so even a TYPE-ONLY import of a planner's output, or an import
// of a controller bridge, would put a note name straight back into a file
// this guard is supposed to keep domain-agnostic, with no runtime cycle for
// anything else to catch. `playback/` is a real path segment for both import
// forms an engine file would actually write (`@/audio/playback/...` aliased,
// `./playback/...` relative from `engine.ts`), so — unlike the six
// sibling-file entries above — the bare `**/playback/**` form needs no
// special-casing here; the separate bare `**/playback` entry is only for the
// folder-index import (`from '@/audio/playback'`/`'./playback'`) that
// `**/playback/**` alone does not reach, matching the `**/musicCore` +
// `**/musicCore/**` pair in the same group for the same reason.
const ENGINE_MUSIC_DOMAIN_BAN = [
  {
    group: [
      '**/musicCore',
      '**/musicCore/**',
      '**/utils/noteSpelling',
      '**/data/scales',
      '**/arpeggiator',
      '**/bassPatterns',
      '**/chordProgressions',
      '**/chordRhythms',
      '**/leadMelody',
      '**/leadStepRecord',
      '**/playback',
      '**/playback/**',
    ],
    message:
      'DEV-399: the engine receives resolved playable events — resolve pitch/scale/chord in a controller under src/audio/playback/ and pass a frequency in Hz.',
  },
  {
    group: ['**/utils/musicTheory'],
    allowImportNames: ['STEPS_PER_BAR', 'clampBpm', 'stepDurationSec', 'barDurationSec'],
    message:
      'DEV-399: the engine may read the TIMING half of musicTheory only — pitch, chord, scale and reharmonization helpers belong to the controllers (see noteFrequency at the playback boundary).',
  },
];

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

// The three Math.random selectors the `src/audio/**` block below already enforces —
// extracted to a const (DEV-392) so the two new note-regex-guard blocks (below) can
// spread it in too, rather than silently dropping this ban the moment a
// later-in-array block also sets `no-restricted-syntax` for the same two files
// (`src/audio/leadStepRecord.ts`, `src/audio/bassPatterns.ts`). See the
// `no-restricted-syntax` replace-not-merge note above GLOBAL_RESTRICTED_SYNTAX.
const AUDIO_RANDOM_BAN_SYNTAX = [
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
];

// DEV-392: guards against a new local note-name/octave regex being reintroduced
// into the five files this issue centralized onto Music Core's pitch API
// (src/musicCore/tonalAdapter.ts's octaveOfNote, pitchClassOfNote, noteMidi,
// midiToSharpName; src/musicCore/pitch.ts's transposePitchClassPreservingOctave).
// A blanket "no regex literal" ban is correct here, not just convenient: each of
// the five files was audited and confirmed (see the DEV-392 plan's survey) to
// contain no OTHER regex literal, so this cannot false-positive against
// legitimate unrelated use without the file changing shape first — at which
// point the failing lint is the prompt to reconsider whether this file still
// belongs in the list, not to silently loosen the rule.
const NOTE_REGEX_BAN = {
  selector: 'Literal[regex]',
  message:
    'DEV-392: note/pitch parsing is centralized in @/musicCore — this file must not reintroduce a local regex-based note parser. If this really is an unrelated regex, that is a sign this file has grown a second responsibility worth splitting out, not a reason to loosen this rule.',
};

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
      // Anti god-file guard, landed directly at `error` (not D5's warn-first
      // phasing) on request: `bun run eslint` enumerates every file over the
      // limit immediately, so an oversized file is a red gate no reviewer can
      // miss, not a `warn` line buried in a long report. The 750 ceiling is
      // SonarQube's S104 default and, like it, counts lines of code — blank
      // lines and comments are skipped, matching the function guard below.
      // Split the file, never raise the cap to clear a red gate.
      'max-lines': ['error', { max: 750, skipBlankLines: true, skipComments: true }],
      // Same guard at function scope. Blank lines and comments are skipped
      // because this repo's functions run long-but-linear (DSP, switch/case,
      // test setup) — a docblock-heavy function is not a god function, and
      // cyclomatic `complexity` is already clean at 20, so raw line count
      // would flag hundreds of linear functions while this cap catches the ones that
      // have actually grown out of control. Landed at `error` alongside
      // max-lines for the same reason: a long function is a red gate, not a
      // `warn` buried in a long report.
      'max-lines-per-function': ['error', { max: 100, skipBlankLines: true, skipComments: true }],
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
    // DEV-394 confines every `tonal` import to `src/musicCore/tonalAdapter.ts`,
    // so this ban now applies uniformly across `src/audio/**` with no
    // carve-out.
    files: ['src/audio/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            TONAL_SCOPED_PACKAGE_BAN,
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
    ignores: [
      'src/audio/rng.ts',
      'src/audio/rng.test.ts',
      // The mixdown renderer's test patches `Math.random` to a sentinel so it
      // can assert the render restores the default random source as an exact
      // value rather than a statistical claim — the same reason rng.test.ts is
      // exempted, and the same idiom that test uses.
      'src/audio/export/renderMixdown.test.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...GLOBAL_RESTRICTED_SYNTAX,
        ...AUDIO_RANDOM_BAN_SYNTAX,
      ],
    },
  },
  {
    // DEV-397: src/audio/playback/plan/ holds PURE PLANNERS. A planner takes an
    // immutable snapshot plus an explicit per-step context and returns resolved
    // playable events; it may not read the store, touch the engine or an
    // AudioContext, read a wall clock, arm a timer, or reach any other ambient
    // global. Every scheduled time is an argument, which is what lets the live
    // controllers and the offline renderer share one implementation and what
    // makes a planner testable with no DOM, no zustand and no AudioContext.
    //
    // Landed directly at 'error' per D5: the folder is new, so the rule starts
    // with nothing to phase in a 'warn' for.
    //
    // Both lists below REPLACE the broader src/audio/** entries rather than
    // merging with them (flat config semantics — see the src/data/ block's own
    // comments), so the audio-wide bans are spread back in. Leaving either
    // spread out would silently un-ban `tonal` and `Math.random` in exactly the
    // folder that must be the most deterministic code in the app.
    //
    // `Math` itself is NOT banned: planners legitimately use Math.max/floor.
    // Math.random is covered by AUDIO_RANDOM_BAN_SYNTAX below.
    files: ['src/audio/playback/plan/**/*.{ts,tsx}'],
    ignores: ['src/audio/playback/plan/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            TONAL_SCOPED_PACKAGE_BAN,
            { group: ['**/store/**'], message: 'audio/ must not import store/ (layering rule 1)' },
            { group: ['**/components/**'], message: 'audio/ must not import components/ (layering rule 1)' },
            TAPER_CONVERSION_BAN,
            {
              // The `@/`-aliased forms are the ones a planner would reach for
              // by habit; the `../` forms are the ones it would ACTUALLY reach
              // for, since `plan/` sits one level below `playback/` and every
              // other cross-file import in this folder (`../chordPlayback`,
              // `../padPlayback`) already uses that exact idiom. A single
              // `../playbackEngine` has only one `../` level, so the file-wide
              // `../../` ban (decision D2, GLOBAL_RESTRICTED_SYNTAX) does not
              // catch it — this group must ban it explicitly.
              group: [
                '**/audio/engine',
                '**/audio/engine/**',
                '**/engine',
                '**/playback/playbackEngine',
                '../playbackEngine',
              ],
              message: 'a planner returns events; the controller calls the engine (DEV-397).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['Date', 'performance', 'crypto', 'fetch', 'process', 'globalThis', 'window', 'document',
          'localStorage', 'sessionStorage', 'setTimeout', 'setInterval', 'requestAnimationFrame',
        ].map((name) => ({
          name,
          message: 'a planner is deterministic: no wall clock, no timers, no ambient globals (DEV-397).',
        })),
        ...GLOBAL_RESTRICTED_GLOBALS,
      ],
      'no-restricted-syntax': ['error', ...GLOBAL_RESTRICTED_SYNTAX, ...AUDIO_RANDOM_BAN_SYNTAX],
    },
  },
  {
    // DEV-428: the MIDI export runs where OfflineAudioContext does not exist.
    // renderMixdown.ts imports createRenderEngine, so only its TYPES may be
    // imported here; the engine and its DSP neighbours never. The base rule
    // is off because the TS-aware variant (needed for allowTypeImports) only
    // runs without it; the src/audio/** bans are restated because this block
    // REPLACES that one for these files (flat config, last match wins).
    files: ['src/audio/export/renderMidi.ts', 'src/audio/export/smfWriter.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            TONAL_SCOPED_PACKAGE_BAN,
            { group: ['**/store/**'], message: 'audio/ must not import store/ (layering rule 1)' },
            { group: ['**/components/**'], message: 'audio/ must not import components/ (layering rule 1)' },
            TAPER_CONVERSION_BAN,
            {
              group: ['../engine', '**/engine', '**/audio/engine', '**/beatAdapter', '**/drumSynth', '**/masterRack', '**/synth/**'],
              message: 'the MIDI export builds no audio: no engine import (DEV-428, R296).',
            },
            {
              group: ['./renderMixdown', '**/export/renderMixdown'],
              allowTypeImports: true,
              message: 'renderMixdown.ts pulls in the engine: import its types only (DEV-428).',
            },
          ],
        },
      ],
    },
  },
  {
    // DEV-399: the audio ENGINE is a domain-agnostic runtime. It takes a
    // resolved frequency in Hz, an opaque VoiceId and an owner; it parses no
    // note name and reads no scale, chord, spelling or reharmonization module.
    //
    // The file set is the runtime itself: the engine facade, the synth voice
    // runtime, and the two DSP units beside them. src/audio/clock.ts is
    // deliberately absent — it is a timing service whose whole job is bpm math
    // — and so is every controller under src/audio/playback/, whose job is to
    // do the resolving this block forbids here.
    //
    // Landed directly at 'error' per D5: Task 2 emptied the file set of every
    // music-domain import before this block existed, so there is nothing to
    // phase in a 'warn' for.
    //
    // The list below REPLACES the src/audio/** entry rather than merging with
    // it (flat config semantics — see the src/data/ block's own comments), so
    // the audio-wide bans are spread back in. Leaving them out would silently
    // un-ban `tonal`, the store and components in exactly the folder that must
    // be the most domain-free code in the app — and the store half of that is
    // also what keeps "the audio engine never writes persisted application
    // state" true.
    files: [
      'src/audio/engine.ts',
      'src/audio/synth/**/*.{ts,tsx}',
      'src/audio/drumSynth.ts',
      'src/audio/masterRack.ts',
    ],
    ignores: ['src/audio/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            TONAL_SCOPED_PACKAGE_BAN,
            { group: ['**/store/**'], message: 'audio/ must not import store/ (layering rule 1)' },
            { group: ['**/components/**'], message: 'audio/ must not import components/ (layering rule 1)' },
            TAPER_CONVERSION_BAN,
            ...ENGINE_MUSIC_DOMAIN_BAN,
          ],
        },
      ],
    },
  },
  {
    // Layering rule 2: store/ must not import components/.
    // DEV-394 confines every `tonal` import to `src/musicCore/tonalAdapter.ts`,
    // so this ban now applies uniformly across `src/store/**` with no
    // carve-out.
    files: ['src/store/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            TONAL_SCOPED_PACKAGE_BAN,
            { group: ['**/components/**'], message: 'store/ must not import components/ (layering rule 2)' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
  {
    // Incident reporting: src/incidents/ is a privacy boundary. It takes
    // already-sanitized structured input and must never reach into the store
    // (an arbitrary state snapshot is exactly what a report must not contain),
    // a component, or the live engine. Type-only imports from
    // `@/audio/runtime/*` are allowed; the type-only distinction is kept by
    // banning the engine module itself. Flat config REPLACES no-restricted-imports
    // per file, so the tonal and taper bans are restated here.
    files: ['src/incidents/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            TONAL_SCOPED_PACKAGE_BAN,
            { group: ['**/store/**', '@/store', '@/store/**'], message: 'incidents/ must not import store/: a report is built from sanitized arguments, never a state snapshot' },
            { group: ['**/components/**'], message: 'incidents/ must not import components/' },
            { group: ['**/audio/engine', '**/audio/engine.ts'], message: 'incidents/ must not import the audio engine' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
  {
    // Music Core (DEV-394): sits below store/audio/components, parallel to
    // src/utils/ and src/data/ in the dependency graph — see
    // docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md.
    // May import src/data/ (SCALES); must not import store/, components/,
    // src/audio/ or src/utils/ — the contract doc states Music Core "does not
    // read the store, the engine, or AudioContext" (line 128), so the engine
    // ban is a third entry alongside the two explicit layering mirrors. The
    // utils/ ban is a fourth: src/utils/ already imports `@/musicCore`
    // (musicTheory.ts, noteSpelling.ts), so the reverse direction would be a
    // real import cycle, not just a layering violation. `tonalAdapter.ts` is
    // the ONE file in the whole app permitted to import `tonal`/`@tonaljs/*`
    // — every other file here (chordQuality.ts, index.ts) is banned from it
    // too, so confinement is to one file, not "somewhere in musicCore".
    files: ['src/musicCore/**/*.{ts,tsx}'],
    ignores: ['src/musicCore/tonalAdapter.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            TONAL_SCOPED_PACKAGE_BAN,
            { group: ['**/store/**'], message: 'src/musicCore/ must not import store/ (mirrors layering rule 2)' },
            { group: ['**/components/**'], message: 'src/musicCore/ must not import components/ (mirrors layering rule 3)' },
            { group: ['**/audio/**'], message: 'src/musicCore/ must not import src/audio/ (Music Core must not read the engine)' },
            { group: ['**/utils/**'], message: 'src/musicCore/ must not import src/utils/ (src/utils/ already imports @/musicCore; the reverse would be a cycle)' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
  {
    // DEV-394: the Tonal adapter. The only production file permitted to
    // `import ... from 'tonal'` anywhere in the app. Still Music Core, so it
    // inherits the same store/components/audio/utils bans as the rest of the
    // folder — only the tonal ban itself is lifted here.
    files: ['src/musicCore/tonalAdapter.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/store/**'], message: 'src/musicCore/ must not import store/ (mirrors layering rule 2)' },
            { group: ['**/components/**'], message: 'src/musicCore/ must not import components/ (mirrors layering rule 3)' },
            { group: ['**/audio/**'], message: 'src/musicCore/ must not import src/audio/ (Music Core must not read the engine)' },
            { group: ['**/utils/**'], message: 'src/musicCore/ must not import src/utils/ (src/utils/ already imports @/musicCore; the reverse would be a cycle)' },
            TAPER_CONVERSION_BAN,
          ],
        },
      ],
    },
  },
  {
    // Layering rule 3: components are dumb views — no direct audio/engine.
    // Exceptions: the read-only analyser consumers (AudioVisualizer, the
    // transport VU meter in ui/VuMeter, and the mixer's per-layer meters in
    // ui/SourceMeter) and test files.
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
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            TONAL_SCOPED_PACKAGE_BAN,
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
    // replacement — it must keep layering rule 3's audio/engine ban and
    // DEV-395's tonal ban.
    files: ['src/components/ui/VolumeFader.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [TONAL_IMPORT_BAN],
          patterns: [
            TONAL_SCOPED_PACKAGE_BAN,
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
    // value at all, taper functions and tonal alike, by its own block below).
    // DEV-394 confines every `tonal` import to `src/musicCore/tonalAdapter.ts`,
    // which has its own dedicated block above — `src/musicCore/**` is
    // excluded here because flat config's `no-restricted-imports` REPLACES
    // rather than merges per matching file: this catch-all block is defined
    // AFTER the musicCore blocks, so without this `ignores` entry it would be
    // the last match for every `src/musicCore/**` file and silently wipe out
    // both musicCore's narrower bans and tonalAdapter.ts's tonal exemption.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/audio/**/*.{ts,tsx}',
      'src/store/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/data/**/*.{ts,tsx}',
      'src/musicCore/**/*.{ts,tsx}',
      'src/incidents/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': ['error', { paths: [TONAL_IMPORT_BAN], patterns: [TONAL_SCOPED_PACKAGE_BAN, TAPER_CONVERSION_BAN] }],
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
      // Data tables are content, not code — a 900-line registry is reviewed
      // as a diff, not as a function to split. Exempt from the line-count
      // gates so a deliberately large table is not flagged as a god file.
      'max-lines': 'off',
      'max-lines-per-function': 'off',

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
      'src/components/ui/VuMeter.tsx',
      // Reads audioEngine's DynamicsCompressorNode.reduction once a frame
      // through the shared meter scheduler. Routing that through the store
      // would be a store write per frame and a re-render of every subscriber —
      // the same reason the two above are exempt.
      'src/components/ui/GainReductionMeter.tsx',
      // The Sound mixer's per-layer meters. Reads one post-fader analyser per
      // mix bus on the shared meter scheduler, for the same reason as the
      // above: a store write per tick would re-render every mounted view.
      // The exemption stops at this file — SoundMixer renders it and imports
      // no engine of its own.
      'src/components/ui/SourceMeter.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // DEV-392 note-regex guard, audio half — see AUDIO_RANDOM_BAN_SYNTAX and
    // NOTE_REGEX_BAN above for why these two files need their own block rather
    // than folding into the src/audio/** Math.random block above: that block's
    // glob (`src/audio/**`) is far wider than "the two files this issue
    // centralized," and this repo's whole `src/audio/` tree legitimately uses
    // regex elsewhere (unaudited by this issue) — only these two are confirmed
    // regex-free apart from what Tasks 6 and 8 just deleted.
    files: ['src/audio/leadStepRecord.ts', 'src/audio/bassPatterns.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...GLOBAL_RESTRICTED_SYNTAX,
        ...AUDIO_RANDOM_BAN_SYNTAX,
        NOTE_REGEX_BAN,
      ],
    },
  },
  {
    // DEV-392 note-regex guard, non-audio half.
    files: [
      'src/components/loop/lead/melodyGrid.ts',
      'src/components/ui/Keyboard.tsx',
      'src/utils/musicTheory.ts',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...GLOBAL_RESTRICTED_SYNTAX, NOTE_REGEX_BAN],
    },
  },
);
