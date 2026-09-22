import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { PlaybackHost } from './PlaybackHost';

const ROOT = process.cwd();
const HOST_FILE = 'src/components/playback/PlaybackHost.tsx';

/**
 * The host's controller calls, in clock-listener order (spec §5.3): every
 * controller subscribes inside an effect, so hook order inside the host is
 * the order its listeners register on Play.
 */
const HOST_CALLS = [
  "useLeadPlayback('lead')",
  "useLeadStepPublisher('lead')",
  "useLeadPlayback('fx')",
  "useLeadStepPublisher('fx')",
  'useChordClockPlayback()',
  'useSequencerPlayback()',
] as const;

/** Every transport controller: each is called in the host and nowhere else. */
const CONTROLLERS = [
  'useLeadPlayback',
  'useLeadStepPublisher',
  'useChordClockPlayback',
  'useSequencerPlayback',
] as const;

/** Docblocks name the controllers; only code may count. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Files (repo-relative) calling `name(`, with the call count; declarations excluded. */
function callSites(name: string): Array<{ file: string; count: number }> {
  const call = new RegExp(String.raw`(?<!function )\b${name}\s*\(`, 'g');
  return sourceFiles(join(ROOT, 'src'))
    .map((path) => ({
      file: relative(ROOT, path),
      count: (stripComments(readFileSync(path, 'utf8')).match(call) ?? []).length,
    }))
    .filter((site) => site.count > 0);
}

describe('PlaybackHost', () => {
  test('renders nothing and runs every controller body with no grid in the tree', () => {
    expect(renderToString(createElement(PlaybackHost))).toBe('');
  });

  test('calls its controllers in clock-listener order', () => {
    const host = stripComments(readFileSync(join(ROOT, HOST_FILE), 'utf8'));
    const positions = HOST_CALLS.map((call) => host.indexOf(call));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  for (const name of CONTROLLERS) {
    test(`${name} is called only by the host (no view re-mounts it)`, () => {
      const expected = HOST_CALLS.filter((call) => call.startsWith(`${name}(`)).length;
      expect(callSites(name)).toEqual([{ file: HOST_FILE, count: expected }]);
    });
  }
});

describe('the arp controller', () => {
  // Not a transport controller: it follows held keys, so it stays mounted by
  // the input deck (spec §5.4) — and only there.
  test('useArpPlayback is called only by useInputDeck', () => {
    expect(callSites('useArpPlayback')).toEqual([{ file: 'src/components/useInputDeck.ts', count: 1 }]);
  });
});
