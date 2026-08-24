// Ambient typings for `bun:test`.
// Tests run with Bun's built-in test runner, and the bass-module plan forbids
// adding new dependencies (no @types/bun installed), so tsc needs this shim to
// resolve the `bun:test` import in test files. Only the API surface used by the
// test suite is declared. If @types/bun is ever installed, delete this file.
declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;

  export interface Mock<T extends (...args: never[]) => unknown> {
    mock: {
      calls: unknown[][];
    };
    mockClear(): Mock<T>;
    mockImplementation(fn: (...args: Parameters<T>) => ReturnType<T>): Mock<T>;
    mockRestore(): void;
  }

  export function spyOn<O extends object, M extends (...args: never[]) => unknown>(
    obj: O,
    method: keyof O & string
  ): Mock<M>;

  export interface Matchers<T = unknown> {
    not: Matchers<T>;
    toEqual(expected: unknown): void;
    toBe(expected: unknown): void;
    toContain(expected: unknown): void;
    toBeCloseTo(expected: number, numDigits?: number): void;
    toHaveLength(length: number): void;
    toBeTruthy(): void;
    toBeNull(): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toHaveProperty(key: string): void;
    toHaveBeenCalled(): void;
    toHaveBeenCalledTimes(expected: number): void;
    toHaveBeenCalledWith(...expected: unknown[]): void;
    toHaveBeenLastCalledWith(...expected: unknown[]): void;
  }

  export function expect<T>(actual: T, message?: string): Matchers<T>;
}
