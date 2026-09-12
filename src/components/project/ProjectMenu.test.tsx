import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { useAppStore } from '@/store/store';
import {
  PROJECT_MENU_ACTIONS,
  ProjectMenu,
  REPLACE_CONFIRM_MESSAGE,
  REPLACING_ACTIONS,
  replacesProject,
  visibleMenuActions,
} from './ProjectMenu';

describe('ProjectMenu', () => {
  test('offers Open, Open from Drive, Save, Save As, Export, New and Disconnect, in that order', () => {
    expect(PROJECT_MENU_ACTIONS.map((a) => a.action)).toEqual([
      'open',
      'open-drive',
      'save',
      'save-as',
      'export',
      'new',
      'disconnect-drive',
    ]);
  });

  test('only Open, Open from Drive and New replace the project', () => {
    expect(REPLACING_ACTIONS).toEqual(['open', 'open-drive', 'new']);
    expect(replacesProject('save')).toBe(false);
    expect(replacesProject('save-as')).toBe(false);
    expect(replacesProject('export')).toBe(false);
    expect(replacesProject('disconnect-drive')).toBe(false);
  });

  // Every row renders into `id={`project-menu-${action}`}`, and two rows both
  // starting with "open" is exactly how a duplicated id would arrive.
  test('no two rows share an element id', () => {
    const ids = PROJECT_MENU_ACTIONS.map((a) => `project-menu-${a.action}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the Drive rows appear only when they can work', () => {
    const actions = (available: boolean, signedIn: boolean) =>
      visibleMenuActions(available, signedIn).map((a) => a.action);
    // No client id: no Drive row at all. A row that opens a modal whose only
    // button can never succeed is worse than an absent one.
    expect(actions(false, false)).toEqual(['open', 'save', 'save-as', 'export', 'new']);
    // Configured but signed out: Open from Drive is offered (the modal is where
    // connecting happens), Disconnect is not — there is nothing to disconnect.
    expect(actions(true, false)).toEqual(['open', 'open-drive', 'save', 'save-as', 'export', 'new']);
    expect(actions(true, true)).toContain('disconnect-drive');
  });

  test('renders a Save and a Save as row with stable ids', () => {
    // The test deployment has no client id, so `driveAvailable` is false at
    // store creation and the Drive rows would be absent. useLiveStore serves
    // getState() for both snapshots, so setting it here does reach the render.
    useAppStore.setState({ driveAvailable: true });
    const html = renderToString(<ProjectMenu textClassName="hidden sm:inline" />);
    expect(html).toContain('id="project-menu-save"');
    expect(html).toContain('id="project-menu-save-as"');
    expect(html).toContain('Open from Drive');
    useAppStore.setState({ driveAvailable: false });
  });

  test('the confirm copy says plainly that the project is replaced', () => {
    expect(REPLACE_CONFIRM_MESSAGE).toBe(
      'This replaces your current project. It is autosaved, so the one you are editing now will be gone.',
    );
  });

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
