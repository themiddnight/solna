import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import {
  DriveBrowserList,
  DriveFileBrowserModal,
  browserTitle,
  shouldRenderList,
  type DriveFileBrowserModalProps,
} from './DriveFileBrowserModal';
import { DRIVE_EMPTY_STATE, DRIVE_LOADING_TEXT, toBrowserRows, sortBrowserRows } from '@/utils/driveBrowser';
import { SOLNA_DRIVE_MIME, type DriveFileMeta } from '@/store/driveClient';

const meta = (id: string, name: string, modifiedTime: string, mimeType = SOLNA_DRIVE_MIME): DriveFileMeta => ({
  id,
  name,
  modifiedTime,
  mimeType,
});

const props = (overrides: Partial<DriveFileBrowserModalProps> = {}): DriveFileBrowserModalProps => ({
  open: true,
  mode: 'open',
  signedIn: true,
  initialName: 'Sketch',
  onClose: () => {},
  onConnect: () => {},
  onList: async () => ({ ok: true, page: { files: [] } }),
  onOpenFile: () => {},
  onSaveAs: () => {},
  ...overrides,
});

describe('browserTitle', () => {
  test('names the two modes differently', () => {
    expect(browserTitle('open')).toBe('Open from Google Drive');
    expect(browserTitle('save-as')).toBe('Save to Google Drive');
  });
});

describe('shouldRenderList', () => {
  test('hides the empty state when the first list errored, keeps rows after a load-more error', () => {
    // A failed FIRST list is an error, not an empty Drive — the "no projects"
    // sentence must not appear over it.
    expect(shouldRenderList(false, 'Google Drive did not respond.', 0)).toBe(false);
    // A genuine empty list still shows the empty state.
    expect(shouldRenderList(false, null, 0)).toBe(true);
    // Rows render normally.
    expect(shouldRenderList(false, null, 3)).toBe(true);
    // A later page failing keeps the rows already on screen.
    expect(shouldRenderList(false, 'boom', 3)).toBe(true);
    // Nothing renders while the first page is still loading.
    expect(shouldRenderList(true, null, 0)).toBe(false);
  });
});

describe('DriveBrowserList', () => {
  const rows = sortBrowserRows(
    toBrowserRows([
      meta('f1', 'older.solna', '2026-09-01T00:00:00.000Z'),
      meta('f2', 'newer.solna', '2026-09-05T00:00:00.000Z'),
    ]),
  );

  test('renders a row per project, newest first', () => {
    const html = renderToString(<DriveBrowserList rows={rows} onOpen={() => {}} />);
    expect(html).toContain('newer.solna');
    expect(html.indexOf('newer.solna')).toBeLessThan(html.indexOf('older.solna'));
  });

  test('shows each row a date, and the empty state when there are none', () => {
    expect(renderToString(<DriveBrowserList rows={rows} onOpen={() => {}} />)).toContain('2026-09-05');
    const empty = renderToString(<DriveBrowserList rows={[]} onOpen={() => {}} />);
    expect(empty).toContain(DRIVE_EMPTY_STATE);
    // The hint is part of the empty state, not a separate feature: without it an
    // empty list looks like a bug to a user who can see their own .solna in Drive.
    expect(empty).toContain('download it and use Open .solna');
  });
});

describe('DriveFileBrowserModal', () => {
  test('signed out: offers to connect and lists nothing', () => {
    const html = renderToString(<DriveFileBrowserModal {...props({ signedIn: false })} />);
    expect(html).toContain('Connect Google Drive');
    expect(html).not.toContain(DRIVE_EMPTY_STATE);
  });

  test('signed in: shows the loading line before the first page lands', () => {
    // renderToString runs no effects, so this is the component's INITIAL state.
    // It is also why `loading` starts true: an unfetched empty list must not
    // render as "you have no projects".
    const html = renderToString(<DriveFileBrowserModal {...props()} />);
    expect(html).toContain(DRIVE_LOADING_TEXT);
    expect(html).not.toContain(DRIVE_EMPTY_STATE);
    expect(html).not.toContain('Connect Google Drive');
  });

  test('open mode has no file-name field; save-as mode does, seeded from the project', () => {
    const open = renderToString(<DriveFileBrowserModal {...props({ mode: 'open' })} />);
    expect(open).not.toContain('File name');
    const saveAs = renderToString(<DriveFileBrowserModal {...props({ mode: 'save-as' })} />);
    expect(saveAs).toContain('File name');
    expect(saveAs).toContain('value="Sketch"');
    expect(saveAs).toContain('Save to Drive');
  });

  // NOT "a closed modal renders nothing": the shared Modal always renders its
  // children inside a <dialog class="modal"> and only the `open` ATTRIBUTE is
  // toggled, by an effect that renderToString never runs. Asserting the shared
  // chrome is therefore the honest test of the closed case — see
  // src/components/ui/Modal.test.tsx, which pins the same class string.
  test('a closed modal still renders the shared box chrome, without modal-open', () => {
    const html = renderToString(<DriveFileBrowserModal {...props({ open: false })} />);
    expect(html).toContain('class="modal"');
    expect(html).toContain('modal-box bg-base-100 border border-base-300 shadow-2xl max-w-2xl space-y-3');
    expect(html).not.toContain('modal-open');
  });
});
