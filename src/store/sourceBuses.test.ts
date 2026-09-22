import { expect, test } from 'bun:test';
import type { TrackSends } from '@/types';
import type { SourceBusId } from './sourceBuses';

test('TrackSends is keyed by exactly the SOURCE_BUSES engine source ids (compile-time)', () => {
  // `bun run lint` (tsc) fails an assignment below if the two key sets drift.
  const noExtraKey: [Exclude<keyof TrackSends, SourceBusId>] extends [never] ? true : false = true;
  const noMissingKey: [Exclude<SourceBusId, keyof TrackSends>] extends [never] ? true : false = true;
  expect([noExtraKey, noMissingKey]).toEqual([true, true]);
});
