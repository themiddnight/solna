import { describe, expect, test } from 'bun:test';
import {
  migrateProjectTitleToVibeId,
  migrateTrackColors,
  migrateMeterAndStepWidth,
  LEGACY_TRACK_COLOR_MAP,
} from './migrate';
import { MAX_STEPS_PER_BAR } from '../utils/meter';

describe('migrateProjectTitleToVibeId', () => {
  test('drops the legacy projectTitle and seeds a null selectedVibeId', () => {
    const migrated = migrateProjectTitleToVibeId({
      projectTitle: 'Neon Highway 1984',
      bpm: 118,
    } as never) as { projectTitle?: string; selectedVibeId: string | null; bpm: number };

    expect('projectTitle' in migrated).toBe(false);
    expect(migrated.selectedVibeId).toBe(null);
    expect(migrated.bpm).toBe(118);
  });

  test('keeps an already-migrated selectedVibeId, including an explicit null', () => {
    const withId = migrateProjectTitleToVibeId({
      selectedVibeId: 'lofi-chill',
    } as never) as { selectedVibeId: string | null };
    expect(withId.selectedVibeId).toBe('lofi-chill');

    const withNull = migrateProjectTitleToVibeId({
      selectedVibeId: null,
    } as never) as { selectedVibeId: string | null };
    expect(withNull.selectedVibeId).toBe(null);
  });

  test('does not mutate the payload it was given', () => {
    const input = { projectTitle: 'Cosmic Floating' };
    migrateProjectTitleToVibeId(input as never);
    expect(input).toEqual({ projectTitle: 'Cosmic Floating' });
  });
});

describe('migrateTrackColors', () => {
  test('rewrites every legacy palette track colour to a semantic token', () => {
    const migrated = migrateTrackColors({
      sequencerTracks: [
        { id: 'track-kick', color: 'bg-rose-500' },
        { id: 'track-snare', color: 'bg-amber-500' },
        { id: 'track-hihat', color: 'bg-emerald-500' },
        { id: 'track-openhat', color: 'bg-cyan-500' },
        { id: 'track-clap', color: 'bg-purple-500' },
      ],
    } as never) as { sequencerTracks: { color: string }[] };

    expect(migrated.sequencerTracks.map((t) => t.color)).toEqual([
      'bg-error',
      'bg-warning',
      'bg-success',
      'bg-accent',
      'bg-secondary',
    ]);
  });

  test('leaves an already-migrated colour alone', () => {
    const migrated = migrateTrackColors({
      sequencerTracks: [{ id: 'track-kick', color: 'bg-error' }],
    } as never) as { sequencerTracks: { color: string }[] };
    expect(migrated.sequencerTracks[0].color).toBe('bg-error');
  });

  test('is a no-op when sequencerTracks is missing or not an array', () => {
    expect(migrateTrackColors({} as never)).toEqual({} as never);
    expect(
      migrateTrackColors({ sequencerTracks: 'nope' } as never)
    ).toEqual({ sequencerTracks: 'nope' } as never);
  });

  test('the map covers exactly the five legacy colours', () => {
    expect(Object.keys(LEGACY_TRACK_COLOR_MAP).sort()).toEqual([
      'bg-amber-500',
      'bg-cyan-500',
      'bg-emerald-500',
      'bg-purple-500',
      'bg-rose-500',
    ]);
  });

  test('preserves every other field, including steps, through the remap', () => {
    const steps = [true, false, true, false];
    const migrated = migrateTrackColors({
      sequencerTracks: [
        { id: 'track-kick', name: 'Kick 808', color: 'bg-rose-500', steps, muted: false },
      ],
    } as never) as { sequencerTracks: { id: string; name: string; color: string; steps: boolean[]; muted: boolean }[] };

    expect(migrated.sequencerTracks[0]).toEqual({
      id: 'track-kick',
      name: 'Kick 808',
      color: 'bg-error',
      steps,
      muted: false,
    });
  });

  test('leaves an inherited-property-name colour like "constructor" alone rather than mangling it', () => {
    const migrated = migrateTrackColors({
      sequencerTracks: [{ id: 'track-kick', color: 'constructor' }],
    } as never) as { sequencerTracks: { color: unknown }[] };
    expect(migrated.sequencerTracks[0].color).toBe('constructor');

    const toStringCase = migrateTrackColors({
      sequencerTracks: [{ id: 'track-kick', color: 'toString' }],
    } as never) as { sequencerTracks: { color: unknown }[] };
    expect(toStringCase.sequencerTracks[0].color).toBe('toString');
  });
});

describe('migrateMeterAndStepWidth (v4 -> v5)', () => {
  test('defaults meterId to 4/4 when the payload predates meter support', () => {
    const out = migrateMeterAndStepWidth({ bpm: 96 }) as { meterId: string; bpm: number };
    expect(out.meterId).toBe('4/4');
    expect(out.bpm).toBe(96);
  });

  test('keeps an already-valid meterId', () => {
    const out = migrateMeterAndStepWidth({ meterId: '6/8' }) as { meterId: string };
    expect(out.meterId).toBe('6/8');
  });

  test('replaces an unknown meterId rather than letting it reach the clock', () => {
    const out = migrateMeterAndStepWidth({ meterId: '9/8' }) as { meterId: string };
    expect(out.meterId).toBe('4/4');
    const nonString = migrateMeterAndStepWidth({ meterId: 16 }) as unknown as { meterId: string };
    expect(nonString.meterId).toBe('4/4');
  });

  test('pads every 16-length track steps array to MAX_STEPS_PER_BAR with false', () => {
    const sixteen = [
      true, false, false, false, true, false, false, false,
      true, false, false, false, true, false, false, false,
    ];
    const out = migrateMeterAndStepWidth({
      sequencerTracks: [{ id: 'track-kick', instrument: 'kick', steps: sixteen }],
    }) as { sequencerTracks: Array<{ steps: boolean[] }> };

    expect(MAX_STEPS_PER_BAR).toBe(24);
    expect(out.sequencerTracks[0].steps.length).toBe(24);
    expect(out.sequencerTracks[0].steps.slice(0, 16)).toEqual(sixteen);
    expect(out.sequencerTracks[0].steps.slice(16).every((v) => v === false)).toBe(true);
  });

  test('leaves an already-24-wide payload byte-identical', () => {
    const wide = Array.from({ length: 24 }, (_, i) => i % 5 === 0);
    const out = migrateMeterAndStepWidth({
      sequencerTracks: [{ id: 'track-kick', steps: wide }],
    }) as { sequencerTracks: Array<{ steps: boolean[] }> };
    expect(out.sequencerTracks[0].steps).toEqual(wide);
  });

  test('survives a corrupt tracks payload without throwing', () => {
    expect(() => migrateMeterAndStepWidth({ sequencerTracks: 'nope' })).not.toThrow();
    expect(() => migrateMeterAndStepWidth({ sequencerTracks: [null, 7, { steps: 'x' }] })).not.toThrow();
    const out = migrateMeterAndStepWidth({
      sequencerTracks: [null, { id: 'a', steps: [true] }],
    }) as { sequencerTracks: unknown[] };
    expect(out.sequencerTracks[0]).toBe(null);
    expect((out.sequencerTracks[1] as { steps: boolean[] }).steps.length).toBe(24);
  });

  test('does not mutate the payload it was given', () => {
    const input = { sequencerTracks: [{ id: 'a', steps: [true, false] }] };
    migrateMeterAndStepWidth(input);
    expect(input.sequencerTracks[0].steps.length).toBe(2);
    expect('meterId' in input).toBe(false);
  });
});
