import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { createDedupedJsonStorage } from './persistStorage';

function raw() {
  const m = new Map<string, string>();
  let writes = 0;
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { writes++; m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    writes: () => writes,
  };
}

test('an unchanged partialized object is not serialised or written', () => {
  const r = raw();
  let stringified = 0;
  const s = createDedupedJsonStorage<{ a: number[]; b: boolean }>(r, {
    stringify: (v) => { stringified++; return JSON.stringify(v); },
  });
  const a = [1];
  s.setItem('k', { state: { a, b: true }, version: 1 });
  s.setItem('k', { state: { a, b: true }, version: 1 }); // fresh wrapper, same values
  expect(stringified).toBe(1);
  expect(r.writes()).toBe(1);
});

test('a changed reference, a changed key set or a changed version writes', () => {
  const r = raw();
  const s = createDedupedJsonStorage<Record<string, unknown>>(r);
  const a = [1];
  s.setItem('k', { state: { a, b: true }, version: 1 });
  s.setItem('k', { state: { a: [1], b: true }, version: 1 }); // equal content, new reference
  expect(r.writes()).toBe(2);
  const a2 = [2];
  s.setItem('k', { state: { a: a2 }, version: 1 }); // key removed
  expect(r.writes()).toBe(3);
  s.setItem('k', { state: { a: a2, c: undefined }, version: 1 }); // key added, value undefined
  expect(r.writes()).toBe(4);
  s.setItem('k', { state: { a: a2, c: undefined }, version: 2 });
  expect(r.writes()).toBe(5);
});

test('the last write is remembered per name', () => {
  const r = raw();
  const s = createDedupedJsonStorage<{ b: boolean }>(r);
  s.setItem('one', { state: { b: true }, version: 1 });
  s.setItem('two', { state: { b: true }, version: 1 });
  s.setItem('one', { state: { b: true }, version: 1 });
  expect(r.writes()).toBe(2);
});

test('removeItem forgets the last write so the next setItem writes', () => {
  const r = raw();
  const s = createDedupedJsonStorage<{ b: boolean }>(r);
  s.setItem('k', { state: { b: true }, version: 1 });
  s.removeItem('k');
  expect(r.getItem('k')).toBeNull();
  s.setItem('k', { state: { b: true }, version: 1 });
  expect(r.writes()).toBe(2);
  expect(r.getItem('k')).not.toBeNull();
});

test('getItem round-trips what setItem wrote, and reads null for nothing stored', () => {
  const r = raw();
  const s = createDedupedJsonStorage<{ a: number[]; b: boolean }>(r);
  expect(s.getItem('k')).toBeNull();
  s.setItem('k', { state: { a: [1, 2], b: false }, version: 3 });
  expect(s.getItem('k')).toEqual({ state: { a: [1, 2], b: false }, version: 3 });
  expect(r.getItem('k')).toBe(JSON.stringify({ state: { a: [1, 2], b: false }, version: 3 }));
});

test('a write that throws synchronously is not remembered, so the same value is retried', () => {
  const r = raw();
  let fail = true;
  const s = createDedupedJsonStorage<{ a: number }>({
    ...r,
    setItem: (k, v) => {
      if (fail) throw new Error('QuotaExceededError');
      r.setItem(k, v);
    },
  });
  const value = { state: { a: 1 }, version: 1 };
  expect(() => s.setItem('k', value)).toThrow();
  fail = false;
  s.setItem('k', value);
  expect(r.writes()).toBe(1);
});

// store.test.ts probes every writer of a persisted key that exists today;
// this catches a NEW one that mutates an object-valued key in place anywhere
// in src/, which no probe would reach and the dedupe would silently skip.
test('no source file mutates an object-valued persisted key in place', () => {
  const keys = 'customSynthPresets|customChordProgressions|customBeatPresets|drumPadVelocities';
  const mutation = new RegExp(
    `\\b(${keys})(\\.(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\\(|\\[[^\\]]+\\]\\s*=[^=])`,
  );
  const root = join(process.cwd(), 'src');
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
  // Not vacuous: the walk reaches the slices that own these keys.
  expect(files).toContain(join('store', 'presetsSlice.ts'));
  const offenders = files.filter((f) => mutation.test(readFileSync(join(root, f), 'utf8')));
  expect(offenders).toEqual([]);
});
