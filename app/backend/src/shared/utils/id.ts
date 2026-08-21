/**
 * Shared ID generation utilities
 *
 * Uses Node's crypto.randomUUID() (RFC 4122 v4) for collision-resistant IDs.
 * A semantic prefix is preserved for log/debug readability (e.g. `room_<uuid>`).
 */
import { randomUUID } from 'node:crypto';

/**
 * Generate a prefixed UUID, e.g. generateId('room') => 'room_<uuid-v4>'.
 */
export const generateId = (prefix: string): string => `${prefix}_${randomUUID()}`;
