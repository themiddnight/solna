/**
 * sanitizeFilename — boundary defense for DEV-182 (LocalStorageAdapter's resolveKey
 * is the second, universal backstop). Documents the existing contract: basename
 * only, conservative charset, leading dots stripped, underscore collapse, and a
 * non-empty guarantee.
 */
import { sanitizeFilename } from '../sanitizeFilename';

describe('sanitizeFilename', () => {
  describe('path-traversal / directory components', () => {
    it("reduces '../../etc/passwd' to the basename only", () => {
      expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    });

    it('drops any leading directory walk', () => {
      expect(sanitizeFilename('traversal/../../x.txt')).toBe('x.txt');
    });

    it('neutralizes backslash separators', () => {
      expect(sanitizeFilename('foo\\bar.txt')).toBe('foo_bar.txt');
    });
  });

  describe('leading dots', () => {
    it("strips the leading dot from '.env'", () => {
      expect(sanitizeFilename('.env')).toBe('env');
    });

    it("strips the leading dots from '..env'", () => {
      expect(sanitizeFilename('..env')).toBe('env');
    });

    it("strips the leading dot from '.gitignore'", () => {
      expect(sanitizeFilename('.gitignore')).toBe('gitignore');
    });

    it("reduces '..' to the non-empty fallback", () => {
      expect(sanitizeFilename('..')).toBe('file');
    });
  });

  describe('non-empty guarantee', () => {
    it("reduces '...' to 'file'", () => {
      expect(sanitizeFilename('...')).toBe('file');
    });

    it("reduces the empty string to 'file'", () => {
      expect(sanitizeFilename('')).toBe('file');
    });

    it('never returns an empty string for any input', () => {
      const inputs = ['..', '...', '', '🎹🎵🎶', '///', '   ', '._..'];
      for (const input of inputs) {
        expect(sanitizeFilename(input).length).toBeGreaterThan(0);
      }
    });
  });

  describe('unicode / emoji', () => {
    it('replaces unicode letters with underscores', () => {
      expect(sanitizeFilename('café.txt')).toBe('caf_.txt');
    });

    it('replaces emoji with underscores', () => {
      expect(sanitizeFilename('solo🎹.wav')).toBe('solo_.wav');
    });

    it('collapses a pure-emoji input to a single underscore (fallback is only for empty/dot-only input)', () => {
      expect(sanitizeFilename('🎹🎹')).toBe('_');
    });
  });

  describe('double-underscore collapse', () => {
    it("collapses 'a  b.txt' to 'a_b.txt'", () => {
      expect(sanitizeFilename('a  b.txt')).toBe('a_b.txt');
    });

    it("collapses 'a b  c.txt' to 'a_b_c.txt'", () => {
      expect(sanitizeFilename('a b  c.txt')).toBe('a_b_c.txt');
    });

    it("collapses existing 'a_b__c' to 'a_b_c'", () => {
      expect(sanitizeFilename('a_b__c')).toBe('a_b_c');
    });

    it('replaces spaces with single underscores', () => {
      expect(sanitizeFilename('file name.txt')).toBe('file_name.txt');
    });
  });

  describe('conservative charset', () => {
    it('keeps letters, digits, dots, underscores and dashes', () => {
      expect(sanitizeFilename('Track_01-master.v2.wav')).toBe('Track_01-master.v2.wav');
    });
  });
});
