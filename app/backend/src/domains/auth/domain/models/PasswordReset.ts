/**
 * Password Reset Domain Model
 */

export interface PasswordReset {
  id: string;
  userId: string;
  token: string;
  otpCodeHash: string | null;
  otpExpiresAt: Date | null;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
  usedAt: Date | null;
}

export class PasswordResetModel {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly token: string,
    public readonly otpCodeHash: string | null,
    public readonly otpExpiresAt: Date | null,
    public readonly attempts: number,
    public readonly expiresAt: Date,
    public readonly createdAt: Date,
    public usedAt: Date | null
  ) {}

  static fromPrisma(data: PasswordReset): PasswordResetModel {
    return new PasswordResetModel(
      data.id,
      data.userId,
      data.token,
      data.otpCodeHash,
      data.otpExpiresAt,
      data.attempts,
      data.expiresAt,
      data.createdAt,
      data.usedAt
    );
  }

  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  isUsed(): boolean {
    return this.usedAt !== null;
  }

  isValid(): boolean {
    return !this.isExpired() && !this.isUsed();
  }

  markAsUsed(): void {
    this.usedAt = new Date();
  }

  isOtpExpired(): boolean {
    return this.otpExpiresAt === null || new Date() > this.otpExpiresAt;
  }

  hasExceededOtpAttempts(): boolean {
    return this.attempts >= 5;
  }
}
