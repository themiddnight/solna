// Ambient typings for `bun:test`.
// Tests run with Bun's built-in test runner, and the bass-module plan forbids
// adding new dependencies (no @types/bun installed), so tsc needs this shim to
// resolve the `bun:test` import in test files. Only the API surface used by the
// test suite is declared. If @types/bun is ever installed, delete this file.
declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void): void;

  export interface Matchers<T = unknown> {
    not: Matchers<T>;
    toEqual(expected: unknown): void;
    toBe(expected: unknown): void;
    toContain(expected: unknown): void;
    toBeCloseTo(expected: number, numDigits?: number): void;
    toHaveLength(length: number): void;
    toBeTruthy(): void;
  }

  export function expect<T>(actual: T): Matchers<T>;
}
