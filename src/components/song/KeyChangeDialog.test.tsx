import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { createDefaultLoop } from '@/store/loopSlice';
import { KeyChangeDialog } from './KeyChangeDialog';

const loops = [
  { ...createDefaultLoop(), name: 'Verse' },
  { ...createDefaultLoop(), id: 'loop-b', name: 'Chorus', scaleRoot: 'C', scaleType: 'Major' },
];
const html = renderToString(
  <KeyChangeDialog loops={loops} activeLoopId={loops[0].id} onApply={() => {}} onClose={() => {}} />,
);

describe('KeyChangeDialog', () => {
  test('mode is a joined pair of radio buttons', () => {
    expect(html).toContain('class="join');
    expect(html).toContain('join-item btn btn-sm');
    expect(html).toContain('aria-label="Set key"');
    expect(html).toContain('aria-label="Transpose"');
  });

  test('harmonize chords is a checkbox, on by default', () => {
    expect(html).toContain('id="chk-key-change-harmonize"');
    expect(html).toContain('checkbox checkbox-sm checkbox-primary');
  });

  test('one ticked checkbox per loop with an old → new preview', () => {
    expect(html).toContain('id="chk-key-change-loop-loop-default-1"');
    expect(html).toContain('id="chk-key-change-loop-loop-b"');
    expect(html).toContain('Verse');
    expect(html).toContain('Chorus');
    expect(html).toContain('fieldset-legend');
  });

  test('Apply and Cancel actions', () => {
    expect(html).toContain('id="btn-key-change-apply"');
    expect(html).toContain('id="btn-key-change-cancel"');
  });
});
