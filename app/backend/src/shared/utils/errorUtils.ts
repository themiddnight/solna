/**
 * Shared error utility functions
 */

import { config } from '../../config/environment';

/**
 * Error detail safe to return to a client. In production this is `undefined` so internal /
 * Prisma error messages never leak (DEV-192); outside production it returns the real message
 * to aid debugging. Pair with a generic top-level message and log the full error server-side.
 */
export function clientErrorDetail(error: unknown): string | undefined {
  if (config.nodeEnv === 'production') {
    return undefined;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Check if an error is a recoverable connection error
 * (e.g., ECONNRESET, ECONNREFUSED, ETIMEDOUT, EPIPE, ENOTFOUND)
 */
export function isRecoverableConnectionError(error: Error | unknown): boolean {
  if (!(error instanceof Error)) return false;
  const errorCode = (error as NodeJS.ErrnoException).code;
  const recoverableCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'];
  return recoverableCodes.includes(errorCode || '');
}
