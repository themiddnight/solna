import { ProjectVersionMismatchError } from '../ProjectVersionMismatchError';

describe('ProjectVersionMismatchError', () => {
  it('is an Error subclass with a message naming the found version', () => {
    const err = new ProjectVersionMismatchError('1.0.0');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/1\.0\.0/);
    expect(err.name).toBe('ProjectVersionMismatchError');
  });
});
