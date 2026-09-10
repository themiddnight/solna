import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ProjectMenu, PROJECT_MENU_ACTIONS, REPLACE_CONFIRM_MESSAGE } from './ProjectMenu';

describe('ProjectMenu', () => {
  test('offers exactly Open, Export and New, in that order', () => {
    expect(PROJECT_MENU_ACTIONS.map((a) => a.action)).toEqual(['open', 'export', 'new']);
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
