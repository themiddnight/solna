import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leadStepAction, type LeadArming } from './useLeadPlayback';

describe('leadStepAction', () => {
  test('a stopped player is idle and never arms', () => {
    const arming: LeadArming = { armed: false };
    expect(leadStepAction('stopped', 0, arming, 16)).toBe('idle');
    expect(arming.armed).toBe(false);
  });

  test('arms on the first bar line, plays while armed', () => {
    const arming: LeadArming = { armed: false };
    expect(leadStepAction('playing', 5, arming, 16)).toBe('idle');
    expect(leadStepAction('playing', 16, arming, 16)).toBe('play');
    expect(leadStepAction('playing', 17, arming, 16)).toBe('play');
  });

  test('a soft stop keeps playing to the bar line, then stops there', () => {
    const arming: LeadArming = { armed: true };
    expect(leadStepAction('stopping', 20, arming, 16)).toBe('play');
    expect(leadStepAction('stopping', 32, arming, 16)).toBe('soft-stop');
  });
});

describe('useLeadPlayback shares the one HARD_STOP_RELEASE', () => {
  test('declares no local copy and still uses the shared constant', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/playback/useLeadPlayback.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/^const HARD_STOP_RELEASE/m);
    expect(source).toContain('HARD_STOP_RELEASE');
  });
});

describe('useLeadPlayback feeds the loop gate and the sounding notes into the scheduler', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/playback/useLeadPlayback.ts'),
    'utf8',
  );

  test('reads the gate (and every other planned field) live per tick, via a fresh snapshot built inside the clock callback', () => {
    // The gate no longer has a literal `s[track.gate]` read in this file —
    // melodyPlanSnapshot owns that now (see playbackPlanSnapshots.ts, pinned
    // by its own test). What this file must still guarantee is that the state
    // feeding that snapshot is read FRESH every dispatch, inside the clock
    // callback, rather than closed over from mount time — otherwise a gate
    // (or steps, or arp) edit mid-loop would not reach the next hit.
    expect(source).toMatch(
      /subscribePlaybackClock\(\(step, _beat, time\) => \{\s*const s = useAppStore\.getState\(\);[\s\S]*melodyPlanSnapshot\(s, trackId\)/,
    );
  });

  test('passes the raw, unstrided steps matrix into the snapshot — no pre-striding before the planner sees it', () => {
    // The hook hands the raw store state and trackId straight to
    // melodyPlanSnapshot, which reads `s[track.steps]` untouched (see
    // playbackPlanSnapshots.ts) — no `.filter`/`.map`/stride reduction runs on
    // the matrix here first. `strideFor` (and the old direct call to
    // leadSoundingNotes) reappearing in this file would mean the hook started
    // striding the matrix again before the planner ever saw it.
    expect(source).toContain('melodyPlanSnapshot(s, trackId)');
    expect(source).not.toContain('strideFor');
    expect(source).not.toContain('leadSoundingNotes(');
    expect(source).not.toContain('leadStepNotes');
  });
});
