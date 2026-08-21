import { EncryptionService, encryptionService } from '../EncryptionService';

// Flip one hex character (0 <-> 1) at `index`, keeping the segment valid hex
// so the AES-256-GCM authentication step is what rejects the tamper.
const flipHexChar = (hex: string, index: number): string => {
  const ch = hex[index];
  const replacement = ch === '0' ? '1' : '0';
  return hex.slice(0, index) + replacement + hex.slice(index + 1);
};

describe('EncryptionService', () => {
  const service = new EncryptionService('test-secret-for-unit-tests-0123456789');
  const PLAINTEXT = 'murva round-trip: คีย์บอร์ด🎹 + emoji 🎵 + "quotes" & <tags>';

  describe('encrypt/decrypt round-trip', () => {
    it('returns the original plaintext for a non-trivial string', () => {
      const ciphertext = service.encrypt(PLAINTEXT);
      expect(service.decrypt(ciphertext)).toBe(PLAINTEXT);
    });

    it('produces different outputs for the same plaintext (random IV)', () => {
      expect(service.encrypt(PLAINTEXT)).not.toBe(service.encrypt(PLAINTEXT));
    });
  });

  describe('tamper detection (AES-GCM auth)', () => {
    const ciphertext = service.encrypt(PLAINTEXT);
    // noUncheckedIndexedAccess: encrypt always emits exactly 3 non-empty segments
    const parts = ciphertext.split(':');
    const [iv, tag, payload] = [parts[0] as string, parts[1] as string, parts[2] as string];

    it('throws when a ciphertext payload byte is flipped', () => {
      const tampered = `${iv}:${tag}:${flipHexChar(payload, 0)}`;
      expect(() => service.decrypt(tampered)).toThrow(
        'Unsupported state or unable to authenticate data'
      );
    });

    it('throws when the auth tag is tampered', () => {
      const tampered = `${iv}:${flipHexChar(tag, 0)}:${payload}`;
      expect(() => service.decrypt(tampered)).toThrow(
        'Unsupported state or unable to authenticate data'
      );
    });

    it('throws when the IV segment is tampered', () => {
      const tampered = `${flipHexChar(iv, 0)}:${tag}:${payload}`;
      expect(() => service.decrypt(tampered)).toThrow(
        'Unsupported state or unable to authenticate data'
      );
    });
  });

  describe('malformed format handling', () => {
    it('throws the format error for a single-segment value', () => {
      expect(() => service.decrypt('justonestring')).toThrow('Invalid encrypted text format');
    });

    it('throws the format error for an empty string', () => {
      expect(() => service.decrypt('')).toThrow('Invalid encrypted text format');
    });

    it('throws the format error for a two-segment value', () => {
      expect(() => service.decrypt('abc:def')).toThrow('Invalid encrypted text format');
    });

    it('throws on non-hex segments', () => {
      // Existing behavior note: the service's own guard only checks segment
      // count/emptiness — Buffer.from(hex) silently drops invalid hex chars,
      // so the rejection comes from crypto.createDecipheriv itself
      // (Error "Invalid initialization vector"). Documented, not fixed.
      expect(() => service.decrypt('zz:zz:zz')).toThrow();
    });

    it('throws the format error for three empty segments', () => {
      // '::'.split(':') yields 3 segments — the count guard passes, but every
      // segment is empty, so the emptiness guard rejects it.
      expect(() => service.decrypt('::')).toThrow('Invalid encrypted text format');
    });
  });

  describe('singleton instance', () => {
    it('exposes one shared encryptionService instance (two resolves return the same object)', async () => {
      const first = await import('../EncryptionService');
      const second = await import('../EncryptionService');
      expect(second.encryptionService).toBe(first.encryptionService);
      // instanceof against the dynamically imported class: jest's resetModules
      // gives the dynamic import its own registry generation, so the class
      // identity differs from the top-level static import.
      expect(first.encryptionService).toBeInstanceOf(first.EncryptionService);
    });

    it('the shared instance round-trips with the configured secret', () => {
      expect(encryptionService.decrypt(encryptionService.encrypt('singleton probe'))).toBe(
        'singleton probe'
      );
    });
  });
});
