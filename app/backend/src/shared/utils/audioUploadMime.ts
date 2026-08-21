/**
 * Shared allow-list for multipart upload MIME types (audio + project archives).
 *
 * Single source of truth for the multer `fileFilter` in every upload route, so the
 * two route configs (routes/projects.ts, routes/index.ts) cannot drift apart — the
 * original cause of the save-upload HTTP 415 regression (commit 4f1ab79): the
 * whitelist omitted the containers browsers actually record (audio/webm, audio/mp4)
 * and matched the full mimetype exactly, so MediaRecorder's `;codecs=` suffix
 * (e.g. `audio/webm;codecs=opus`) failed even for listed types.
 */

/**
 * Reduce a raw upload mimetype to its bare type for comparison.
 * Strips MediaRecorder's `;codecs=...` parameter, trims, and lowercases.
 * e.g. `audio/webm;codecs=opus` -> `audio/webm`, `AUDIO/MP4` -> `audio/mp4`.
 */
export function normalizeUploadMime(mimetype: string): string {
  return (mimetype.split(';')[0] ?? '').trim().toLowerCase();
}

/**
 * Audio containers a browser's MediaRecorder can produce, plus common imports:
 * - audio/webm — Chrome, Edge, Android, Firefox (Opus)
 * - audio/ogg, audio/opus — Firefox alternative
 * - audio/mp4, audio/aac — Safari / iOS (AAC)
 * - audio/mpeg — MP3 imports
 * - audio/wav, audio/x-wav — uncompressed PCM
 */
export const AUDIO_UPLOAD_MIMES = [
  'audio/webm',
  'audio/ogg',
  'audio/opus',
  'audio/mp4',
  'audio/aac',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
] as const;

/** Project file archives (.collab zip). */
export const ARCHIVE_UPLOAD_MIMES = [
  'application/zip',
  'application/x-zip-compressed',
] as const;

/**
 * True if `mimetype` (raw, possibly with a `;codecs=` param) is in `allowed`.
 */
export function isAllowedUploadMime(mimetype: string, allowed: readonly string[]): boolean {
  return allowed.includes(normalizeUploadMime(mimetype));
}
