import type { Namespace } from 'socket.io';
import type {
  CompanionConfig,
  CompanionNoteEventPayload,
  NoteEvent,
  CompanionRole,
  CompanionRenderContext,
} from '@jam-band/shared';
import {
  generateChordSegment,
  generateBassBar,
  generateBeatBar,
  computeBarFill,
  resolvePocketSeconds,
  generateBlockChordNotes,
  resolveDrumParts,
  PERFORM_EVENTS,
  DEFAULT_CHORD_COMPANION_SETTINGS,
  barsToQuarterBeats,
  beatInBar,
  quarterNoteMs,
  quarterNotesPerBar,
  normalizeToMajorMinor,
  ChordProgressionEngine,
  assertNever,
} from '@jam-band/shared';
import type { PerformRoomState } from '../domain/models/PerformRoomState';
import type { CompanionRuntimeSnapshot } from './CompanionRuntimeRegistry';

type ScheduledCompanionNote = NoteEvent & { beat: number };
type CompanionSchedulerClock = {
  bpm?: number;
  roomScale?: { rootNote: string; scale: string };
};
type CompanionSchedulerState = (Pick<
  PerformRoomState,
  'bpm' | 'timeSignature' | 'roomScale' | 'companions' | 'companionChordLength' | 'companionChordProgression' | 'companionProgressionFlavor'
> | CompanionRuntimeSnapshot) & {
  companionPlayStartBeat?: number;
  roomId?: string;
};

const MAX_GENERATED_NOTE_CACHE_SIZE = 500;
const generatedNoteCache = new Map<string, ScheduledCompanionNote[]>();

/**
 * Humanizes a note event by adding slight variations to velocity and timing offset (jitter)
 */
function humanizeNote(note: { note: string; velocity: number; durationMs: number; offset: number; glideMs?: number }): NoteEvent {
  // Jitter: ±5ms to ±10ms (converted to seconds: ±0.005s to ±0.010s)
  const jitterSeconds = (Math.random() * 0.016 - 0.008); // -8ms to +8ms

  // Velocity humanization: ±8% variation
  const velocityVar = (Math.random() * 0.16 - 0.08);
  const velocity = Math.max(0.1, Math.min(1.0, note.velocity + velocityVar));

  const result: NoteEvent = {
    note: note.note,
    velocity,
    durationMs: note.durationMs,
    offset: Math.max(0, note.offset + jitterSeconds)
  };
  // Preserve the per-note portamento glide (bass slide) onto the emitted event.
  if (note.glideMs !== undefined) {
    result.glideMs = note.glideMs;
  }
  return result;
}

function normalizeNote(note: ScheduledCompanionNote): NoteEvent {
  const normalized: NoteEvent = {
    note: note.note,
    velocity: note.velocity,
    durationMs: note.durationMs,
    offset: note.offset,
  };
  if (note.legato !== undefined) {
    normalized.legato = note.legato;
  }
  return normalized;
}

function normalizeScale(
  scale?: { rootNote: string; scale: string },
): { rootNote: string; scale: 'major' | 'minor' } | undefined {
  if (!scale) return undefined;
  return {
    rootNote: scale.rootNote,
    scale: normalizeToMajorMinor(scale.scale),
  };
}

function makeGeneratedNoteCacheKey(params: {
  roomId: string;
  companion: CompanionConfig;
  chord: string;
  bpm: number;
  numerator: number;
  denominator: number;
  role: CompanionRole;
  chordDurationBeats: number;
  arpStartNoteIndex?: number;
  scale: { rootNote: string; scale: 'major' | 'minor' };
}): string {
  const { roomId, companion, chord, bpm, numerator, denominator, role, chordDurationBeats, arpStartNoteIndex, scale } = params;
  return JSON.stringify({
    roomId,
    companionId: companion.id,
    instrumentId: companion.instrumentId,
    role,
    style: companion.style,
    density: companion.density,
    timing: companion.timing,
    chord,
    bpm,
    numerator,
    denominator,
    chordDurationBeats,
    arpRate: companion.arpRate,
    arpDirection: companion.arpDirection,
    arpGate: companion.arpGate,
    // arpSustain/chordSustain gate the note gate → 100 (full-length) in the shared
    // orchestrator, so generated durations depend on them — they MUST be keyed or a
    // sustain toggle (or two companions differing only in sustain) serves stale notes.
    arpSustain: companion.arpSustain,
    arpOctave: companion.arpOctave,
    brokenBassRoot: companion.brokenBassRoot,
    arpStartNoteIndex,
    chordIntervalBars: companion.chordIntervalBars,
    chordGate: companion.chordGate,
    chordSustain: companion.chordSustain,
    chordOctave: companion.chordOctave,
    chordBassRoot: companion.chordBassRoot,
    // Expansion params for DEV-129
    chordComplexity: companion.chordComplexity,
    voicingStyle: companion.voicingStyle,
    bassPassingPattern: companion.bassPassingPattern,
    chordPlayStyle: companion.chordPlayStyle,
    brokenPattern: companion.brokenPattern,
    strumPattern: companion.strumPattern,
    strumSpeed: companion.strumSpeed,
    swingPercent: companion.swingPercent,
    groovePocket: companion.groovePocket,
    ghostNoteDensity: companion.ghostNoteDensity,
    drumFillIntervalBars: companion.drumFillIntervalBars,
    genrePreset: companion.genrePreset,
    embellishmentIntensity: companion.embellishmentIntensity,
    drumParts: companion.drumParts,
    snareVoice: companion.snareVoice,
    hatRoll: companion.hatRoll,
    ghostSnareDensity: companion.ghostSnareDensity,
    percussionLayer: companion.percussionLayer,
    octaveJumps: companion.octaveJumps,
    anticipationAmount: companion.anticipationAmount,
    enclosure: companion.enclosure,
    twoFeel: companion.twoFeel,
    slide: companion.slide,
    rolledChord: companion.rolledChord,
    chordAnticipation: companion.chordAnticipation,
    scaleRoot: scale.rootNote,
    scaleMode: scale.scale,
  });
}

function getCachedGeneratedNotes(
  key: string,
  generate: () => ScheduledCompanionNote[],
): ScheduledCompanionNote[] {
  const cached = generatedNoteCache.get(key);
  if (cached) return cached.map((note) => ({ ...note }));

  const notes = generate();
  if (generatedNoteCache.size >= MAX_GENERATED_NOTE_CACHE_SIZE) {
    const oldestKey = generatedNoteCache.keys().next().value;
    if (oldestKey) generatedNoteCache.delete(oldestKey);
  }
  generatedNoteCache.set(key, notes.map((note) => ({ ...note })));
  return notes;
}

export class CompanionScheduler {
  static clearGeneratedNoteCache(): void {
    generatedNoteCache.clear();
  }

  /**
   * Process a metronome tick on the server and schedule notes for active companions
   */
  static async processTick(
    roomState: CompanionSchedulerState,
    targetBeat: number,
    namespace: Namespace,
    targetBeatServerTime: number,
    clock: CompanionSchedulerClock = {}
  ): Promise<void> {
    const companions = roomState.companions;
    const activeCompanions = companions.filter((c: CompanionConfig) => c.isPlaying && !c.isMuted);
    
    if (activeCompanions.length === 0) {
      delete roomState.companionPlayStartBeat;
      return;
    }

    if (typeof roomState.companionPlayStartBeat !== 'number') {
      roomState.companionPlayStartBeat = targetBeat;
    }

    const playStartBeat = roomState.companionPlayStartBeat as number;
    const effectiveBeat = targetBeat - playStartBeat;

    const bpm = clock.bpm ?? roomState.bpm;
    const numerator = roomState.timeSignature.numerator;
    const denominator = roomState.timeSignature.denominator;
    const scale = normalizeScale(clock.roomScale)
      || normalizeScale(roomState.roomScale)
      || { rootNote: 'C', scale: 'major' };

    const timeSignature = { numerator, denominator };
    const barBeats = quarterNotesPerBar(timeSignature);
    const beatIndexInBar = beatInBar(effectiveBeat, timeSignature);
    const secondsPerBeat = quarterNoteMs(bpm) / 1000;

    const roomId = roomState.roomId as string | undefined;
    const companionPayloads: CompanionNoteEventPayload['companions'] = [];
    const globalChordLength = roomState.companionChordLength;
    const globalProgression = roomState.companionChordProgression;
    // DEV-202: harmonic flavor is room-global — resolve once and apply to every companion so
    // all companions land on the same chord (no per-companion clash) in Auto mode.
    const globalProgressionFlavor = roomState.companionProgressionFlavor;
    const effectiveProgression = {
      ...globalProgression,
      barsPerChord: globalProgression.mode === 'random'
        ? globalChordLength
        : globalProgression.barsPerChord,
    };

    for (const companion of activeCompanions) {
      try {
      // 1. Resolve Chord Progression state for the absolute beat, using global chord length and flavor
      const chordState = ChordProgressionEngine.getChordState(
        effectiveProgression,
        effectiveBeat,
        barBeats,
        scale,
        globalProgressionFlavor
      );

      const role = companion.role;
      const style = companion.style;

      // Clamped to [1,7] to bound the secondary-dominant passing chord's octave; the
      // orchestrator generators clamp their own octave inputs internally.
      const chordOctave = Math.max(
        1,
        Math.min(7, companion.chordOctave ?? DEFAULT_CHORD_COMPANION_SETTINGS.chordOctave),
      );

      const brokenPattern = companion.brokenPattern ?? DEFAULT_CHORD_COMPANION_SETTINGS.brokenPattern;
      const isMetricBroken = role === 'chord' && style === 'broken'
        && (brokenPattern === 'oom-pah' || brokenPattern === 'stride');

      const arpIntervalBeats = barsToQuarterBeats(
        companion.chordIntervalBars ?? DEFAULT_CHORD_COMPANION_SETTINGS.chordIntervalBars,
        timeSignature,
      );
      const arpRelativeBeat = chordState.relativeBeatInChord % arpIntervalBeats;

      // Metric patterns emit exactly one bar of notes; track position within a bar.
      const metricBarBeats = quarterNotesPerBar(timeSignature);
      const metricRelativeBeat = chordState.relativeBeatInChord % metricBarBeats;

      const arpRate = companion.arpRate ?? DEFAULT_CHORD_COMPANION_SETTINGS.arpRate;
      /* eslint-disable @typescript-eslint/naming-convention */
      const arpBeatIntervalMap: Record<string, number> = { '1/1': 4, '1/2': 2, '1/4': 1, '1/8': 0.5, '1/16': 0.25 };
      /* eslint-enable @typescript-eslint/naming-convention */
      const arpBeatInterval = arpBeatIntervalMap[arpRate] ?? 0.5;
      const notesPerArpCycle = Math.floor(arpIntervalBeats / arpBeatInterval);
      const completedArpCycles = Math.floor(chordState.relativeBeatInChord / arpIntervalBeats);
      const arpStartNoteIndex = completedArpCycles * notesPerArpCycle;

      const cacheKey = makeGeneratedNoteCacheKey({
        roomId: roomId ?? '',
        companion,
        chord: chordState.currentChord,
        bpm,
        numerator,
        denominator,
        role,
        chordDurationBeats: chordState.chordDurationBeats,
        arpStartNoteIndex,
        scale,
      });

      // Filter notes that belong specifically to the CURRENT scheduler beat.
      // Metric patterns (oom-pah/stride) emit one bar of notes keyed to bar-relative beats,
      // so we track within the bar (metricRelativeBeat). Cyclic broken patterns use the
      // arp-interval window (arpRelativeBeat). Other chord roles use relativeBeatInChord.
      const filterStartBeat = isMetricBroken
        ? metricRelativeBeat
        : (role === 'chord' && style === 'broken')
          ? arpRelativeBeat
          : (role === 'chord' ? chordState.relativeBeatInChord : beatIndexInBar);

      // pocket micro-timing shift
      const pocketSeconds = resolvePocketSeconds(companion);

      // Drum Fills (library-driven, decoupled from backbeat voice)
      const absoluteBar = Math.floor(effectiveBeat / barBeats);
      const fillIntervalBars = companion.drumFillIntervalBars ?? 0;

      // Shared render context (bpm / meter / scale) consumed by every orchestrator generator.
      const ctx: CompanionRenderContext = { bpm, timeSignature, scale };

      let noteEvents: NoteEvent[] = [];

      // Normal note generation and cache retrieval path — delegates to the shared
      // orchestrator. Perform renders exactly ONE per-tick window; the tick model's
      // window sizes + running arp index (below) are preserved so the shared
      // per-segment output matches the old inline generators note-for-note.
      const barNotes: ScheduledCompanionNote[] = getCachedGeneratedNotes(cacheKey, () => {
        switch (role) {
          case 'chord': {
            // Window the segment exactly as the tick model tracks position within it:
            //  - metric broken (oom-pah/stride) → one bar window (metricRelativeBeat filter)
            //  - cyclic broken → arp-interval window + carry the running arp note index
            //  - block / strum → whole chord-duration window
            const chordWindow = isMetricBroken
              ? barBeats
              : (style === 'broken')
                ? arpIntervalBeats
                : chordState.chordDurationBeats;
            const shouldCarryArpIndex = style === 'broken' && !isMetricBroken;
            return generateChordSegment({
              config: companion,
              chordSymbol: chordState.currentChord,
              durationBeats: chordWindow,
              ...(shouldCarryArpIndex ? { startNoteIndex: arpStartNoteIndex } : {}),
              ctx,
            });
          }
          case 'bass': {
            const nextChordRootMatch = chordState.nextChord.match(/^[A-G][#b]?/);
            return generateBassBar({
              config: companion,
              chordSymbol: chordState.currentChord,
              ...(nextChordRootMatch ? { nextChordRoot: nextChordRootMatch[0] } : {}),
              ctx,
            });
          }
          case 'beat':
            return generateBeatBar({ config: companion, ctx });
          default:
            return assertNever(role);
        }
      });

      // Beat companions: overlay the shared drum fill onto the cached bar BEFORE the
      // per-tick filter. computeBarFill returns null on non-fill bars (and bar 0), so
      // normal bars pass through untouched. The kept groove (< windowStart) plus the
      // fill notes (bar-relative beats >= windowStart) are then filtered per-tick and
      // humanized exactly like normal notes. Spread onto a fresh array so the shared
      // cache entry is never mutated.
      let barNotesForTick: ScheduledCompanionNote[] = barNotes;
      if (role === 'beat') {
        const fill = computeBarFill({ config: companion, seedId: companion.id, barIndex: absoluteBar, barBeats, bpm });
        if (fill) {
          barNotesForTick = [
            ...barNotes.filter((n) => n.beat < fill.windowStart),
            ...fill.fillNotes,
          ];
        }
      }

      let currentBeatNotes = barNotesForTick.filter(
        item => item.beat >= filterStartBeat && item.beat < filterStartBeat + 1
      );

      // Force play the dynamic passing chord (Secondary Dominant) at its transition beat (beatsUntilChange === 2)
      // if there are no scheduled notes in the current comping rhythm pattern.
      // NOTE: this forced-passing-chord path intentionally does NOT pass `timeSignature`, so
      // generateBlockChordNotes falls back to its 4/4 default here — unlike the now-meter-aware
      // main block path (which forwards ctx.timeSignature). This is a known, accepted residual
      // (spec §8): the 2-beat passing chord is a fixed dominant stab, not meter-tiled comping.
      if (
        role === 'chord' &&
        style !== 'broken' &&
        chordState.isSecondaryDominant &&
        chordState.beatsUntilChange === 2 &&
        currentBeatNotes.length === 0
      ) {
        const passNotes = generateBlockChordNotes(chordState.currentChord, bpm, 2, {
          intervalBeats: 2,
          gate: companion.chordGate ?? DEFAULT_CHORD_COMPANION_SETTINGS.chordGate,
          octave: chordOctave,
          ...(companion.chordComplexity !== undefined ? { chordComplexity: companion.chordComplexity } : {}),
          ...(companion.voicingStyle !== undefined ? { voicingStyle: companion.voicingStyle } : {}),
          chordPlayStyle: 'block',
          scale,
        });

        const forcedNotes = (passNotes as ScheduledCompanionNote[]).filter(item => item.beat === 0);
        forcedNotes.forEach(item => {
          item.beat = filterStartBeat;
        });

        currentBeatNotes = [...currentBeatNotes, ...forcedNotes];
      }

      // Convert notes to absolute offsets relative to the start of this beat
      noteEvents = currentBeatNotes.map(item => {
        const beatOffset = item.beat - filterStartBeat; // range: [0.0, 1.0)
        const offsetInSeconds = beatOffset * secondsPerBeat;

        if (role === 'chord') {
          const note = normalizeNote({
            ...item,
            offset: offsetInSeconds,
          });
          note.offset = Math.max(0, note.offset + pocketSeconds);
          return note;
        }

        const note = humanizeNote({
          note: item.note,
          velocity: item.velocity,
          durationMs: item.durationMs,
          offset: offsetInSeconds,
          ...(item.glideMs !== undefined ? { glideMs: item.glideMs } : {}),
        });
        note.offset = Math.max(0, note.offset + pocketSeconds);
        return note;
      });

      if (role === 'beat') {
        const parts = resolveDrumParts(companion.drumParts);
        const CRASH_PHRASE_BARS = 4;
        const phraseBars = fillIntervalBars > 0 ? fillIntervalBars : CRASH_PHRASE_BARS;
        const isCrashBar = absoluteBar % phraseBars === 0;
        if (parts.crash && isCrashBar && beatIndexInBar === 0) {
          const crashNote = humanizeNote({ note: 'C#3', velocity: 0.9, durationMs: 0.5 * quarterNoteMs(bpm), offset: 0 });
          crashNote.offset = Math.max(0, crashNote.offset + pocketSeconds);
          noteEvents.push(crashNote);
        }
      }

      companionPayloads.push({
        companionId: companion.id,
        notes: noteEvents,
        currentChord: chordState.currentChord,
        nextChord: chordState.nextChord,
        beatsUntilChange: chordState.beatsUntilChange,
        chordDurationBeats: chordState.chordDurationBeats,
        isBorrowed: chordState.isBorrowed as boolean,
        isSecondaryDominant: chordState.isSecondaryDominant as boolean,
      });
      } catch (companionErr) {
        console.error(
          `[CompanionScheduler] Error processing companion ${companion.id} in room ${roomId ?? 'unknown'}:`,
          companionErr,
        );
        // Continue to next companion — one bad companion must not silence the rest
      }
    }

    if (companionPayloads.length > 0) {
      const payload: CompanionNoteEventPayload = {
        companions: companionPayloads,
        targetBeat,
        targetBeatServerTime,
        beatAudioTime: targetBeatServerTime,
        // The live bar phase of this tick. Clients mirror it into `roomStore` so a
        // Perform take saved to Arrange can be re-based onto the room's bar grid
        // (DEV-286) — see `CompanionNoteEventPayload.beatIndexInBar`.
        beatIndexInBar,
      };

      try {
        namespace.emit(PERFORM_EVENTS.COMPANION_NOTE_EVENTS, payload);
      } catch (emitErr) {
        console.error(
          `[CompanionScheduler] Failed to emit note events in room ${roomId ?? 'unknown'}:`,
          emitErr,
        );
      }
    }
  }
}
