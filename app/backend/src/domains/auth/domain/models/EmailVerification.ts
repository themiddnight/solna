/**
 * Email Verification Domain Model
 */

export interface EmailVerification {
  id: string;
  userId: string;
  token: string;
  otpCodeHash: string | null;
  otpExpiresAt: Date | null;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

export class EmailVerificationModel {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly token: string,
    public readonly otpCodeHash: string | null,
    public readonly otpExpiresAt: Date | null,
    public readonly attempts: number,
    public readonly expiresAt: Date,
    public readonly createdAt: Date
  ) {}

  static fromPrisma(data: EmailVerification): EmailVerificationModel {
    return new EmailVerificationModel(
      data.id,
      data.userId,
      data.token,
      data.otpCodeHash,
      data.otpExpiresAt,
      data.attempts,
      data.expiresAt,
      data.createdAt
    );
  }

  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  isValid(): boolean {
    return !this.isExpired();
  }

  // OTP expiry is independent of the link's expiresAt (DEV-207 spec: 10-minute window,
  // deliberately shorter than the 24h link so a brute-forceable code doesn't stay usable as long).
  isOtpExpired(): boolean {
    return this.otpExpiresAt === null || new Date() > this.otpExpiresAt;
  }

  hasExceededOtpAttempts(): boolean {
    return this.attempts >= 5;
  }
}
