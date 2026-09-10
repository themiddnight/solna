import type { MasterEffects } from '../types';
import type { MeterId } from '../utils/meter';
import { DEFAULT_METER_ID } from '../utils/meter';
import { INITIAL_EFFECTS } from './initialState';
import { LOOP_FLAT_KEYS, loopStatePatch, resolveActiveLoop, withFreshTempNames } from './loop';
import { createDefaultLoop } from './loopSlice';
import { DEFAULT_BPM } from './transportSlice';
import { DEFAULT_FADER_DB } from './levelUnits';
import type { AppStore, Loop, LoopStatePatch } from './types';

/**
 * The `.solna` / IndexedDB format version. Deliberately separate from the
 * persist `version` in store.ts: that one bumps for private localStorage
 * reshapes, this one only when the content contract changes. The persist
 * migration chain must never be used to read a project body.
 *
 * DEV-388 deleted the per-version upgrade chain this constant used to head,
 * and then a follow-up to that same task deleted the version-gated RESET that
 * first replaced it too — solna has no real users yet, and a fader value is
 * just a number: a number in range cannot be told apart by whether it was
 * written as linear gain or as dB, so nothing here tries any more. This
 * constant is now a MARKER, not a transform trigger: it is stamped on every
 * write (still the murva-facing interop marker, and still what
 * `parseProjectFile` refuses a NEWER body against), but no read path branches
 * on its value any more. A body at any other version is simply validated —
 * `sanitizeContent` (projectFile.ts) / `sanitizeLoops` (sanitize.ts) reject anything out of
 * range, wrong-typed, missing or not a member of an allowed set and
 * substitute the default, the same way regardless of which version wrote the
 * body. Three cases DEV-388 found that could not be caught this way were
 * re-homed as validation rules instead of a migration step: an unrecognised
 * `sequencerTracks[].instrument` is now rejected by `isSequencerTrack`
 * (sanitize.ts), a missing `padMuted` takes the plain default, and a
 * pre-tick-resolution `leadMelodySteps` is a valid shape and passes through
 * unchanged. Bump this constant only when the CONTENT CONTRACT itself changes
 * again, not for every field that gets added, renamed or reshaped —
 * sanitizeContent already defaults those.
 */

/**
 * dB LEVEL CONTRACT — the rule a reader must follow for every key this format
 * calls a fader.
 *
 * Every key the `keys` line below names is stored in DECIBELS at
 * PROJECT_FORMAT_VERSION, and read directly as such by this build. There is
 * NO version-based reset or conversion any more (a follow-up to DEV-388
 * removed it): a fader value is a plain number, and a number that is finite
 * and inside the fader's range is legal dB regardless of which version wrote
 * it — a linear 0.7 from an old build and a dB -3 both simply pass
 * `asFaderDb`'s range check. There are no real users solna needs to
 * protect from a value they set under the old linear unit reading oddly under
 * the new one; a developer who notices a stale-looking level adjusts it
 * themselves, the same way they would any other value in range. What DOES
 * still get rejected is a value OUTSIDE the contract below — non-finite,
 * negative infinity, or past -60/+12 — regardless of source; that is
 * ordinary validation, not a unit judgement.
 *
 * The contract, at PROJECT_FORMAT_VERSION:
 *   keys     the flat faders PROJECT_DB_LEVEL_KEYS lists below — masterVolume
 *            (content root), synthVolume, chordVolume, bassVolume, padVolume,
 *            fxVolume, masterSequencerVolume (per-loop) — PLUS sequencerTracks[].volume
 *            (per-track, per-loop), which is a nested row key rather than a flat
 *            one and so is covered here but not listed there.
 *   unit     decibels, relative (a fader), NOT dBFS.
 *   unity    0 dB is unity gain — the signal passes at the level it arrived.
 *            Linear gain is 10 ** (db / 20); see src/utils/gainUnits.ts.
 *   range    -60 .. +12 dB inclusive. -60 is the fader bottom, +12 the top.
 *            The fader's TAPER puts unity at 0.75 of physical travel
 *            (`DEFAULT_UNITY_POS`), not the midpoint — that shapes the widget,
 *            not the stored value, which stays plain decibels either way.
 *   silence  a FINITE -60, never -Infinity: JSON.stringify(-Infinity) is null,
 *            and a body crosses JSON.stringify on the way to disk. -60 dB is
 *            0.001 linear, inaudible, and coincides with the fader bottom, so
 *            the silence value and the bottom of the range are one place.
 *            -Infinity is legal only in transient meter readings, which are
 *            never serialised. murva uses -Infinity for the same concept —
 *            that divergence is DELIBERATE (contract divergence 2) and must
 *            never be "aligned"; pin it, don't close it.
 *
 * What this contract does NOT cover, and never will: the internal voicing
 * constants nested inside `synthParams` / `chordSynthParams` / `bassSynthParams`
 * / `padSynthParams` (`SynthParams.subOscVolume`, `noiseVolume`), each
 * `DrumKit` voice's `gain`, a vibe's authored `pad.volume` and `DEFAULT_PADS`'
 * pad `volume` are all still LINEAR gain and are never converted — they are
 * mix-time trims baked into presets and factory content, not a fader a user
 * moves, and widening this paragraph to "every level key" would be exactly the
 * failure mode this contract exists to prevent: a reader that assumed the
 * whole body were dB would read a linear `subOscVolume` of 1.0 as +1 dB —
 * plausible, silent and wrong.
 *
 * murva reads the same numbers from `src/shared/audio/gainUnits.ts`; the copies
 * are held together by src/utils/gainContract.test.ts, which pins them as
 * literals. This section is itself pinned, by the dB-level-contract tests in
 * projectFormat.test.ts, so it cannot rot away from the exports below.
 */
export const PROJECT_FORMAT_VERSION = 10;

/**
 * The dB level contract's keys AT THE CONTENT ROOT AND ON A LOOP — the flat
 * fader keys, and the list `sanitizePersistedState` (store.ts) iterates so the
 * persist path validates every one of them. It is code, not documentation
 * shaped like code: it used to be read by nothing, and the one key that was
 * quietly missing from the sanitizer's hand-written repeat of it (`padVolume`)
 * went unvalidated straight into `faderDbToGain`, which fails SAFE TO SILENCE —
 * a corrupt stored value muted the pad bus instead of defaulting to the trim
 * every other bus got. Adding an eighth fader is now an edit to this list.
 *
 * `masterVolume` is the content root's own fader and the other six are the
 * source buses; per-loop, all six live on the loop. The contract also covers
 * `sequencerTracks[].volume`, which is deliberately NOT in this array: it is a
 * per-row key nested inside each loop, validated by `sanitizeFlatSequencerTracks`
 * and `sanitizeLoops`, and putting a piece of prose like `'sequencerTracks[].volume'`
 * in a list of real key names is what made this constant unusable as code before.
 *
 * A literal list, not derived from a per-key version map — DEV-388 deleted the
 * migration chain that map served, and there is no version-based rule left for a
 * per-key version to distinguish; validation (asFaderDb / sanitize.ts) treats every
 * one of these keys the same way regardless of which formatVersion wrote them.
 * Everything else that looks like a level — drum-kit `gain`, `clickLevel`,
 * `reverbSend`, preset `subOscVolume`, vibe pad `volume` — is internal voicing, not
 * a fader, and stays linear (see the dB LEVEL CONTRACT block above).
 */
export const PROJECT_DB_LEVEL_KEYS: readonly string[] = [
  'masterVolume',
  'synthVolume',
  'chordVolume',
  'bassVolume',
  'padVolume',
  'fxVolume',
  'masterSequencerVolume',
];

export interface ProjectEnvelope {
  formatVersion: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/** What a list row renders — the envelope and nothing else. */
export type ProjectMeta = ProjectEnvelope;

export interface ProjectContent {
  bpm: number;
  meterId: MeterId;
  masterVolume: number;
  effects: MasterEffects;
  loops: ProjectLoop[];
}

export interface ProjectBody extends ProjectEnvelope {
  content: ProjectContent;
}

/** The content set, in file order. The fingerprint serialises in this order. */
export const PROJECT_CONTENT_KEYS = ['bpm', 'meterId', 'masterVolume', 'effects', 'loops'] as const;

/**
 * Every field of a Loop that is project content, in fingerprint order.
 * Derived from LOOP_FLAT_KEYS so a new LoopStatePatch field is picked up
 * automatically — and pinned by a test so adding one is a conscious decision
 * about whether it belongs in a project. This is not every field of `Loop`:
 * `tempName` is loop-slot identity rather than content, so it is opted out
 * one layer up, in `LoopStatePatch`'s own `Omit` (types.ts), and never
 * reaches LOOP_FLAT_KEYS or this list to begin with — see `ProjectLoop`'s
 * docblock below for why it is excluded, not what excludes it.
 */
export const PROJECT_LOOP_KEYS = ['id', 'name', 'repeatCount', ...LOOP_FLAT_KEYS] as const;

/**
 * A Loop as it appears in project content: every PROJECT_LOOP_KEYS field,
 * `tempName` excluded. `tempName` is loop-slot identity, not project content
 * (see its docblock on `Loop` in types.ts) — the same category as
 * `selectedVibeId` being excluded from PROJECT_CONTENT_KEYS.
 */
export type ProjectLoop = Omit<Loop, 'tempName'>;

export type ProjectContentSource = Pick<AppStore, 'bpm' | 'meterId' | 'masterVolume' | 'effects' | 'loops'>;

/**
 * Exactly PROJECT_LOOP_KEYS off a live Loop — never a spread — so `tempName`
 * (loop-slot identity, deliberately not in PROJECT_LOOP_KEYS) can never ride
 * into a saved or exported project body. Before this picked, buildProjectContent
 * wrote `state.loops` verbatim and `tempName` shipped in every `.solna` file
 * despite being excluded from the pinned key lists — this is the fix.
 *
 * Exported because it is not only buildProjectContent's helper: sanitizeContent
 * (projectFile.ts) is the OTHER producer of a `ProjectContent`, and it starts
 * from `sanitizeLoops`'s full `Loop[]` (tempName included, since that is also
 * what persist hydration reads) — the same strip belongs there too, or a
 * rename/import round-trip re-widens a clean stored body back into carrying
 * `tempName`.
 */
export function pickLoopContent(loop: Loop): ProjectLoop {
  const picked = {} as Record<string, unknown>;
  for (const key of PROJECT_LOOP_KEYS) picked[key] = (loop as unknown as Record<string, unknown>)[key];
  return picked as ProjectLoop;
}

/**
 * Picks the content set off the live store. Explicit property list, never a
 * spread: the excluded view/session/library keys must not leak into a file.
 */
export function buildProjectContent(state: ProjectContentSource): ProjectContent {
  return {
    bpm: state.bpm,
    meterId: state.meterId,
    masterVolume: state.masterVolume,
    effects: state.effects,
    loops: state.loops.map(pickLoopContent),
  };
}

// loops overridden to Loop[]: applyProjectContent stamps a fresh tempName
// onto every content loop before this patch is written (withFreshTempNames),
// so what actually reaches the store is a full Loop, never the tempName-less
// ProjectContent shape a project body carries on disk.
export type ProjectOpenPatch = Omit<ProjectContent, 'loops'> &
  LoopStatePatch & { loops: Loop[]; activeLoopId: string; selectedVibeId: null };

/**
 * The single store patch that installs a project. Encodes the reset rules:
 * `selectedVibeId` -> null (a project has no vibe until a chip is pressed),
 * `activeLoopId` -> loops[0] through the same resolution persist `merge`
 * uses, and the flat per-loop keys written through loopStatePatch in the SAME
 * patch — writing `loops` without them would leave the previous project's
 * sound on screen and in the engine. `focusTrack` and `metronomeActive`
 * are deliberately absent: they are user preferences, not project state.
 */
export function applyProjectContent(content: ProjectContent): ProjectOpenPatch {
  // content.loops carries no tempName (see ProjectLoop above) — every install
  // synthesizes fresh loop-slot labels, the same reset applyProjectContent
  // already does to selectedVibeId and for the same reason.
  const loops = withFreshTempNames(content.loops);
  const active = resolveActiveLoop(loops, null);
  return {
    ...content,
    loops,
    ...loopStatePatch(active),
    activeLoopId: active.id,
    selectedVibeId: null,
  };
}

/** The content of a brand-new project: store defaults plus one default loop. */
export function factoryProjectContent(): ProjectContent {
  return {
    bpm: DEFAULT_BPM,
    meterId: DEFAULT_METER_ID,
    masterVolume: DEFAULT_FADER_DB,
    effects: { ...INITIAL_EFFECTS },
    // Routed through pickLoopContent so the returned loop actually matches
    // ProjectLoop (no tempName): the factory's declared contract, and what
    // applyProjectContent expects to receive before withFreshTempNames stamps
    // a fresh label. Returning createDefaultLoop() directly carried a tempName
    // the type said could not be there — silently legal only because it was
    // overwritten on install.
    loops: [pickLoopContent(createDefaultLoop())],
  };
}

/** Same style as newLoopId / presetsSlice ids: unique per device, no crypto needed. */
export function newProjectId(): string {
  return `project-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

export function makeEnvelope(name: string, now: number): ProjectEnvelope {
  return { formatVersion: PROJECT_FORMAT_VERSION, id: newProjectId(), name, createdAt: now, updatedAt: now };
}
