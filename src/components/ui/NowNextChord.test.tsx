import { describe, expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import { NowNextChord } from './NowNextChord';

describe('NowNextChord', () => {
  test('shows the sounding chord and the one after it', () => {
    const html = renderToString(<NowNextChord now="Cmaj7" next="Am7" />);
    expect(html).toContain('Cmaj7');
    expect(html).toContain('Am7');
  });

  test('the sounding chord carries the emphasis, the next one recedes', () => {
    const html = renderToString(<NowNextChord now="Cmaj7" next="Am7" />);
    expect(html).toContain('text-module-chord');
    expect(html).toContain('text-base-content/50');
  });

  test('a lone chord renders without a next slot', () => {
    const html = renderToString(<NowNextChord now="Cmaj7" next={null} />);
    expect(html).toContain('Cmaj7');
    expect(html).not.toContain('text-base-content/50');
  });

  test('renders nothing when the progression is empty', () => {
    expect(renderToString(<NowNextChord now={null} next={null} />)).toBe('');
  });

  test('stays on semantic tokens', () => {
    expect(renderToString(<NowNextChord now="Cmaj7" next="Am7" />)).not.toContain('#');
  });
});
