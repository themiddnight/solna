import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { DesktopShell } from './DesktopShell';
import { MobileShell } from './MobileShell';
import { SHELL_PROPS } from './shellPropsFixture';

/** See appChildMemo.test.tsx: dnd-kit numbers its ids from a process-wide counter. */
function normalizeDndIds(html: string): string {
  return html.replace(/DndDescribedBy-\d+/g, 'DndDescribedBy-N');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const read = (path: string) => stripComments(readFileSync(new URL(path, import.meta.url), 'utf8'));

describe('the shells', () => {
  const desktop = renderToString(createElement(DesktopShell, SHELL_PROPS));
  const mobile = renderToString(createElement(MobileShell, SHELL_PROPS));

  test('the desktop shell renders the whole frame', () => {
    for (const marker of [
      '<header class="navbar',
      'id="layer-loop"',
      'id="btn-vibe-',
      '<main class="flex-1 min-h-0 relative overflow-y-auto pb-9">',
      'id="btn-focus-chip"',
      'id="btn-bottom-transport"',
    ]) {
      expect(desktop).toContain(marker);
    }
  });

  // DEV-430 changes no pixel on a phone: the mobile shell is today's frame
  // until DEV-431 diverges it. This equality is that promise; DEV-431 replaces it.
  test('the mobile shell renders exactly the desktop markup (for now)', () => {
    expect(normalizeDndIds(mobile)).toBe(normalizeDndIds(desktop));
  });

  test('no shell mounts the host, a coordinator or an app-level dialog (R316)', () => {
    for (const file of ['./DesktopShell.tsx', './MobileShell.tsx', './LayerPages.tsx']) {
      const src = read(file);
      for (const name of ['PlaybackHost', 'useInputDeck', 'useEngineSync', 'IncidentDialog', 'MidiSettingsModal', 'ProjectNotice']) {
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

  test('the host precedes both shells, and each dialog is mounted once', () => {
    const host = app.indexOf('<PlaybackHost />');
    expect(host).toBeGreaterThan(-1);
    expect(host).toBeLessThan(app.indexOf('<DesktopShell'));
    expect(host).toBeLessThan(app.indexOf('<MobileShell'));
    for (const dialog of ['<IncidentDialog />', '<MidiSettingsModal />', '<ProjectNotice />']) {
      expect(app.split(dialog).length - 1).toBe(1);
    }
  });

  test('the frame is picked by useLayoutMode', () => {
    expect(app).toContain('useLayoutMode()');
  });

  // A switch remounts the on-screen keyboard mid-press; the input deck
  // releases held notes on a mode change, so it must be given the mode.
  test('the input deck receives the layout mode, read before it', () => {
    expect(app).toContain('useInputDeck(mode)');
    expect(app.indexOf('useLayoutMode()')).toBeLessThan(app.indexOf('useInputDeck(mode)'));
  });
});
