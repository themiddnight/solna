import { Resend } from 'resend';
import { loggingService } from '../../../../shared/infrastructure/logging/LoggingService';
import { config } from '../../../../config/environment';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export class EmailService {
  private readonly resend: Resend | null = null;
  private readonly fromAddress: string;

  constructor() {
    const resendApiKey = process.env.RESEND_API_KEY;
    this.fromAddress =
      config.email.fromAddress !== '' ? config.email.fromAddress : 'murva <noreply@themiddnight.dev>';

    if (resendApiKey) {
      this.resend = new Resend(resendApiKey);
    }
  }

  async sendVerificationEmail(email: string, code: string): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Verify Your Email</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #4a90e2;">Verify Your Email Address</h1>
            <p>Thank you for registering with murva!</p>
            <p>Enter the code below in the app to verify your email address:</p>
            <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; text-align: center; color: #4a90e2;">${code}</p>
            <p style="font-size: 12px; color: #999; text-align: center;">This code expires in 10 minutes.</p>
            <p style="margin-top: 30px; font-size: 12px; color: #999;">
              If you didn't create an account, you can safely ignore this email.
            </p>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: 'Verify Your Email - murva',
      html,
    });
  }

  async sendPasswordResetEmail(email: string, token: string, code: string): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Reset Your Password</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #4a90e2;">Reset Your Password</h1>
            <p>You requested to reset your password for COLLAB.</p>
            <p>Click the button below to reset your password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}"
                 style="background-color: #4a90e2; color: white; padding: 12px 24px;
                        text-decoration: none; border-radius: 5px; display: inline-block;">
                Reset Password
              </a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #666;">${resetUrl}</p>
            <p style="margin-top: 30px;">Or, if you're still in the app, enter this code instead:</p>
            <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; text-align: center; color: #4a90e2;">${code}</p>
            <p style="font-size: 12px; color: #999; text-align: center;">This code expires in 10 minutes.</p>
            <p style="margin-top: 30px; font-size: 12px; color: #999;">
              The link above will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
            </p>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: 'Reset Your Password - COLLAB',
      html,
    });
  }

  async sendBandInvitationEmail(
    email: string,
    bandName: string,
    inviteUrl: string,
    inviterName: string
  ): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Band Invitation</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #4a90e2;">🎸 You're Invited to Join a Band!</h1>
            <p><strong>${inviterName}</strong> has invited you to join <strong>${bandName}</strong> on COLLAB.</p>
            <p>Click the button below to join:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${inviteUrl}" 
                 style="background-color: #4a90e2; color: white; padding: 12px 24px; 
                        text-decoration: none; border-radius: 5px; display: inline-block;">
                Join Band
              </a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #666;">${inviteUrl}</p>
            <p style="margin-top: 30px; font-size: 12px; color: #999;">
              If you didn't expect this invitation, you can safely ignore this email.
            </p>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to: email,
      subject: `You're invited to join ${bandName} - COLLAB`,
      html,
    });
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    if (!this.resend) {
      loggingService.logWarn('Email service not isConfigured; email not sent', {
        to: options.to,
        subject: options.subject,
      });
      return;
    }

    await this.sendWithRetry(options);
  }

  /**
   * Send email with retry logic for transient failures.
   * Uses exponential backoff: 1s → 2s → 4s between retries.
   */
  private async sendWithRetry(options: EmailOptions, maxRetries = 3): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.resend!.emails.send({
          from: this.fromAddress,
          to: options.to,
          subject: options.subject,
          html: options.html,
        });
        return;
      } catch (error) {
        if (attempt === maxRetries) {
          loggingService.logError(
            error instanceof Error ? error : new Error(String(error)),
            { context: 'EmailService.sendWithRetry', attempts: maxRetries }
          );
          throw new Error('Failed to send email after retries');
        }
        const delayMs = 1000 * Math.pow(2, attempt - 1);
        loggingService.logWarn('Email send hasFailed, retrying', {
          attempt,
          maxRetries,
          delayMs,
          to: options.to,
        });
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
}

export const emailService = new EmailService();
