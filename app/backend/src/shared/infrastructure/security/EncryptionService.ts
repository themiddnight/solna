import crypto from 'crypto';
import { config } from "../../../config/environment";

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
// Key length for AES-256 is 32 bytes
const KEY_LENGTH = 32;

export class EncryptionService {
  private readonly secretKey: Buffer;

  constructor(secret: string) {
    // Derive a 32-byte key from the secret string using scrypt
    // This ensures we always have a valid 32-byte key regardless of input length
    // 'salt' is fixed here because we want determinism for the key derivation from the secret env var.
    // The security comes from the strength of the secret env var + random IV per encryption.
    this.secretKey = crypto.scryptSync(secret, 'jam-band-salt', KEY_LENGTH);
  }

  /**
   * Encrypt text using AES-256-GCM
   * Returns format: iv:authTag:encryptedContent
   */
  encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.secretKey, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    // Return IV:TAG:ENCRYPTED
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt text
   * Expects format: iv:authTag:encryptedContent
   */
  decrypt(text: string): string {
    const parts = text.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted text format');
    }
    
    const ivHex = parts[0];
    const tagHex = parts[1];
    const encryptedHex = parts[2];
    
    if (!ivHex || !tagHex || !encryptedHex) {
      throw new Error('Invalid encrypted text format');
    }
    
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, this.secretKey, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

// Singleton instance
export const encryptionService = new EncryptionService(config.jwt.encryptionSecret);
