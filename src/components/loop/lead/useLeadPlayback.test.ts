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
      join(process.cwd(), 'src/components/loop/lead/useLeadPlayback.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/^const HARD_STOP_RELEASE/m);
    expect(source).toContain('HARD_STOP_RELEASE');
  });
});
