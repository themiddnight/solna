# ADR-0005: Music Core owns music theory; Tonal confined to one file

## Status

Accepted — 2026-09-22. Recorded retroactively from CLAUDE.md (DEV-425). Originating work: DEV-394
(Tonal confinement, Music Core public API), DEV-395 (music-domain architecture contract and the
temporary file-named allowlist), DEV-392 (scale fallback moved into Music Core), DEV-399 (playable
events as the engine's sole input).

## Context

Pitch, interval and chord-quality operations used to be performed wherever they were needed, with
`tonal` imported directly by several files and note names parsed by hand-rolled regexes. That
spread made it impossible to say which function owned a musical fact, let an unregistered chord
quality fall back silently to `maj`, and let each file choose its own behaviour on an invalid note
name.

## Decision

### A fifth axis: Tonal.js is confined to one file

A fifth axis sits on top of the four layers ([ADR-0002](0002-four-layer-import-architecture.md)):
`tonal` may be imported only from `src/musicCore/tonalAdapter.ts` (DEV-394), enforced with the same
replace-not-merge `no-restricted-imports` pattern as the four layers (see `TAPER_CONVERSION_BAN`
and its carve-outs for the mechanism this reuses). Every other file that needs pitch, interval or
chord-quality operations imports Music Core's public API (`src/musicCore/index.ts`) instead —
including the six files that carried a temporary, file-named allowlist under DEV-395
(`src/utils/noteSpelling.ts`, `src/utils/musicTheory.ts`, `src/audio/arpeggiator.ts`,
`src/audio/bassPatterns.ts`, `src/audio/playback/padPlayback.ts`, `src/store/midiInput.ts`); none
of them import `tonal` directly any more, and each keeps its own pre-existing public exports
unchanged.

### One canonical chord-quality registry

`src/musicCore/chordQuality.ts` owns the one canonical chord-quality registry — app token, Tonal
alias, display suffix, picker label/group and reharmonization category — that
`ChordItem['quality']`'s TypeScript type, the chord picker's options,
`formatChordQuality`/`formatChordLabel` and chord-note resolution (`resolveChordNotes`) all derive
from. A quality absent from the registry is a compile error anywhere it is written as a literal,
and a runtime string that names no registered quality is a thrown error at `resolveChordNotes`,
never a silent `maj` chord. (How the reharmonization category is used:
[ADR-0008](0008-reharmonization-category-and-roman-numerals.md).)

### Music Core's own import direction

`src/musicCore/**` is itself ESLint-enforced to import nothing from `src/store/`,
`src/components/`, `src/audio/`, or `src/utils/` — the dependency runs audio → Music Core and
utils → Music Core, never the reverse (`src/utils/` already imports `@/musicCore`; see
[ADR-0004](0004-utils-placement-and-store-constant-inversion.md)).

### Intent, derived representation, playable event

A **musical intent** (a persisted, user-authored decision — a chord's root/quality, a key, a note's
pitch and timing) is not the same thing as a **derived representation** (a value a pure function
computes from musical intent, such as a resolved chord quality or a display-spelled label) or a
**playable event** (a fully resolved, timestamped instruction — pitch and timing already resolved,
voice ownership already assigned — that is the sole input the audio engine takes, DEV-399). The
full contract, including the compile-time, runtime-flow and data-ownership diagrams, lives in
`docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md` (updated by
DEV-394). The engine side of that boundary is [ADR-0018](0018-engine-frequency-boundary.md).

### Where the gate does and does not reach

`src/data/`'s own block already forbids every value import including `tonal`, so it carries no
separate carve-out. The gate covers non-test files under `src/` only — the config's final block
exempts `**/*.test.{ts,tsx}` from every import ban, which is how `scales.test.ts`,
`src/musicCore/tonalAdapter.test.ts` and `noteSpelling.test.ts` deliberately pin behavior against
tonal, and `scripts/` sits outside the gate's `src/**` scope entirely. The four analyser files are
the other hole: their block disables `no-restricted-imports` wholesale, so this axis is not
enforced there either (recorded once, in
[ADR-0002](0002-four-layer-import-architecture.md) and
[ADR-0028](0028-sample-based-metering.md)). `src/architecture/dependencyLayers.test.ts` proves the
Music Core layering and the tonal confinement.

### Music Core owns pitch parsing, octave extraction and scale-fallback resolution

Nothing outside `src/musicCore/` hand-rolls a note-name regex. `tonalAdapter.ts` wraps
`octaveOfNote` (a note's octave, `null` for none or for an unparseable name) alongside the DEV-394
primitives (`noteMidi`, `pitchClassOfNote`, `chromaOfNote`, `midiToSharpName`); `pitch.ts` composes
`transposePitchClassPreservingOctave` (shift a pitch class, keep the written octave — what a slash
bass needs on a key change) on top of them; `scale.ts` (moved from `src/utils/scaleLookup.ts`,
DEV-392) is the one place an unrecognised scale type resolves to Major.

Every one of these fails explicitly on invalid input — `null`/`NaN`, never a silent substitution —
because that is Music Core's contract for a core function; a consumer's own defensive default,
where one exists (real-time audio scheduling code that would rather keep an
unreachable-in-practice fallback than risk a throw mid-callback), stays visible in the consumer's
file, not folded into the core function.

`eslint.config.js`'s `NOTE_REGEX_BAN` bans any regex literal at all in the five files this
centralization touched (`leadStepRecord.ts`, `bassPatterns.ts`, `melodyGrid.ts`, `Keyboard.tsx`,
`musicTheory.ts`) — a blanket ban is correct there, not just convenient, because none of the five
has any other legitimate use for one.

## Consequences

- There is exactly one place to change how the app talks to Tonal, and exactly one registry to
  extend when a chord quality is added; everything downstream derives from it.
- An unregistered quality can no longer degrade into a silent `maj` chord — it fails at compile
  time or throws at `resolveChordNotes`.
- Test files may still import `tonal` to pin behaviour against it; `scripts/` is not gated.
- A core function never guesses; a caller that needs a fallback owns it visibly.
- The five `NOTE_REGEX_BAN` files cannot reintroduce a hand-rolled note parser, even by accident.

## Rules this implies

- **R044** — `tonal` is imported only from `src/musicCore/tonalAdapter.ts`.
- **R045** — Tonal confinement uses the replace-not-merge `no-restricted-imports` pattern
  (`TAPER_CONVERSION_BAN` mechanism).
- **R046** — Every other file needing pitch/interval/chord-quality ops imports
  `src/musicCore/index.ts`.
- **R047** — The six ex-DEV-395 files (`utils/noteSpelling.ts`, `utils/musicTheory.ts`,
  `audio/arpeggiator.ts`, `audio/bassPatterns.ts`, `audio/playback/padPlayback.ts`,
  `store/midiInput.ts`) import no `tonal` and keep their public exports.
- **R048** — `src/musicCore/chordQuality.ts` owns the one chord-quality registry (token, Tonal
  alias, display suffix, picker label/group, reharmonization category); `ChordItem['quality']`,
  picker options, `formatChordQuality`/`formatChordLabel`, `resolveChordNotes` derive from it.
- **R049** — An unregistered quality literal is a compile error; an unregistered runtime string
  throws at `resolveChordNotes`, never a silent `maj`.
- **R050** — `src/musicCore/**` imports nothing from `store/`, `components/`, `audio/`, `utils/`;
  dependency runs audio→Music Core and utils→Music Core only.
- **R051** — Musical intent (persisted user decision) ≠ derived representation (pure function of
  intent) ≠ playable event (resolved, timestamped, owner assigned; the engine's sole input,
  DEV-399). Contract:
  `docs/superpowers/plans/2026-09-16-dev-395-music-domain-architecture-contract.md`.
- **R052** — `src/data/`'s block already forbids every value import incl. `tonal`; no separate
  carve-out.
- **R053** — Import bans cover non-test `src/**` only: the final config block exempts
  `**/*.test.{ts,tsx}` from every import ban; `scripts/` is outside.
- **R082** — Music Core owns pitch parsing, octave extraction and scale fallback; nothing outside
  `src/musicCore/` hand-rolls a note-name regex.
- **R083** — Primitives: `octaveOfNote`, `noteMidi`, `pitchClassOfNote`, `chromaOfNote`,
  `midiToSharpName` (`tonalAdapter.ts`); `transposePitchClassPreservingOctave` (`pitch.ts`);
  `scale.ts` is the one place an unknown scale type resolves to Major.
- **R084** — Core functions fail explicitly (`null`/`NaN`), never substitute; a consumer's
  defensive default stays in the consumer's file.
- **R085** — `NOTE_REGEX_BAN` bans any regex literal in `leadStepRecord.ts`, `bassPatterns.ts`,
  `melodyGrid.ts`, `Keyboard.tsx`, `musicTheory.ts`.

## Sources

CLAUDE.md at `02cf1a9b` (pre-restructure): lines 129-161, 279-293. Lines 159-161 (the analyser
hole) duplicated lines 123-125 and are kept once, in ADR-0002 (spec §5 C4).
