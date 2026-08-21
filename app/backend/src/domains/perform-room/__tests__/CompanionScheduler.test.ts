import { PERFORM_EVENTS, DEFAULT_COMPANION_CHORD_PROGRESSION, generateBlockChordNotes, resolveDrumParts, quarterNoteMs, barsToQuarterBeats , DEFAULT_COMPANION_VOLUME_DB } from '@jam-band/shared';
import type { CompanionConfig, ChordPlayStyle, CompanionNoteEventPayload, DrumPart, NoteEvent } from '@jam-band/shared';
import { CompanionScheduler } from '../application/CompanionScheduler';
import type { PerformRoomState } from '../domain/models/PerformRoomState';
import type { Namespace } from 'socket.io';

// Helper type for test access to the scheduler's internal companionPlayStartBeat field
type RoomStateWithStartBeat = PerformRoomState & { companionPlayStartBeat?: number };

// Helper: build a minimal beat-role room state with optional drumParts and drumFillIntervalBars overrides
const makeBeatRoomState = (overrides: { drumParts?: Record<DrumPart, boolean>; drumFillIntervalBars?: number } = {}): PerformRoomState & { companionPlayStartBeat: number } => ({
  roomId: 'room-beat',
  roomType: 'perform',
  userStates: new Map(),
  recordingStates: { isAudioRecording: false, isSessionRecording: false, shadowCaptureStates: {} },
  broadcastStates: {},
  voiceStates: {},
  occupancy: new Map(),
  roomScale: { rootNote: 'C', scale: 'major' },
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  companionChordLength: 2,
  companionProgressionFlavor: 'diatonic',
  companionChordProgression: DEFAULT_COMPANION_CHORD_PROGRESSION,
  lastUpdated: new Date(),
  companionPlayStartBeat: 0,
  companions: [
    {
      id: 'beat-companion',
      instrumentId: 'standard_kit',
      role: 'beat',
      style: 'normal',
      density: 'normal',
      isPlaying: true,
      isMuted: false,
      volume: DEFAULT_COMPANION_VOLUME_DB,
      ...(overrides.drumParts !== undefined ? { drumParts: overrides.drumParts } : {}),
      ...(overrides.drumFillIntervalBars !== undefined ? { drumFillIntervalBars: overrides.drumFillIntervalBars } : {}),
    } satisfies CompanionConfig,
  ],
});

// Helper: read companions[0].notes from the last emit call on the namespace
const lastEmittedCompanionNotes = (namespace: Namespace): CompanionNoteEventPayload['companions'][number]['notes'] => {
  const mock = (namespace.emit as jest.Mock);
  if (mock.mock.calls.length === 0) return [];
  const lastCall = mock.mock.calls[mock.mock.calls.length - 1] as [string, CompanionNoteEventPayload];
  return lastCall[1].companions[0]?.notes ?? [];
};

// Helper to extract the typed payload from a jest.fn() emit call at a given index
const typedEmitCalls = (mock: jest.Mock): Array<[eventName: string, payload: CompanionNoteEventPayload]> =>
  mock.mock.calls as Array<[string, CompanionNoteEventPayload]>;
const getEmitPayload = (mock: jest.Mock, callIndex = 0): CompanionNoteEventPayload =>
  (mock.mock.calls as Array<[string, CompanionNoteEventPayload]>)[callIndex]![1];

describe('CompanionScheduler', () => {
  const createRoomState = (): PerformRoomState => ({
    roomId: 'room-1',
    roomType: 'perform',
    userStates: new Map(),
    recordingStates: {
      isAudioRecording: false,
      isSessionRecording: false,
      shadowCaptureStates: {},
    },
    broadcastStates: {},
    voiceStates: {},
    occupancy: new Map(),
    roomScale: { rootNote: 'C', scale: 'major' },
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4 },
    companionChordLength: 2,
    companionProgressionFlavor: 'diatonic',
    companionChordProgression: DEFAULT_COMPANION_CHORD_PROGRESSION,
    lastUpdated: new Date(),
    companions: [
      {
        id: 'companion-1',
        instrumentId: 'acoustic_grand_piano',
        role: 'chord',
        style: 'broken',
        density: 'normal',
        isPlaying: true,
        isMuted: false,
        volume: DEFAULT_COMPANION_VOLUME_DB,
        arpRate: '1/8',
        arpDirection: 'up',
        arpGate: 70,
        arpOctave: 3,
      },
    ],
  });

  afterEach(() => {
    CompanionScheduler.clearGeneratedNoteCache();
  });

  it('emits continuous 1/8 arpeggio notes relative to the current chord interval', async () => {
    const emit = jest.fn();
    const namespace = { emit } as unknown as Namespace;
    const roomState = createRoomState();

    await CompanionScheduler.processTick(roomState, 0, namespace, 1_000);
    await CompanionScheduler.processTick(roomState, 1, namespace, 1_500);
    await CompanionScheduler.processTick(roomState, 2, namespace, 2_000);

    const emittedCompanions = typedEmitCalls(emit).map((call) => call[1].companions[0]);

    expect(emit).toHaveBeenCalledWith(PERFORM_EVENTS.COMPANION_NOTE_EVENTS, expect.any(Object));
    expect(getEmitPayload(emit, 0)).toMatchObject({
      targetBeat: 0,
      targetBeatServerTime: 1_000,
      beatAudioTime: 1_000,
    });
    expect(emittedCompanions[0]?.notes.map((note) => note.note)).toEqual(['C3', 'E3']);
    expect(emittedCompanions[0]?.notes.map((note) => note.offset)).toEqual([0, 0.25]);
    expect(emittedCompanions[1]?.notes.map((note) => note.note)).toEqual(['G3', 'C3']);
    expect(emittedCompanions[2]?.notes).toHaveLength(2);
  });

  it('emits 16/bar arpeggio notes every quarter beat', async () => {
    const emit = jest.fn();
    const namespace = { emit } as unknown as Namespace;
    const roomState = createRoomState();
    roomState.companions = [
      {
        ...roomState.companions[0]!,
        arpRate: '1/16',
      } as CompanionConfig,
    ];

    await CompanionScheduler.processTick(roomState, 0, namespace, 1_000);

    const notes = (getEmitPayload(emit, 0)).companions[0]?.notes ?? [];
    expect(notes.map((note) => note.note)).toEqual(['C3', 'E3', 'G3', 'C3']);
    expect(notes.map((note) => note.offset)).toEqual([0, 0.125, 0.25, 0.375]);
  });

  it('uses the live metronome BPM for sub-beat arpeggio offsets', async () => {
    const emit = jest.fn();
    const namespace = { emit } as unknown as Namespace;
    const roomState = createRoomState();
    roomState.bpm = 120;
    roomState.companions = [
      {
        ...roomState.companions[0]!,
        arpRate: '1/16',
      } as CompanionConfig,
    ];

    await CompanionScheduler.processTick(roomState, 0, namespace, 1_000, { bpm: 90 });

    const notes = (getEmitPayload(emit, 0)).companions[0]?.notes ?? [];
    expect(notes.map((note) => note.offset)).toEqual([
      0,
      1 / 6,
      1 / 3,
      1 / 2,
    ]);
  });

  it('invalidates generated note cache when BPM changes', async () => {
    const emit = jest.fn();
    const namespace = { emit } as unknown as Namespace;
    const roomState = createRoomState();
    roomState.companions = [
      {
        ...roomState.companions[0]!,
        arpRate: '1/16',
      } as CompanionConfig,
    ];

    await CompanionScheduler.processTick(roomState, 0, namespace, 1_000, { bpm: 120 });
    await CompanionScheduler.processTick(roomState, 0, namespace, 2_000, { bpm: 90 });

    const firstOffsets = ((getEmitPayload(emit, 0)).companions[0]?.notes ?? []).map((note) => note.offset);
    const secondOffsets = ((getEmitPayload(emit, 1)).companions[0]?.notes ?? []).map((note) => note.offset);
    expect(firstOffsets).toEqual([0, 0.125, 0.25, 0.375]);
    expect(secondOffsets).toEqual([0, 1 / 6, 1 / 3, 1 / 2]);
  });

  it('uses the current room owner scale when perform state has not stored one yet', async () => {
    const emit = jest.fn();
    const namespace = { emit } as unknown as Namespace;
    const roomState = createRoomState();
    delete roomState.roomScale;

    await CompanionScheduler.processTick(
      roomState,
      0,
      namespace,
      1_000,
      { roomScale: { rootNote: 'D', scale: 'minor' } },
    );

    const companionPayload = (getEmitPayload(emit, 0)).companions[0];
    expect(companionPayload?.currentChord).toBe('Dm');
    expect(companionPayload?.notes.map((note) => note.note)).toEqual(['D3', 'F3']);
  });

  it('emits gate-length arpeggio notes without legato overlap', async () => {
    const emit = jest.fn();
    const namespace = { emit } as unknown as Namespace;
    const roomState = createRoomState();
    roomState.companions = [
      {
        ...roomState.companions[0]!,
        arpGate: 100,
      } as CompanionConfig,
    ];

    await CompanionScheduler.processTick(roomState, 0, namespace, 1_000);

    const notes = (getEmitPayload(emit, 0)).companions[0]?.notes ?? [];
    expect(notes.map((note) => note.note)).toEqual(['C3', 'E3']);
    expect(notes.map((note) => note.durationMs)).toEqual([250, 250]);
    expect(notes.every((note) => note.legato === undefined)).toBe(true);
  });

  it('bass root-fifth/normal in 6/4 emits root at beat 0 and fifth at beat 3', async () => {
    const emit = jest.fn();
    const namespace = { emit } as unknown as Namespace;
    const roomState = createRoomState();
    roomState.timeSignature = { numerator: 6, denominator: 4 };
    roomState.companions = [
      {
        id: 'companion-bass',
        instrumentId: 'acoustic_bass',
        role: 'bass',
        style: 'root-fifth',
        density: 'normal',
        isPlaying: true,
        isMuted: false,
        volume: DEFAULT_COMPANION_VOLUME_DB,
      } as CompanionConfig,
    ];

    await CompanionScheduler.processTick(roomState, 0, namespace, 1_000);

    const notes = (getEmitPayload(emit, 0)).companions[0]?.notes ?? [];
    // Beat 0 of 6/4 bar: root note at offset ≈ 0 (humanize adds up to ±8ms jitter in seconds)
    expect(notes[0]?.note).toBe('C2');
    expect(notes[0]?.offset).toBeLessThan(0.01); // within 10ms
    // No second note in beat 0 (fifth lands at beat 3, a different scheduler tick)
    expect(notes).toHaveLength(1);
  });

  it('beat notes land on kick group downbeats for 5/4 [2,3] grouping', async () => {
    const emit = jest.fn();
    const namespace = { emit } as unknown as Namespace;
    const roomState = createRoomState();
    roomState.timeSignature = { numerator: 5, denominator: 4 };
    roomState.companions = [
      {
        id: 'companion-beat',
        instrumentId: 'standard_kit',
        role: 'beat',
        style: 'normal',
        density: 'normal',
        isPlaying: true,
        isMuted: false,
        volume: DEFAULT_COMPANION_VOLUME_DB,
      } as CompanionConfig,
    ];

    // Tick at beat 0 (bar downbeat — kick expected)
    await CompanionScheduler.processTick(roomState, 0, namespace, 1_000);
    // Tick at beat 2 (secondary group downbeat for 5/4 [2,3] — kick expected)
    await CompanionScheduler.processTick(roomState, 2, namespace, 2_000);
    // Tick at beat 1 (not a group downbeat — no kick expected)
    await CompanionScheduler.processTick(roomState, 1, namespace, 1_500);

    const kick = 'C2';
    const notesAtBeat0 = (getEmitPayload(emit, 0)).companions[0]?.notes ?? [];
    const notesAtBeat2 = (getEmitPayload(emit, 1)).companions[0]?.notes ?? [];
    const notesAtBeat1 = (getEmitPayload(emit, 2)).companions[0]?.notes ?? [];

    expect(notesAtBeat0.some((n) => n.note === kick)).toBe(true);
    expect(notesAtBeat2.some((n) => n.note === kick)).toBe(true);
    expect(notesAtBeat1.some((n) => n.note === kick)).toBe(false);
  });

  it('arp note offsets are wall-clock-correct for 6/8 at bpm=120', async () => {
    const emit = jest.fn();
    const namespace = { emit } as unknown as Namespace;
    const roomState = createRoomState();
    roomState.bpm = 120;
    roomState.timeSignature = { numerator: 6, denominator: 8 };
    roomState.companions = [
      {
        ...roomState.companions[0]!,
        arpRate: '1/8',
        arpDirection: 'up',
        arpGate: 100,
      } as CompanionConfig,
    ];

    await CompanionScheduler.processTick(roomState, 0, namespace, 1_000);

    const notes = (getEmitPayload(emit, 0)).companions[0]?.notes ?? [];
    // '1/8' rate = one note per eighth note = 0.5 QN (time-signature-agnostic note value)
    // secondsPerBeat = 60/120 = 0.5s  →  offset of second note = 0.5 * 0.5 = 0.25s
    expect(notes[1]?.offset).toBeCloseTo(0.25);
  });

  describe('groovePocket offset', () => {
    // Use chord companion (block, no humanization) so offset = exactly pocketSeconds
    const chordPocketCompanion = (groovePocket: NonNullable<CompanionConfig['groovePocket']>): CompanionConfig => ({
      id: 'chord-pocket',
      instrumentId: 'acoustic_grand_piano',
      role: 'chord',
      style: 'block',
      density: 'normal',
      isPlaying: true,
      isMuted: false,
      volume: DEFAULT_COMPANION_VOLUME_DB,
      groovePocket,
      chordPlayStyle: 'block',
      chordIntervalBars: 1,
      chordGate: 70,
      chordOctave: 3,
    } satisfies CompanionConfig);

    it('on-grid produces offset = 0 exactly for block chord at beat 0', async () => {
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const roomState = createRoomState();
      roomState.companions = [chordPocketCompanion('on-grid')];
      await CompanionScheduler.processTick(roomState, 0, namespace, 1_000);
      const notes = (getEmitPayload(emit, 0)).companions[0]?.notes ?? [];
      expect(notes.length).toBeGreaterThan(0);
      notes.forEach(n => expect(n.offset).toBe(0));
    });

    it('laidback adds +25ms (0.025s) to block chord offset', async () => {
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const roomState = createRoomState();
      roomState.companions = [chordPocketCompanion('laidback')];
      await CompanionScheduler.processTick(roomState, 0, namespace, 1_000);
      const notes = (getEmitPayload(emit, 0)).companions[0]?.notes ?? [];
      expect(notes.length).toBeGreaterThan(0);
      notes.forEach(n => expect(n.offset).toBe(0.025));
    });

    it('push is clamped to 0 (since -15ms < 0)', async () => {
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const roomState = createRoomState();
      roomState.companions = [chordPocketCompanion('push')];
      await CompanionScheduler.processTick(roomState, 0, namespace, 1_000);
      const notes = (getEmitPayload(emit, 0)).companions[0]?.notes ?? [];
      expect(notes.length).toBeGreaterThan(0);
      notes.forEach(n => expect(n.offset).toBe(0)); // clamped from -0.015
    });
  });

  describe('drumFillIntervalBars', () => {
    const beatCompanion = (fillInterval: number): CompanionConfig => ({
      id: 'beat-fill',
      instrumentId: 'standard_kit',
      role: 'beat',
      style: 'basic',
      density: 'normal',
      isPlaying: true,
      isMuted: false,
      volume: DEFAULT_COMPANION_VOLUME_DB,
      drumFillIntervalBars: fillInterval,
    } satisfies CompanionConfig);

    it('disabled (0) does not emit snare-roll fill notes', async () => {
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const roomState = createRoomState();
      roomState.companions = [beatCompanion(0)];
      // beat 2 in bar 3 (would be fill zone if isEnabled) = absoluteBar=3, beat 2
      await CompanionScheduler.processTick(roomState, 14, namespace, 1_000); // bar 3, beat 2
      const payload = emit.mock.calls.length > 0 ? (getEmitPayload(emit, 0)) : undefined;
      const notes = payload?.companions[0]?.notes ?? [];
      const fillNotes = notes.filter(n => n.note === 'D2');
      expect(fillNotes).toHaveLength(0);
    });

    it('fill interval 4 generates fill notes (toms by default) in last 2 beats of bar 3 (0-indexed)', async () => {
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const roomState = createRoomState();
      roomState.companions = [beatCompanion(4)];
      // Pre-set companionPlayStartBeat=0 so effectiveBeat = targetBeat
      (roomState as RoomStateWithStartBeat).companionPlayStartBeat = 0;
      // bar 3 in 4/4: barBeats=4, absoluteBar=3 (beats 12-15), fill zone = beats 14,15
      // Default drumParts: toms=true → descending tom roll (C3/A2/F2) takes priority over snare roll
      await CompanionScheduler.processTick(roomState, 14, namespace, 1_000);
      const notes = emit.mock.calls.length > 0 ? ((getEmitPayload(emit, 0)).companions[0]?.notes ?? []) : [];
      const fillNotes = notes.filter(n => n.note === 'C3' || n.note === 'A2' || n.note === 'F2');
      expect(fillNotes.length).toBeGreaterThan(0);
    });

    it('no fill notes on non-fill bars', async () => {
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const roomState = createRoomState();
      roomState.companions = [beatCompanion(4)];
      (roomState as RoomStateWithStartBeat).companionPlayStartBeat = 0;
      // bar 1 (absoluteBar=1) is NOT a fill bar for interval=4 (fill at bars 3, 7, 11...)
      await CompanionScheduler.processTick(roomState, 6, namespace, 1_000); // bar 1, beat 2
      const notes = emit.mock.calls.length > 0 ? ((getEmitPayload(emit, 0)).companions[0]?.notes ?? []) : [];
      const fillNotes = notes.filter(n => n.note === 'D2');
      expect(fillNotes).toHaveLength(0);
    });
  });

  describe('fills (library-driven, decoupled from backbeat)', () => {
    // Helper: emit both fill-zone beats of bar 3 (fillIntervalBars=4 → fill bar is bar 3,
    // barBeats=4 → beats 14,15) and collect the emitted note pitches (deterministic;
    // humanizeNote only jitters velocity/offset, not pitch).
    const fillPitchesForBar3 = async (drumParts: Record<DrumPart, boolean>): Promise<string[]> => {
      CompanionScheduler.clearGeneratedNoteCache();
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const state = makeBeatRoomState({ drumParts, drumFillIntervalBars: 4 });
      const pitches: string[] = [];
      for (const beat of [14, 15]) {
        await CompanionScheduler.processTick(state, beat, namespace, Date.now());
        pitches.push(...lastEmittedCompanionNotes(namespace).map((n: NoteEvent) => n.note));
      }
      return pitches;
    };

    it('fills are decoupled from backbeat — identical pitches whether backbeat is snare or toms', async () => {
      const withSnare = await fillPitchesForBar3(resolveDrumParts({ snare: true, toms: false }));
      const withToms = await fillPitchesForBar3(resolveDrumParts({ snare: false, toms: true }));
      expect(withSnare.length).toBeGreaterThan(0);      // non-vacuous: a fill played
      expect(withSnare).toEqual(withToms);              // backbeat choice does not change the fill
    });

    it('emits no rapid tom-fill notes when fills are disabled (interval 0)', async () => {
      CompanionScheduler.clearGeneratedNoteCache();
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const state = makeBeatRoomState({ drumParts: resolveDrumParts({}), drumFillIntervalBars: 0 });
      await CompanionScheduler.processTick(state, 15, namespace, Date.now());
      const notes = lastEmittedCompanionNotes(namespace).map((n: NoteEvent) => n.note);
      // Minimal default kit has toms off and no fills → no tom voices at all.
      expect(notes.filter((n: string) => n === 'C3' || n === 'A2' || n === 'F2').length).toBe(0);
    });
  });

  describe('chordPlayStyle variants for block chord companion', () => {
    const chordCompanion = (chordPlayStyle: ChordPlayStyle): CompanionConfig => ({
      id: 'chord-play',
      instrumentId: 'acoustic_grand_piano',
      role: 'chord',
      style: 'block',
      density: 'normal',
      isPlaying: true,
      isMuted: false,
      volume: DEFAULT_COMPANION_VOLUME_DB,
      chordPlayStyle,
      chordIntervalBars: 1,
      chordGate: 70,
      chordOctave: 3,
    });

    // Uses shared roomState with companionPlayStartBeat=0 so effectiveBeat = targetBeat
    const getNotesAtBeat = async (companion: CompanionConfig, beat: number) => {
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const roomState = createRoomState();
      roomState.companions = [companion];
      (roomState as RoomStateWithStartBeat).companionPlayStartBeat = 0;
      await CompanionScheduler.processTick(roomState, beat, namespace, beat * 500);
      const payload = emit.mock.calls.length > 0 ? (getEmitPayload(emit, 0)) : undefined;
      return payload?.companions[0]?.notes ?? [];
    };

    it('charleston fires at beat 0 (hits 0 and 0.5 within window [0,1))', async () => {
      const notes = await getNotesAtBeat(chordCompanion('charleston'), 0);
      expect(notes.length).toBeGreaterThan(0);
    });

    it('charleston does NOT fire on beat 1 (pattern hits only at 0, 0.5 within interval)', async () => {
      const notes = await getNotesAtBeat(chordCompanion('charleston'), 1);
      expect(notes).toHaveLength(0);
    });

    it('offbeat fires at beat 0 window (pattern beat 0.5 falls in [0,1))', async () => {
      const notes = await getNotesAtBeat(chordCompanion('offbeat'), 0);
      // offbeat: [0.5, 1.5, 2.5, 3.5] — beat 0.5 is inside window [0, 1)
      expect(notes.length).toBeGreaterThan(0);
    });

    it('skank fires at beat 1 and beat 3 (pattern [1.5, 3.5] captured by respective windows)', async () => {
      // beat 1 window [1,2) captures 1.5
      const notes1 = await getNotesAtBeat(chordCompanion('skank'), 1);
      expect(notes1.length).toBeGreaterThan(0);
      // beat 3 window [3,4) captures 3.5
      const notes3 = await getNotesAtBeat(chordCompanion('skank'), 3);
      expect(notes3.length).toBeGreaterThan(0);
    });

    it('syncopated-push fires at beat 0', async () => {
      const notes = await getNotesAtBeat(chordCompanion('syncopated-push'), 0);
      expect(notes.length).toBeGreaterThan(0);
    });

    it('bossa fires at beat 0', async () => {
      const notes = await getNotesAtBeat(chordCompanion('bossa'), 0);
      expect(notes.length).toBeGreaterThan(0);
    });
  });

  describe('chordIntervalBars = 0.5 (half-bar repeat)', () => {
    it('block chord fires at beat 0 AND beat 2 for a 4-beat chord in 4/4', async () => {
      const companion: CompanionConfig = {
        id: 'chord-half',
        instrumentId: 'acoustic_grand_piano',
        role: 'chord',
        style: 'block',
        density: 'normal',
        isPlaying: true,
        isMuted: false,
        volume: DEFAULT_COMPANION_VOLUME_DB,
        chordPlayStyle: 'block',
        chordIntervalBars: 0.5,
        chordGate: 70,
        chordOctave: 3,
      };
      const roomState = createRoomState();
      roomState.companions = [companion];
      (roomState as RoomStateWithStartBeat).companionPlayStartBeat = 0; // effectiveBeat = targetBeat

      const getNotesAtBeat = async (beat: number) => {
        const emit = jest.fn();
        const ns = { emit } as unknown as Namespace;
        await CompanionScheduler.processTick(roomState, beat, ns, beat * 500);
        const payload = emit.mock.calls.length > 0 ? (getEmitPayload(emit, 0)) : undefined;
        return payload?.companions[0]?.notes ?? [];
      };

      const notesAt0 = await getNotesAtBeat(0);
      const notesAt2 = await getNotesAtBeat(2);
      const notesAt1 = await getNotesAtBeat(1);
      expect(notesAt0.length).toBeGreaterThan(0); // fires at start
      expect(notesAt2.length).toBeGreaterThan(0); // fires at half bar
      expect(notesAt1).toHaveLength(0);           // silent in between
    });
  });

  describe('advanced chord parameters', () => {
    it('chordComplexity triad gives 3 notes for C major degree-1 chord', async () => {
      // Use manual mode with degree 1 in C major (C = C E G) — well-defined notes via diatonic engine
      // Note: the room-global progression uses diatonic degrees; the diatonic engine returns basic triads
      // so chordComplexity:'seventh' yields the same 3-note triad (slice(0,4) on a 3-note set).
      // The feature extends beyond 3 notes only when the chord name itself encodes a 7th (e.g., Cmaj7).
      const makeCompanion = (complexity: 'triad' | 'seventh' | 'extended'): CompanionConfig => ({
        id: 'chord-complexity',
        instrumentId: 'acoustic_grand_piano',
        role: 'chord',
        style: 'block',
        density: 'normal',
        isPlaying: true,
        isMuted: false,
        volume: DEFAULT_COMPANION_VOLUME_DB,
        chordComplexity: complexity,
        chordPlayStyle: 'block',
        chordIntervalBars: 1,
        chordGate: 70,
        chordOctave: 3,
      });

      const getNotesAtBeat0 = async (companion: CompanionConfig) => {
        const emit = jest.fn();
        const ns = { emit } as unknown as Namespace;
        const roomState = createRoomState();
        roomState.roomScale = { rootNote: 'C', scale: 'major' };
        roomState.companionChordProgression = {
          mode: 'manual',
          chords: [{ degree: 1, durationBars: 4 }],
          barsPerChord: 4,
          currentChordIndex: 0,
        };
        roomState.companions = [companion];
        await CompanionScheduler.processTick(roomState, 0, ns, 1_000);
        const payload = emit.mock.calls.length > 0 ? (getEmitPayload(emit, 0)) : undefined;
        return payload?.companions[0]?.notes ?? [];
      };

      const triadNotes = await getNotesAtBeat0(makeCompanion('triad'));
      const seventhNotes = await getNotesAtBeat0(makeCompanion('seventh'));
      expect(triadNotes.length).toBe(3); // triad: C E G
      // Diatonic chord engine returns triads; slice(0,4) on a 3-note chord still gives 3 notes
      expect(seventhNotes.length).toBeGreaterThanOrEqual(3);
    });

    it('chordComplexity seventh yields 4 distinct notes for Am7; triad returns full base chord unchanged', () => {
      // generateBlockChordNotes accepts a chord-name string directly.
      // Am7 = A C E G — 4 pitch classes in Tonal.js.
      // enrichChordTones for 'triad' complexity returns base unchanged (additive-floor: never truncates).
      // Since Am7's base already has 4 notes (>= triad target of 3), triad also returns all 4.
      // 'seventh' target is 4, and base already has 4 notes, so both modes return the same 4 pitches.
      const blockConfig = { intervalBeats: 4, gate: 70, octave: 3 } as const;
      const triadNotes = generateBlockChordNotes('Am7', 120, 4, {
        ...blockConfig,
        chordComplexity: 'triad',
        chordPlayStyle: 'block',
      });
      const seventhNotes = generateBlockChordNotes('Am7', 120, 4, {
        ...blockConfig,
        chordComplexity: 'seventh',
        chordPlayStyle: 'block',
      });
      // Block chord fires once per interval; unique pitches = distinct note names
      const uniquePitches = (notes: ReturnType<typeof generateBlockChordNotes>) =>
        new Set(notes.map(n => n.note.replace(/\d+$/, ''))).size;
      // Am7 base = [A, C, E, G] (4 notes) — triad doesn't truncate, returns base unchanged (additive-floor)
      expect(uniquePitches(triadNotes)).toBe(4); // A C E G (base unchanged)
      expect(uniquePitches(seventhNotes)).toBe(4); // A C E G
    });

    it('voicingStyle rootless drops the root note', async () => {
      const companion: CompanionConfig = {
        id: 'chord-voicing',
        instrumentId: 'acoustic_grand_piano',
        role: 'chord',
        style: 'block',
        density: 'normal',
        isPlaying: true,
        isMuted: false,
        volume: DEFAULT_COMPANION_VOLUME_DB,
        chordComplexity: 'seventh',
        voicingStyle: 'rootless',
        chordPlayStyle: 'block',
        chordIntervalBars: 1,
        chordGate: 70,
        chordOctave: 3,
      };
      const roomState = createRoomState();
      roomState.roomScale = { rootNote: 'C', scale: 'major' }; // Cmaj7: C E G B
      roomState.companions = [companion];
      const emit = jest.fn();
      const ns = { emit } as unknown as Namespace;
      await CompanionScheduler.processTick(roomState, 0, ns, 1_000);
      const notesPayload = emit.mock.calls.length > 0 ? (getEmitPayload(emit, 0)) : undefined;
      const notes = notesPayload?.companions[0]?.notes ?? [];
      // Rootless = no C note
      expect(notes.some(n => n.note.startsWith('C'))).toBe(false);
    });

    it('chordComplexity seventh in C major adds diatonic 7th to G chord (G B D → G B D F)', async () => {
      // In C major, degree 5 resolves to G (G B D). With chordComplexity:'seventh' and the room
      // scale threaded through, enrichChordTones adds the diatonic 7th: F (the minor 7th of G in C major).
      // Without scale threading this falls back to the bare triad (3 notes, no F).
      const companion: CompanionConfig = {
        id: 'chord-seventh-scale',
        instrumentId: 'acoustic_grand_piano',
        role: 'chord',
        style: 'block',
        density: 'normal',
        isPlaying: true,
        isMuted: false,
        volume: DEFAULT_COMPANION_VOLUME_DB,
        chordComplexity: 'seventh',
        chordPlayStyle: 'block',
        chordIntervalBars: 1,
        chordGate: 70,
        chordOctave: 4,
      };
      const roomState = createRoomState();
      roomState.roomScale = { rootNote: 'C', scale: 'major' };
      // Manual progression: single G chord (degree 5 in C major)
      roomState.companionChordProgression = {
        mode: 'manual',
        chords: [{ degree: 5, durationBars: 4 }],
        barsPerChord: 4,
        currentChordIndex: 0,
      };
      roomState.companions = [companion];
      const emit = jest.fn();
      const ns = { emit } as unknown as Namespace;
      await CompanionScheduler.processTick(roomState, 0, ns, 1_000);
      const notesPayload = emit.mock.calls.length > 0 ? (getEmitPayload(emit, 0)) : undefined;
      const notes = notesPayload?.companions[0]?.notes ?? [];
      // Should have 4 pitch classes: G, B, D, F (diatonic minor 7th)
      const pitchClasses = notes.map(n => n.note.replace(/\d+$/, ''));
      expect(pitchClasses).toContain('F'); // diatonic 7th from room scale
      expect(notes).toHaveLength(4);       // seventh voicing = 4 notes
    });
  });

  describe('error recovery', () => {
    it('continues processing other companions when one throws', async () => {
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const roomState = createRoomState();
      // Companion 1: invalid state — circular reference causes JSON.stringify to throw in cacheKey generation
      const badBase: Record<string, unknown> = {
        id: 'bad-companion',
        instrumentId: 'acoustic_grand_piano',
        role: 'chord',
        style: 'block',
        density: 'normal',
        isPlaying: true,
        isMuted: false,
        volume: DEFAULT_COMPANION_VOLUME_DB,
      };
      badBase['circular'] = badBase; // triggers JSON.stringify throw in makeGeneratedNoteCacheKey
      const badCompanion = badBase as unknown as CompanionConfig;
      // Companion 2: valid
      const goodCompanion: CompanionConfig = {
        ...createRoomState().companions[0]!,
        id: 'good-companion',
      };
      roomState.companions = [badCompanion, goodCompanion];

      // Should not throw even though bad companion errors
      await expect(
        CompanionScheduler.processTick(roomState, 0, namespace, 1_000),
      ).resolves.toBeUndefined();

      // Good companion should still emit
      const emitted = typedEmitCalls(emit).find(c => c[1].companions.some((comp) => comp.companionId === 'good-companion'));
      expect(emitted).toBeTruthy();
    });
  });

  it('all companions share the room-global manual progression', async () => {
    const emit = jest.fn();
    const namespace = { emit } as unknown as Namespace;
    const roomState = createRoomState();
    roomState.companions = [
      { ...roomState.companions[0]!, id: 'companion-bass', role: 'bass', style: 'root-only', instrumentId: 'acoustic_bass' },
      { ...roomState.companions[0]!, id: 'companion-chord', role: 'chord', style: 'block', instrumentId: 'acoustic_grand_piano' },
    ];
    roomState.companionChordProgression = {
      mode: 'manual',
      chords: [{ degree: 1, durationBars: 1 }, { degree: 5, durationBars: 1 }],
      barsPerChord: 1,
      currentChordIndex: 0,
    };
    roomState.roomScale = { rootNote: 'C', scale: 'major' };

    await CompanionScheduler.processTick(roomState, 0, namespace, 1_000);

    const payload = (emit.mock.calls as Array<[string, CompanionNoteEventPayload]>)[0]![1];
    const chords = payload.companions.map((c) => c.currentChord);
    expect(new Set(chords).size).toBe(1); // identical chord for all companions
    expect(chords[0]).toBe('C');
  });

  // DEV-202: progressionFlavor is room-global — all companions must resolve the same harmony.
  describe('room-global progressionFlavor (DEV-202)', () => {
    const chordCompanion = (id: string): CompanionConfig => ({
      id,
      instrumentId: 'acoustic_grand_piano',
      role: 'chord',
      style: 'block',
      density: 'normal',
      isPlaying: true,
      isMuted: false,
      volume: DEFAULT_COMPANION_VOLUME_DB,
      chordPlayStyle: 'block',
      chordIntervalBars: 1,
      chordGate: 70,
      chordOctave: 3,
    });

    it('Auto mode: every companion resolves identical current/next chord regardless of count or flavor', async () => {
      const roomState = createRoomState();
      roomState.roomScale = { rootNote: 'C', scale: 'major' };
      roomState.companionChordProgression = DEFAULT_COMPANION_CHORD_PROGRESSION;
      roomState.companionProgressionFlavor = 'borrowed';
      roomState.companions = [chordCompanion('c-1'), chordCompanion('c-2'), chordCompanion('c-3')];
      (roomState as RoomStateWithStartBeat).companionPlayStartBeat = 0;

      for (let beat = 0; beat < 16; beat++) {
        const emit = jest.fn();
        const namespace = { emit } as unknown as Namespace;
        await CompanionScheduler.processTick(roomState, beat, namespace, beat * 500);
        const payload = getEmitPayload(emit, 0);
        const currents = new Set(payload.companions.map((c) => c.currentChord));
        const nexts = new Set(payload.companions.map((c) => c.nextChord));
        expect(currents.size).toBe(1); // no per-companion harmonic clash
        expect(nexts.size).toBe(1);
      }
    });

    it('Manual mode ignores flavor — explicit degrees play as-is (no V7 injection)', async () => {
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const roomState = createRoomState();
      roomState.roomScale = { rootNote: 'C', scale: 'major' };
      roomState.companionProgressionFlavor = 'secondary-dominant';
      roomState.companionChordProgression = {
        mode: 'manual',
        chords: [{ degree: 1, durationBars: 4 }],
        barsPerChord: 4,
        currentChordIndex: 0,
      };
      roomState.companions = [chordCompanion('c-1')];
      (roomState as RoomStateWithStartBeat).companionPlayStartBeat = 0;

      // Beat 2: in Auto+secondary-dominant this is the V7 injection window; manual must NOT inject.
      await CompanionScheduler.processTick(roomState, 2, namespace, 1_000);
      const companion = getEmitPayload(emit, 0).companions[0];
      expect(companion?.currentChord).toBe('C');
      expect(companion?.isSecondaryDominant ?? false).toBe(false);
    });
  });

  describe('drumParts gating', () => {
    it('drops a disabled part from emitted beat notes', async () => {
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const state = makeBeatRoomState({ drumParts: resolveDrumParts({ snare: false }) });
      await CompanionScheduler.processTick(state, 1, namespace, Date.now());
      const notes = lastEmittedCompanionNotes(namespace);
      expect(notes.length).toBeGreaterThan(0); // guard: notes must emit so the negative assertion below is non-vacuous
      expect(notes.some((n) => n.note === 'D2')).toBe(false);
    });

    it('omits crash when the crash part is off on a phrase-head bar', async () => {
      CompanionScheduler.clearGeneratedNoteCache();
      const emit = jest.fn();
      const ns = { emit } as unknown as Namespace;
      const off = makeBeatRoomState({ drumParts: resolveDrumParts({ crash: false }) });
      // phrase-head: effectiveBeat 0 → absoluteBar 0, beatIndexInBar 0
      await CompanionScheduler.processTick(off, 0, ns, Date.now());
      expect(lastEmittedCompanionNotes(ns).some((n) => n.note === 'C#3')).toBe(false);
    });

    it('emitted companion payload (consumed by recording) excludes disabled parts', async () => {
      CompanionScheduler.clearGeneratedNoteCache();
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      // normal style: kick fires at beat 0 (bar downbeat); use beat 0 so guard is non-vacuous
      const state = makeBeatRoomState({ drumParts: resolveDrumParts({ kick: true, snare: false, hat: false, toms: false, crash: false, ride: false, others: false }) });
      await CompanionScheduler.processTick(state, 0, namespace, Date.now());
      const notes = lastEmittedCompanionNotes(namespace);
      expect(notes.length).toBeGreaterThan(0); // guard: recording sees at least one note
      expect(notes.every((n) => n.note === 'C2')).toBe(true); // only kick recorded
    });
  });

  it('up-down arp continues sequence across bar boundaries in 6/8 (no stutter)', async () => {
    // In 6/8, barBeats=3 so arpIntervalBeats=3 (1 bar). With 'up-down' the sequence is
    // [C,E,G,E] (4 steps). 6 eighth notes per bar = 1.5 cycles, so without continuous
    // indexing the arp would restart at C every bar, causing a stutter at bar 3.
    // With continuous indexing: bar 1 = C E G E C E, bar 2 = G E C E G E (continues from step 6).
    const roomState = createRoomState();
    roomState.bpm = 120;
    roomState.timeSignature = { numerator: 6, denominator: 8 };
    roomState.companions = [
      {
        ...roomState.companions[0]!,
        arpRate: '1/8',
        arpDirection: 'up-down',
        arpGate: 100,
      } as CompanionConfig,
    ];

    const noteNamesAtBeat = async (beat: number) => {
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      await CompanionScheduler.processTick(roomState, beat, namespace, beat * 500);
      const payload = emit.mock.calls.length > 0 ? (getEmitPayload(emit, 0)) : undefined;
      return (payload?.companions[0]?.notes ?? []).map(n => n.note);
    };

    // Bar 1: arpStartNoteIndex=0 → notes 0..5 = [C,E,G,E,C,E]
    expect(await noteNamesAtBeat(0)).toEqual(['C3', 'E3']); // cycle 0 pos 0,1
    expect(await noteNamesAtBeat(1)).toEqual(['G3', 'E3']); // cycle 0 pos 2,3
    expect(await noteNamesAtBeat(2)).toEqual(['C3', 'E3']); // cycle 0 pos 4,5
    // Bar 2: arpStartNoteIndex=6 → sequence[(6+i)%4] starts at index 2 → [G,E,C,E,G,E]
    expect(await noteNamesAtBeat(3)).toEqual(['G3', 'E3']); // cycle 1 pos 0,1 — was C,E before fix
    expect(await noteNamesAtBeat(4)).toEqual(['C3', 'E3']); // cycle 1 pos 2,3
    expect(await noteNamesAtBeat(5)).toEqual(['G3', 'E3']); // cycle 1 pos 4,5
  });

  // ─── Scheduler integration tests for metric broken patterns (oom-pah / stride) ───

  describe('metric broken patterns (oom-pah / stride) scheduler integration', () => {
    // Helper: build a minimal chord companion with metric broken pattern settings
    const makeMetricCompanion = (
      pattern: 'oom-pah' | 'stride',
      overrides: Partial<CompanionConfig> = {},
    ): CompanionConfig => ({
      id: `metric-${pattern}`,
      instrumentId: 'acoustic_grand_piano',
      role: 'chord',
      style: 'broken',
      density: 'normal',
      isPlaying: true,
      isMuted: false,
      volume: DEFAULT_COMPANION_VOLUME_DB,
      brokenPattern: pattern,
      arpOctave: 3,
      arpGate: 70,
      brokenBassRoot: true,
      chordIntervalBars: 2, // non-default — the regression window
      ...overrides,
    } satisfies CompanionConfig);

    // Helper: emit ticks for a list of beats on a fresh namespace and return notes per tick
    const notesAtBeats = async (companion: CompanionConfig, beats: number[]): Promise<NoteEvent[][]> => {
      const roomState = createRoomState();
      roomState.companions = [companion];
      (roomState as RoomStateWithStartBeat).companionPlayStartBeat = 0;
      const results: NoteEvent[][] = [];
      for (const beat of beats) {
        CompanionScheduler.clearGeneratedNoteCache();
        const emit = jest.fn();
        const ns = { emit } as unknown as Namespace;
        await CompanionScheduler.processTick(roomState, beat, ns, beat * 500);
        const payload = emit.mock.calls.length > 0 ? (getEmitPayload(emit, 0)) : undefined;
        results.push(payload?.companions[0]?.notes ?? []);
      }
      return results;
    };

    it('FIX-1 regression: oom-pah with chordIntervalBars=2 emits notes across BOTH bars of the interval (not just bar 1)', async () => {
      // In 4/4, barBeats=4 and arpIntervalBeats=8.
      // OLD BUG: filterStartBeat used arpRelativeBeat = relativeBeatInChord % 8.
      //   At beat 0: arpRelativeBeat=0  → window [0,1) → notes at beat 0 ✓
      //   At beat 1: arpRelativeBeat=1  → window [1,2) → notes at beat 1 ✓
      //   At beat 2: arpRelativeBeat=2  → window [2,3) → notes at beat 2 ✓
      //   At beat 3: arpRelativeBeat=3  → window [3,4) → notes at beat 3 ✓
      //   At beat 4: arpRelativeBeat=4  → window [4,5) → metric notes only exist in [0,4) → EMPTY ✗
      //   At beats 5,6,7: arpRelativeBeat=5,6,7 → all empty ✗
      // FIX: filterStartBeat = metricRelativeBeat = relativeBeatInChord % barBeats (=4)
      //   At beat 4: metricRelativeBeat=0 → window [0,1) → notes at beat 0 ✓ (bar repeats)
      //   At beat 5: metricRelativeBeat=1 → window [1,2) → notes at beat 1 ✓
      //   At beat 6: metricRelativeBeat=2 → window [2,3) → notes at beat 2 ✓
      //   At beat 7: metricRelativeBeat=3 → window [3,4) → notes at beat 3 ✓
      const companion = makeMetricCompanion('oom-pah');
      // Beats 0-7 = 2 bars in 4/4 (chordIntervalBars=2 → chord stays C for 8 beats)
      const [b0, b1, b2, b3, b4, b5, b6, b7] = await notesAtBeats(companion, [0, 1, 2, 3, 4, 5, 6, 7]);
      // Bar 1: all 4 beats should have notes
      expect(b0?.length).toBeGreaterThan(0); // beat 0: bass root
      expect(b1?.length).toBeGreaterThan(0); // beat 1: chord stab
      expect(b2?.length).toBeGreaterThan(0); // beat 2: bass root (group 2)
      expect(b3?.length).toBeGreaterThan(0); // beat 3: chord stab
      // Bar 2: must also have notes (this is the regression case — was empty without Fix 1)
      expect(b4?.length).toBeGreaterThan(0); // beat 4: repeats bar pattern at beat 0
      expect(b5?.length).toBeGreaterThan(0); // beat 5: repeats bar pattern at beat 1
      expect(b6?.length).toBeGreaterThan(0); // beat 6: repeats bar pattern at beat 2
      expect(b7?.length).toBeGreaterThan(0); // beat 7: repeats bar pattern at beat 3
    });

    it('FIX-2 regression: metric companion with brokenBassRoot=true does NOT emit two bass notes at the bar head', async () => {
      // OLD BUG: when arpRelativeBeat === 0 AND brokenBassRoot=true, the scheduler injected
      // an extra bass root via generateArpBassRootNote IN ADDITION to the one already emitted
      // by generateMetricPatternNotes (which always places a root at beat 0 for oom-pah).
      // FIX: the injection is guarded with !isMetricBroken.
      const companion = makeMetricCompanion('oom-pah', { brokenBassRoot: true });
      // Beat 0 is the bar head — the only beat where double-bass would appear.
      const [beat0Notes] = await notesAtBeats(companion, [0]);
      const beat0 = beat0Notes ?? [];
      // There should be exactly ONE bass note at beat 0. Bass note = root in lower octave (C2 for octave 3).
      const bassNotes = beat0.filter(n => n.note === 'C2');
      expect(bassNotes).toHaveLength(1); // exactly one, not two
    });

    it('FIX-1 stride variant: stride with chordIntervalBars=2 emits notes in bar 2 (beat 4+)', async () => {
      const companion = makeMetricCompanion('stride');
      const [, , , , b4, b5, b6, b7] = await notesAtBeats(companion, [0, 1, 2, 3, 4, 5, 6, 7]);
      // Bar 2 should not be empty with the fix
      expect(b4?.length).toBeGreaterThan(0);
      expect(b5?.length).toBeGreaterThan(0);
      expect(b6?.length).toBeGreaterThan(0);
      expect(b7?.length).toBeGreaterThan(0);
    });

    it('cyclic continuity: alberti companion continues its note sequence across consecutive ticks', async () => {
      // This test confirms cyclic patterns are UNCHANGED by Fix 1.
      // Alberti in 4/4 at 1/8 rate: generates [root, fifth, third, fifth, ...] cycling.
      // With chordIntervalBars=1, arpIntervalBeats=4. Ticks at beats 0 and 4 start new intervals;
      // ticks within the interval (1, 2, 3) should produce notes from the same generated set.
      const companion: CompanionConfig = {
        id: 'alberti-continuity',
        instrumentId: 'acoustic_grand_piano',
        role: 'chord',
        style: 'broken',
        density: 'normal',
        isPlaying: true,
        isMuted: false,
        volume: DEFAULT_COMPANION_VOLUME_DB,
        brokenPattern: 'alberti',
        arpRate: '1/8',
        arpOctave: 3,
        arpGate: 70,
        chordIntervalBars: 1,
      };
      const roomState = createRoomState();
      roomState.companions = [companion];
      (roomState as RoomStateWithStartBeat).companionPlayStartBeat = 0;

      const getNotesAt = async (beat: number) => {
        const emit = jest.fn();
        const ns = { emit } as unknown as Namespace;
        await CompanionScheduler.processTick(roomState, beat, ns, beat * 500);
        return (emit.mock.calls.length > 0 ? (getEmitPayload(emit, 0)) : undefined)?.companions[0]?.notes ?? [];
      };

      // Beat 0 of bar 1: first alberti step
      const notesBar1Beat0 = await getNotesAt(0);
      // Beat 0 of bar 2 (beat 4): new interval — alberti restarts from note index = completedCycles * notesPerCycle
      const notesBar2Beat0 = await getNotesAt(4);

      // Both should have notes (interval fires at start of each arpIntervalBeats window)
      expect(notesBar1Beat0.length).toBeGreaterThan(0);
      expect(notesBar2Beat0.length).toBeGreaterThan(0);
      // The cyclic path is unchanged: beat 1 of bar 1 continues the sequence (not silent)
      const notesBar1Beat1 = await getNotesAt(1);
      expect(notesBar1Beat1.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DEV-285 convergence guards. The Perform scheduler now delegates note generation
  // to the shared orchestrator, which honors three behaviors the old inline Perform
  // generators did not (owner-accepted convergence). These tests fail if any regresses.
  // They assert observable EMITTED note properties only — never scheduler internals.
  // ─────────────────────────────────────────────────────────────────────────
  describe('shared-orchestrator convergence guards (DEV-285)', () => {
    const blockCompanion = (overrides: Partial<CompanionConfig> = {}): CompanionConfig => ({
      id: 'converge-block',
      instrumentId: 'acoustic_grand_piano',
      role: 'chord',
      style: 'block',
      density: 'normal',
      isPlaying: true,
      isMuted: false,
      volume: DEFAULT_COMPANION_VOLUME_DB,
      chordIntervalBars: 1,
      chordGate: 70,
      chordOctave: 3,
      ...overrides,
    });

    // Drive one tick for a single companion and return its emitted notes. `mutateState`
    // can adjust the room (e.g. time signature) before the tick.
    const notesAt = async (
      companion: CompanionConfig,
      beat: number,
      mutateState?: (s: PerformRoomState) => void,
    ): Promise<NoteEvent[]> => {
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const roomState = createRoomState();
      roomState.companions = [companion];
      (roomState as RoomStateWithStartBeat).companionPlayStartBeat = 0;
      mutateState?.(roomState);
      await CompanionScheduler.processTick(roomState, beat, namespace, beat * 500);
      const mock = emit as jest.Mock;
      return mock.mock.calls.length > 0 ? (getEmitPayload(mock, 0).companions[0]?.notes ?? []) : [];
    };

    it('(a) chordSustain lengthens emitted durationMs AND is keyed in the note cache', async () => {
      // Same companion id, sustain toggled, WITHOUT clearing the cache between the two
      // calls. This guards BOTH converged facts at once:
      //  1. sustain is honored (gate → 100 → longer notes), and
      //  2. the note-cache key includes chordSustain — otherwise the 2nd call would hit
      //     the stale gate-70 cache entry and the two durations would come out equal.
      const off = await notesAt(blockCompanion({ chordSustain: false }), 0);
      const on = await notesAt(blockCompanion({ chordSustain: true }), 0);
      expect(off.length).toBeGreaterThan(0);
      expect(on.length).toBeGreaterThan(0);
      expect(on[0]!.durationMs).toBeGreaterThan(off[0]!.durationMs);
    });

    it('(b) block chord retriggers on the real meter downbeat (3/4 fires beat 3, not beat 4)', async () => {
      const triggerBeats = async (numerator: number): Promise<number[]> => {
        const beats: number[] = [];
        for (const b of [0, 1, 2, 3, 4]) {
          CompanionScheduler.clearGeneratedNoteCache();
          const notes = await notesAt(blockCompanion(), b, (s) => {
            s.timeSignature = { numerator, denominator: 4 };
          });
          if (notes.length > 0) beats.push(b);
        }
        return beats;
      };
      const in34 = await triggerBeats(3);
      const in44 = await triggerBeats(4);
      // Bar-2 downbeat is beat 3 in 3/4 (interval = 3 QN) but beat 4 in 4/4 (interval = 4 QN).
      // A stale 4/4 default would have put the retrigger on beat 4 in both — this asserts
      // the block path honors the real meter.
      expect(in34).toContain(3);
      expect(in34).not.toContain(4);
      expect(in44).toContain(4);
      expect(in44).not.toContain(3);
    });

    it('(c) block chordBassRoot injects one root per interval, sustained for ONE interval (not the whole chord)', async () => {
      const companion = blockCompanion({ chordBassRoot: true });
      // chordIntervalBars = 1 in 4/4 → interval = 4 QN → one interval = 2000ms at 120 bpm.
      const intervalMs = barsToQuarterBeats(1, { numerator: 4, denominator: 4 }) * quarterNoteMs(120);

      // The injected low root is the chord root one octave below the voicing (chordOctave 3 → C2).
      const rootsAt = async (beat: number): Promise<NoteEvent[]> => {
        CompanionScheduler.clearGeneratedNoteCache();
        return (await notesAt(companion, beat)).filter((n) => n.note === 'C2');
      };

      const b0 = await rootsAt(0);
      const b1 = await rootsAt(1);
      const b2 = await rootsAt(2);
      const b3 = await rootsAt(3);
      const b4 = await rootsAt(4);
      // One-per-interval position: exactly one root at each interval head (beats 0 and 4), none between.
      expect(b0).toHaveLength(1);
      expect(b1).toHaveLength(0);
      expect(b2).toHaveLength(0);
      expect(b3).toHaveLength(0);
      expect(b4).toHaveLength(1);

      // Duration = ONE interval, NOT the whole chord duration (the pre-DEV-285 Perform value).
      CompanionScheduler.clearGeneratedNoteCache();
      const emit = jest.fn();
      const namespace = { emit } as unknown as Namespace;
      const roomState = createRoomState();
      roomState.companions = [companion];
      (roomState as RoomStateWithStartBeat).companionPlayStartBeat = 0;
      await CompanionScheduler.processTick(roomState, 0, namespace, 0);
      const chordDurationBeats = getEmitPayload(emit as jest.Mock, 0).companions[0]!.chordDurationBeats;
      expect(b0[0]!.durationMs).toBe(intervalMs);
      expect(b0[0]!.durationMs).not.toBe(chordDurationBeats * quarterNoteMs(120));
    });
  });
});
