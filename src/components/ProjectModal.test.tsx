import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { ProjectModal, projectFileName } from './ProjectModal';
import type { ProjectState } from '../types';

const project: ProjectState = {
  id: 'proj-active',
  title: 'Midnight Drive',
  bpm: 120,
  scaleRoot: 'A',
  scaleType: 'minor',
  synthParams: {} as ProjectState['synthParams'],
  sequencerTracks: [],
  chords: [],
  effects: {} as ProjectState['effects'],
};

describe('projectFileName', () => {
  test('uses the solna brand suffix, not the retired musibox one', () => {
    expect(projectFileName('Midnight Drive')).toBe('Midnight_Drive_solna_project.json');
    expect(projectFileName('Midnight Drive')).not.toContain('musibox');
  });

  test('collapses every run of whitespace into single underscores', () => {
    expect(projectFileName('  Lo   Fi  Chill ')).toBe('_Lo_Fi_Chill__solna_project.json');
  });
});

describe('ProjectModal theming', () => {
  test('renders as a daisyUI modal on semantic tokens', () => {
    const html = renderToString(
      <ProjectModal
        isOpen
        onClose={() => {}}
        project={project}
        onSaveProject={() => {}}
        onLoadTemplate={() => {}}
      />,
    );

    expect(html).toContain('modal modal-open');
    expect(html).toContain('modal-box');
    expect(html).toContain('modal-backdrop');
    expect(html).toContain('modal-action');
    expect(html).toContain('btn btn-sm btn-circle btn-ghost');
    expect(html).toContain('input input-sm input-bordered');
    expect(html).toContain('btn btn-sm btn-primary');
    expect(html).toContain('text-base-content/60');

    expect(html).not.toContain('bg-black/70');
    expect(html).not.toContain('#12152A');
    expect(html).not.toContain('#0B0D19');
    expect(html).not.toContain('#2D355A');
    expect(html).not.toContain('#252B48');
    expect(html).not.toContain('indigo-');
    expect(html).not.toContain('slate-');
    expect(html).not.toContain('emerald-');
    expect(html).not.toContain('purple-');
  });

  test('renders nothing when closed', () => {
    const html = renderToString(
      <ProjectModal
        isOpen={false}
        onClose={() => {}}
        project={project}
        onSaveProject={() => {}}
        onLoadTemplate={() => {}}
      />,
    );
    expect(html).toBe('');
  });
});
