import { describe, expect, test } from 'bun:test';
import { masterPlayTarget } from './transportAction';

describe('masterPlayTarget', () => {
  test('runs the arrangement from the song layer', () => {
    expect(masterPlayTarget('song')).toBe('song');
  });

  test('runs the loop being edited from the loop layer', () => {
    expect(masterPlayTarget('loop')).toBe('loop');
  });
});
