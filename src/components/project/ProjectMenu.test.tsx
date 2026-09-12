import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { useAppStore } from '@/store/store';
import {
  PROJECT_MENU_SECTIONS,
  ProjectMenu,
  REPLACE_CONFIRM_MESSAGE,
  REPLACING_ACTIONS,
  driveAccountLabel,
  replaceConfirmMessage,
  replacesProject,
  saveLabel,
  visibleMenuSections,
} from './ProjectMenu';

const allActions = () => PROJECT_MENU_SECTIONS.flatMap((section) => section.rows.map((row) => row.action));

/** The actions a user actually sees, given availability, sign-in and source. */
const visibleActions = (available: boolean, signedIn: boolean, sourceKind: 'drive' | 'local' | 'untitled') =>
  visibleMenuSections(available, signedIn, sourceKind, null).flatMap((s) => s.rows.map((r) => r.action));

describe('ProjectMenu menu composition', () => {
  test('orders the menu as New, then Local, then Drive', () => {
    expect(PROJECT_MENU_SECTIONS.map((s) => s.heading)).toEqual([null, 'Local', 'Drive']);
    expect(allActions()).toEqual([
      'new',
      'open',
      'save',
      'save-as',
      'open-drive',
      'save-as-drive',
      'disconnect-drive',
    ]);
  });

  test('only Open, Open from Drive and New replace the project', () => {
    expect(REPLACING_ACTIONS).toEqual(['open', 'open-drive', 'new']);
    expect(replacesProject('save')).toBe(false);
    expect(replacesProject('save-as')).toBe(false);
    expect(replacesProject('save-as-drive')).toBe(false);
    expect(replacesProject('disconnect-drive')).toBe(false);
  });

  test('Save names Drive only for a Drive-bound file', () => {
    expect(saveLabel('drive')).toBe('Save to Drive');
    expect(saveLabel('local')).toBe('Save');
    expect(saveLabel('untitled')).toBe('Save');
  });

  test('the Drive account label prefers the email, then the name', () => {
    expect(driveAccountLabel(null)).toBeNull();
    expect(driveAccountLabel({ email: 'ann@example.com', name: 'Ann' })).toBe('ann@example.com');
    expect(driveAccountLabel({ email: '', name: 'Ann' })).toBe('Ann');
    expect(driveAccountLabel({ email: '', name: '' })).toBeNull();
  });

  // Every row renders into `id={`project-menu-${action}`}`, and two rows both
  // starting with "open" is exactly how a duplicated id would arrive.
  test('no two rows share an element id', () => {
    const ids = allActions().map((a) => `project-menu-${a}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the Drive rows appear only when they can work, and the section vanishes otherwise', () => {
    // No client id: no Drive section at all — not a disabled one.
    expect(visibleActions(false, false, 'untitled')).toEqual(['new', 'open', 'save', 'save-as']);
    // Configured but signed out: Open from Drive and Save as to Drive are offered
    // (the modal is where connecting happens), Disconnect is not.
    expect(visibleActions(true, false, 'untitled')).toEqual([
      'new',
      'open',
      'save',
      'save-as',
      'open-drive',
      'save-as-drive',
    ]);
    expect(visibleActions(true, true, 'untitled')).toContain('disconnect-drive');
  });

  test('a Drive-bound file keeps its Save inside the Drive section', () => {
    expect(visibleActions(true, true, 'drive')).toEqual([
      'new',
      'open',
      'save-as',
      'open-drive',
      'save',
      'save-as-drive',
      'disconnect-drive',
    ]);
  });

  test('renders Save actions without the removed Export action', () => {
    // The test deployment has no client id, so `driveAvailable` is false at
    // store creation and the Drive rows would be absent. useLiveStore serves
    // getState() for both snapshots, so setting it here does reach the render.
    useAppStore.setState({ driveAvailable: true });
    const html = renderToString(<ProjectMenu textClassName="hidden sm:inline" />);
    expect(html).toContain('id="project-menu-save"');
    expect(html).toContain('id="project-menu-save-as"');
    expect(html).not.toContain('id="project-menu-export"');
    expect(html).not.toContain('Export .solna');
    expect(html).toContain('Open from Drive');
    useAppStore.setState({ driveAvailable: false });
  });

  test('renders "Save to Drive" when the project came from Drive', () => {
    useAppStore.setState({ driveAvailable: true, projectSource: { kind: 'drive', fileId: 'f1' } });
    const html = renderToString(<ProjectMenu textClassName="hidden sm:inline" />);
    expect(html).toContain('Save to Drive');
    expect(html).toContain('id="project-menu-save-as-drive"');
    useAppStore.setState({ driveAvailable: false, projectSource: { kind: 'untitled' } });
  });

  test('renders the account under the Drive heading on its own line', () => {
    useAppStore.setState({ driveAvailable: true, driveUser: { email: 'ann@example.com', name: 'Ann' } });
    const html = renderToString(<ProjectMenu textClassName="hidden sm:inline" />);
    expect(html).toContain('ann@example.com');
    expect(html).toContain('block truncate');
    useAppStore.setState({ driveAvailable: false, driveUser: null });
  });

  test('the confirm copy says plainly that the project is replaced', () => {
    expect(REPLACE_CONFIRM_MESSAGE).toBe(
      'This replaces your current project. It is autosaved, so the one you are editing now will be gone.',
    );
  });

  test('the replace confirmation warns that an active export will be cancelled', () => {
    expect(replaceConfirmMessage(true)).toBe(
      `${REPLACE_CONFIRM_MESSAGE} The export in progress will be cancelled.`,
    );
    expect(replaceConfirmMessage(false)).toBe(REPLACE_CONFIRM_MESSAGE);
  });
});

describe('ProjectMenu rendering', () => {
  // The menu is behind a dropdown that opens on focus, which renderToString
  // never triggers — so the closed state is what is pinned here: the trigger is
  // a labelled button and the file input is present but hidden.
  test('renders a labelled dropdown trigger and a hidden file picker', () => {
    const html = renderToString(<ProjectMenu textClassName="hidden sm:inline" />);
    expect(html).toContain('dropdown');
    expect(html).toContain('aria-label="Project menu"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".solna,.json"');
    expect(html).toContain('hidden sm:inline');
  });
});
