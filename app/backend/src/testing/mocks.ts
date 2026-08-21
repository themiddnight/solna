import type { Socket } from 'socket.io';

/**
 * Typed partial-mock helpers for unit tests (TR-27 compliant).
 *
 * Allows building a `jest.Mocked<T>` from only the members a test actually
 * uses, without `any` or `as unknown as` casts. The single `as` assertion is
 * safe because `Partial<jest.Mocked<T>>` structurally overlaps `jest.Mocked<T>`;
 * tests are responsible for stubbing every member the code under test calls.
 */
export function createPartialMock<T extends object>(
  partial: Partial<jest.Mocked<T>>
): jest.Mocked<T> {
  return partial as jest.Mocked<T>;
}

/**
 * Structural upgrade for socket mocks (house convention, see
 * `.claude/skills/test/SKILL.md`): socket.io's `Socket` is a huge generic
 * interface, so tests mock only the members the code under test touches
 * (id/emit/on/disconnect/...). The one unavoidable boundary cast lives here —
 * test files call `asSocket(fakeSocket())` without casting themselves.
 */
export function asSocket<T extends object>(socket: T): Socket {
  return socket as unknown as Socket;
}
