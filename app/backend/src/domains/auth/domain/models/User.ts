/**
 * Auth User Domain Model
 * 
 * Represents an authenticated user in the system with email, password, and OAuth accounts.
 */

import { UserType } from '@jam-band/shared';
export { UserType };

export interface AuthUser {
  id: string;
  email: string | null;
  username: string | null;
  passwordHash: string | null;
  emailVerified: boolean;
  userType: UserType;
  profilePictureUrl: string | null;
  onboardingTourPromptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class AuthUserModel {
  constructor(
    public readonly id: string,
    public email: string | null,
    public username: string | null,
    public passwordHash: string | null,
    public emailVerified: boolean,
    public userType: UserType,
    public profilePictureUrl: string | null,
    public onboardingTourPromptedAt: Date | null,
    public readonly createdAt: Date,
    public updatedAt: Date
  ) { }

  static fromPrisma(data: AuthUser): AuthUserModel {
    return new AuthUserModel(
      data.id,
      data.email,
      data.username,
      data.passwordHash,
      data.emailVerified,
      data.userType as UserType,
      data.profilePictureUrl ?? null,
      data.onboardingTourPromptedAt ?? null,
      data.createdAt,
      data.updatedAt
    );
  }

  isRegistered(): boolean {
    return this.userType === UserType.REGISTERED;
  }

  isPremium(): boolean {
    return this.userType === UserType.ARTIST || this.userType === UserType.PRO;
  }
}
