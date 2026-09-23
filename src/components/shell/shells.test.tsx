import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DesktopShell } from './DesktopShell';
import { MobileShell } from './MobileShell';
import { SHELL_PROPS } from './shellPropsFixture';

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const read = (path: string) => stripComments(readFileSync(new URL(path, import.meta.url), 'utf8'));

/**
 * Renders both shells with every `React.lazy` in the frame already resolved.
 *
 * `renderToString` cannot wait for a lazy: an unresolved one renders a
 * client-render fallback `<template>` whose dev component stack names the
 * enclosing shell, so the two shells' markup differs only because of that.
 * Whether a lazy is resolved depends on whether an earlier test in the same
 * process rendered it, which made the parity check pass in the full suite and
 * fail alone. A throwaway render starts every lazy load; awaiting the same
 * modules and one macrotask lets each lazy settle, so both runs compare the
 * resolved frame.
 */
async function renderResolvedShells(): Promise<{ desktop: string; mobile: string }> {
  renderToString(createElement(DesktopShell, SHELL_PROPS));
  await Promise.all([
    import('../loop/SynthPresetLibrary'),
    import('../loop/ChordPresetLibrary'),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    desktop: renderToString(createElement(DesktopShell, SHELL_PROPS)),
    mobile: renderToString(createElement(MobileShell, SHELL_PROPS)),
  };
}

describe('the shells', () => {
  let desktop = '';
  let mobile = '';
  beforeAll(async () => {
    ({ desktop, mobile } = await renderResolvedShells());
  });

  test('every lazy in the frame is resolved before the shells are compared', () => {
    for (const html of [desktop, mobile]) {
      expect(html).not.toContain('<template data-msg');
    }
  });

  test('the desktop shell renders the whole frame', () => {
    for (const marker of [
      '<header class="navbar',
      '<nav aria-label="Views" class="flex',
      'id="btn-vibe-',
      'id="btn-vibes"',
      // LoopPage's SoundView and SongPage's EffectsRackView: only reachable
      // through <LayerPages />, so these fail if it is ever removed.
      'id="btn-solo-target"',
      'id="slider-reverb-wet"',
      'id="btn-focus-chip"',
      'id="btn-bottom-transport"',
    ]) {
      expect(desktop).toContain(marker);
    }
  });

  test('only the mobile frame asks for the one-row transport and its sheet (R332)', () => {
    expect(desktop).not.toContain('id="btn-transport-sheet"');
    expect(desktop).not.toContain('id="sheet-transport"');
    expect(mobile).toContain('id="btn-transport-sheet"');
    expect(mobile).toContain('id="sheet-transport"');
  });

  test('the mobile shell renders the same feature children (R014 level 1)', () => {
    for (const marker of [
      // LoopPage's SoundView and SongPage's EffectsRackView: only reachable
      // through <LayerPages />, so these fail if it is ever removed.
      'id="btn-solo-target"',
      'id="slider-reverb-wet"',
      'id="btn-vibe-',
      'id="btn-focus-chip"',
      'id="btn-bottom-transport"',
    ]) {
      expect(mobile).toContain(marker);
    }
  });

  test('each frame carries exactly one feedback host (R330)', () => {
    for (const html of [desktop, mobile]) {
      expect(html.split('id="feedback-host"').length - 1).toBe(1);
    }
  });

  test('the desktop host hangs above the dock, the mobile host under the top bar', () => {
    expect(desktop).toContain('bottom-10 flex-col ');
    expect(mobile).toContain('top-2 flex-col-reverse ');
    // Under the top bar: before the vibe bar, the first thing ShellBody renders.
    expect(mobile.indexOf('id="feedback-host"')).toBeLessThan(mobile.indexOf('id="btn-vibe-'));
    // Above the dock: after the pages, before the dock's focus chip.
    expect(desktop.indexOf('id="feedback-host"')).toBeGreaterThan(desktop.indexOf('id="slider-reverb-wet"'));
    expect(desktop.indexOf('id="feedback-host"')).toBeLessThan(desktop.indexOf('id="btn-focus-chip"'));
  });

  test('the desktop frame carries none of the mobile chrome', () => {
    for (const marker of ['class="dock', 'id="btn-mobile-menu"', 'modal-bottom']) {
      expect(desktop).not.toContain(marker);
    }
  });

  test('no shell mounts the host, a coordinator or an app-level dialog (R316)', () => {
    for (const file of [
      './DesktopShell.tsx', './MobileShell.tsx', './ShellBody.tsx', './LayerPages.tsx', './MobileTabBar.tsx',
      './MobileTopBar.tsx', './useMobileTopBar.ts',
    ]) {
      const src = read(file);
      for (const name of ['PlaybackHost', 'useInputDeck', 'useEngineSync', 'IncidentDialog', 'MidiSettingsModal']) {
        expect(src).not.toContain(name);
      }
    }
  });
});

describe('Workspace keeps what survives a layout switch', () => {
  const app = read('../../App.tsx');

  test('it renders no frame component itself', () => {
    for (const frame of ['<Header', '<InstantVibesBar', '<LoopPage', '<SongPage', '<BottomInputDock', '<UpdateBanner', '<TransportBar']) {
      expect(app).not.toContain(frame);
    }
  });

  test('the host precedes the shell, and each dialog is mounted once', () => {
    const host = app.indexOf('<PlaybackHost />');
    expect(host).toBeGreaterThan(-1);
    expect(host).toBeLessThan(app.indexOf('<Shell'));
    for (const dialog of ['<IncidentDialog />', '<MidiSettingsModal />']) {
      expect(app.split(dialog).length - 1).toBe(1);
    }
  });

  test('the frame is picked by useLayoutMode', () => {
    expect(app).toContain('useLayoutMode()');
    expect(app).toContain("mode === 'desktop' ? DesktopShell : MobileShell");
  });

  // A switch remounts the on-screen keyboard mid-press; the input deck
  // releases held notes on a mode change, so it must be given the mode.
  test('the input deck receives the layout mode, read before it', () => {
    expect(app).toContain('useInputDeck(mode)');
    expect(app.indexOf('useLayoutMode()')).toBeLessThan(app.indexOf('useInputDeck(mode)'));
  });
});
