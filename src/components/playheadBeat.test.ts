import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createPlayheadBeatPublisher, playheadBeat, usePlayheadBeat } from './playheadBeat';

describe('playhead beat publisher', () => {
  test('notifies on change only', () => {
    const p = createPlayheadBeatPublisher();
    const seen: Array<number | null> = [];
    const off = p.subscribe((b) => seen.push(b));
    p.set(0); p.set(0); p.set(1); p.set(null);
    off(); p.set(2);
    expect(seen).toEqual([0, 1, null]);
    expect(p.get()).toBe(2);
  });

  test('usePlayheadBeat renders the live value under renderToString', () => {
    playheadBeat.set(7);
    const Probe = () => createElement('span', null, String(usePlayheadBeat()));
    expect(renderToString(createElement(Probe))).toContain('7');
    playheadBeat.set(null);
  });

  test('the store no longer carries the playhead beat', () => {
    const types = readFileSync(new URL('../store/types.ts', import.meta.url), 'utf8');
    expect(types).not.toMatch(/\bplayheadBeat\b|setPlayheadBeat/);
  });
});
