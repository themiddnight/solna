/**
 * Regression guard for the project-save HTTP 415 (commit 4f1ab79 → fix 6e9df4e).
 *
 * The multer upload whitelist must accept the containers browsers actually record
 * (audio/webm from Chrome/Android/Firefox, audio/mp4 from Safari/iOS) and must
 * compare against the bare type so MediaRecorder's `;codecs=` suffix does not break
 * the match. These tests lock that behavior at the shared helper every upload route
 * imports, and prove it survives a real multipart round-trip through multer.
 */
import request from 'supertest';
import type { ErrorRequestHandler, Request, Response } from 'express';
import express from 'express';
import multer from 'multer';
import {
  normalizeUploadMime,
  isAllowedUploadMime,
  AUDIO_UPLOAD_MIMES,
  ARCHIVE_UPLOAD_MIMES,
} from '../audioUploadMime';

describe('audioUploadMime', () => {
  describe('normalizeUploadMime', () => {
    it("strips MediaRecorder's ;codecs= parameter", () => {
      expect(normalizeUploadMime('audio/webm;codecs=opus')).toBe('audio/webm');
      expect(normalizeUploadMime('audio/mp4;codecs=mp4a.40.2')).toBe('audio/mp4');
      expect(normalizeUploadMime('audio/ogg; codecs=opus')).toBe('audio/ogg');
    });

    it('lowercases and trims', () => {
      expect(normalizeUploadMime('AUDIO/WEBM')).toBe('audio/webm');
      expect(normalizeUploadMime('  audio/wav  ')).toBe('audio/wav');
    });

    it('handles a bare type unchanged', () => {
      expect(normalizeUploadMime('audio/mpeg')).toBe('audio/mpeg');
    });
  });

  describe('isAllowedUploadMime', () => {
    const allowed = [...AUDIO_UPLOAD_MIMES, ...ARCHIVE_UPLOAD_MIMES];

    // The exact regression cases: the omitted containers + the ;codecs= suffix.
    it.each([
      'audio/webm', // Chrome/Edge/Android/Firefox — was missing from the whitelist
      'audio/webm;codecs=opus', // real MediaRecorder value — exact-match used to fail this
      'audio/mp4', // Safari/iOS — was missing from the whitelist
      'audio/mp4;codecs=mp4a.40.2',
      'audio/ogg;codecs=opus',
      'audio/opus',
      'audio/aac',
      'audio/mpeg',
      'audio/wav',
      'audio/x-wav',
      'application/zip',
      'AUDIO/WEBM', // case-insensitive
    ])('accepts %s', (mime) => {
      expect(isAllowedUploadMime(mime, allowed)).toBe(true);
    });

    it.each([
      'application/x-msdownload',
      'text/html',
      'video/mp4',
      'image/png',
      '',
    ])('rejects %s', (mime) => {
      expect(isAllowedUploadMime(mime, allowed)).toBe(false);
    });

    it('respects the caller-provided allow-list (json only on the general route)', () => {
      expect(isAllowedUploadMime('application/json', allowed)).toBe(false);
      expect(isAllowedUploadMime('application/json', [...allowed, 'application/json'])).toBe(true);
    });
  });

  // Proves the helper survives a real multipart upload: multer surfaces the part's
  // Content-Type (incl. the `;codecs=` param) as file.mimetype, and the same wiring
  // the routes use maps a rejected file to HTTP 415 (per the global error handler).
  describe('multer round-trip', () => {
    const upload = multer({
      storage: multer.memoryStorage(),
      fileFilter: (_req, file, cb) => {
        const allowed = [...AUDIO_UPLOAD_MIMES, ...ARCHIVE_UPLOAD_MIMES];
        if (isAllowedUploadMime(file.mimetype, allowed)) {
          cb(null, true);
        } else {
          cb(new Error(`Invalid file type: ${file.mimetype}`));
        }
      },
    });

    // Mirrors the 415 mapping in bootstrap/httpLayer.ts global error handler.
    const errorHandler: ErrorRequestHandler = (err: Error, _req, res, _next) => {
      if (err.message.includes('Invalid file type')) {
        res.status(415).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err.message });
    };

    const app = express();
    app.post('/upload', upload.single('audioFiles'), (req: Request, res: Response) => {
      res.status(200).json({ mimetype: req.file?.mimetype });
    });
    app.use(errorHandler);

    it('accepts a real audio/webm;codecs=opus part (the file that hit 415)', async () => {
      const res = await request(app)
        .post('/upload')
        .attach('audioFiles', Buffer.from('fake-opus'), {
          filename: 'region.webm',
          contentType: 'audio/webm;codecs=opus',
        });
      expect(res.status).toBe(200);
      // busboy delivers the bare type as file.mimetype; the missing `audio/webm`
      // whitelist entry — not the codecs param — is what produced the 415.
      const resBody = res.body as { mimetype: string };
      expect(normalizeUploadMime(resBody.mimetype)).toBe('audio/webm');
    });

    it('accepts a Safari audio/mp4 part', async () => {
      const res = await request(app)
        .post('/upload')
        .attach('audioFiles', Buffer.from('fake-aac'), {
          filename: 'region.mp4',
          contentType: 'audio/mp4',
        });
      expect(res.status).toBe(200);
    });

    it('rejects a disallowed type with 415, not 200', async () => {
      const res = await request(app)
        .post('/upload')
        .attach('audioFiles', Buffer.from('MZ'), {
          filename: 'evil.exe',
          contentType: 'application/x-msdownload',
        });
      expect(res.status).toBe(415);
    });
  });
});
