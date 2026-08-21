/**
 * Task 27 (BE test-coverage slices) — BackblazeStorageAdapter semantics backstop.
 *
 * Pattern: `aws-sdk-client-mock` intercepts `send` on the REAL S3Client class
 * (prototype-level), so the adapter's own logic — including its privately
 * constructed S3Client — runs against a mocked SDK boundary. Error fixtures use
 * the real `S3ServiceException` shape (name + `$metadata.httpStatusCode`) exactly
 * as @aws-sdk/client-s3 throws them.
 *
 * Contract documented here (existing behavior — GREEN by design):
 * - getFile:        NoSuchKey / HTTP 404 → null ("missing"); any other error → throw.
 * - fileExists:     404 → false, exists → true; ANY other error → false (the
 *                   "does it exist?" answer fails open to "not there"; nothing
 *                   destructive is gated on fileExists, so this is accepted).
 * - listFiles / listFileVersions: ANY error → [] — Pattern-1 territory
 *                   (docs/FAILURE_PATTERNS.md): a storage error is semantically
 *                   indistinguishable from "no files" for the avatar-cleanup
 *                   caller (ProfilePictureService.deleteUserProfilePictures).
 *                   Deliberate today: an outage looks like "nothing to clean",
 *                   files stay in place (leak, never data loss). If this ever
 *                   feeds a deletion guard, revisit — the caller must not see
 *                   [] on error.
 * - Endpoint:       scheme-less endpoints get https:// prefixed; explicit
 *                   http:// endpoints are upgraded to https:// (credentials
 *                   must never travel over cleartext); https:// endpoints pass
 *                   through untouched. Asserted via the constructor's logInfo
 *                   side effect — the S3Client instance is private and the
 *                   endpoint lives in client config, not in command inputs.
 * - Constructor:    throws on incomplete config (endpoint/region, credentials,
 *                   bucketName) — this is what drives the LocalStorageAdapter
 *                   fallback in ProfilePictureService / ProjectStorageService.
 */
import { Readable } from 'node:stream';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { mockClient } from 'aws-sdk-client-mock';
import type { Config } from '../../../../config/environment';
import { loggingService } from '../../logging/LoggingService';
import { BackblazeStorageAdapter } from '../BackblazeStorageAdapter';

const s3Mock = mockClient(S3Client);

const completeConfig: Config['storage']['bucketStorage'] = {
  enabled: true,
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
  bucketName: 'test-bucket',
  endpoint: 's3.us-west-004.backblazeb2.com',
  region: 'us-west-004',
  publicUrl: undefined,
};

const makeConfig = (
  overrides: Partial<Config['storage']['bucketStorage']>,
): Config['storage']['bucketStorage'] => ({ ...completeConfig, ...overrides });

// Real error shape thrown by @aws-sdk/client-s3 for a missing object.
const noSuchKeyError = new S3ServiceException({
  name: 'NoSuchKey',
  $fault: 'client',
  $metadata: { httpStatusCode: 404 },
  message: 'The specified key does not exist.',
});

// Real error shape thrown by @aws-sdk/client-s3 for a HeadObject on a missing key.
const notFoundError = new S3ServiceException({
  name: 'NotFound',
  $fault: 'client',
  $metadata: { httpStatusCode: 404 },
  message: 'Not Found',
});

// Real error shape for a transient/server-side failure (NOT a 404).
const internalError = new S3ServiceException({
  name: 'InternalError',
  $fault: 'server',
  $metadata: { httpStatusCode: 500 },
  message: 'We encountered an internal error. Please try again.',
});

describe('BackblazeStorageAdapter (aws-sdk-client-mock, real adapter logic)', () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  describe('constructor config validation (drives the Local fallback)', () => {
    it('throws when endpoint is missing', () => {
      expect(() => new BackblazeStorageAdapter(makeConfig({ endpoint: undefined }))).toThrow(
        'Backblaze endpoint and region must be configured',
      );
    });

    it('throws when region is missing', () => {
      expect(() => new BackblazeStorageAdapter(makeConfig({ region: undefined }))).toThrow(
        'Backblaze endpoint and region must be configured',
      );
    });

    it('throws when accessKeyId is missing', () => {
      expect(() => new BackblazeStorageAdapter(makeConfig({ accessKeyId: undefined }))).toThrow(
        'Backblaze credentials must be configured',
      );
    });

    it('throws when secretAccessKey is missing', () => {
      expect(() => new BackblazeStorageAdapter(makeConfig({ secretAccessKey: undefined }))).toThrow(
        'Backblaze credentials must be configured',
      );
    });

    it('throws when bucketName is missing', () => {
      expect(() => new BackblazeStorageAdapter(makeConfig({ bucketName: undefined }))).toThrow(
        'Backblaze bucket name must be configured',
      );
    });

    it('constructs with a complete injected config and wires bucket/key into commands', async () => {
      s3Mock.on(GetObjectCommand).resolves({ Body: sdkStreamMixin(Readable.from([Buffer.from('x')])) });

      const adapter = new BackblazeStorageAdapter(makeConfig({}));
      await expect(adapter.getFile('profile-pictures/u1/a.png')).resolves.toEqual(Buffer.from('x'));

      const [call] = s3Mock.calls();
      expect(call?.args[0]?.input).toMatchObject({
        Bucket: 'test-bucket',
        Key: 'profile-pictures/u1/a.png',
      });
    });
  });

  describe('endpoint https-prefix normalization', () => {
    const PREFIX_LOG = 'Added https:// prefix to Backblaze endpoint';

    it('adds https:// to a scheme-less endpoint', () => {
      const infoSpy = jest.spyOn(loggingService, 'logInfo');

      expect(() => new BackblazeStorageAdapter(makeConfig({ endpoint: 's3.us-west-004.backblazeb2.com' }))).not.toThrow();

      // The S3Client instance is private; the corrected endpoint is observable
      // via the constructor's own logInfo side effect.
      expect(infoSpy).toHaveBeenCalledWith(
        PREFIX_LOG,
        expect.objectContaining({
          original: 's3.us-west-004.backblazeb2.com',
          corrected: 'https://s3.us-west-004.backblazeb2.com',
        }),
      );
    });

    it('upgrades an http:// endpoint to https://', () => {
      const infoSpy = jest.spyOn(loggingService, 'logInfo');

      expect(() => new BackblazeStorageAdapter(makeConfig({ endpoint: 'http://s3.us-west-004.backblazeb2.com' }))).not.toThrow();

      expect(infoSpy).toHaveBeenCalledWith(
        'Upgraded Backblaze endpoint from http:// to https://',
        expect.objectContaining({
          original: 'http://s3.us-west-004.backblazeb2.com',
          corrected: 'https://s3.us-west-004.backblazeb2.com',
        }),
      );
    });

    it('does not use the prefix log for an http:// endpoint (upgraded via the dedicated log)', () => {
      const infoSpy = jest.spyOn(loggingService, 'logInfo');

      expect(() => new BackblazeStorageAdapter(makeConfig({ endpoint: 'http://s3.example.com' }))).not.toThrow();
      expect(infoSpy).not.toHaveBeenCalledWith(PREFIX_LOG, expect.anything());
    });

    it('passes an https:// endpoint through unchanged (no prefix added)', () => {
      const infoSpy = jest.spyOn(loggingService, 'logInfo');

      expect(() => new BackblazeStorageAdapter(makeConfig({ endpoint: 'https://s3.example.com' }))).not.toThrow();
      expect(infoSpy).not.toHaveBeenCalledWith(PREFIX_LOG, expect.anything());
    });
  });

  describe('getFile — 404 vs real errors', () => {
    it('returns null on NoSuchKey (real S3 error shape)', async () => {
      s3Mock.on(GetObjectCommand).rejects(noSuchKeyError);

      await expect(new BackblazeStorageAdapter(makeConfig({})).getFile('missing.png')).resolves.toBeNull();
    });

    it('returns null on HTTP 404 via $metadata alone', async () => {
      s3Mock.on(GetObjectCommand).rejects({ $metadata: { httpStatusCode: 404 } });

      await expect(new BackblazeStorageAdapter(makeConfig({})).getFile('missing.png')).resolves.toBeNull();
    });

    it('throws on a server error (InternalError)', async () => {
      s3Mock.on(GetObjectCommand).rejects(internalError);

      await expect(new BackblazeStorageAdapter(makeConfig({})).getFile('key.png')).rejects.toBe(internalError);
    });

    it('throws on a generic error', async () => {
      const genericError = new Error('network down');
      s3Mock.on(GetObjectCommand).rejects(genericError);

      await expect(new BackblazeStorageAdapter(makeConfig({})).getFile('key.png')).rejects.toBe(genericError);
    });

    it('returns the file buffer when the object exists', async () => {
      // sdkStreamMixin is the exact wrapper @aws-sdk/client-s3 applies to GetObject
      // bodies at runtime, so this fixture is the real response shape.
      s3Mock.on(GetObjectCommand).resolves({ Body: sdkStreamMixin(Readable.from([Buffer.from('hello-b2')])) });

      await expect(new BackblazeStorageAdapter(makeConfig({})).getFile('exists.png')).resolves.toEqual(
        Buffer.from('hello-b2'),
      );
    });

    it('returns null when the response has no Body', async () => {
      s3Mock.on(GetObjectCommand).resolves({});

      await expect(new BackblazeStorageAdapter(makeConfig({})).getFile('empty.png')).resolves.toBeNull();
    });
  });

  describe('fileExists', () => {
    it('returns false on 404 (NotFound — real S3 error shape)', async () => {
      s3Mock.on(HeadObjectCommand).rejects(notFoundError);

      await expect(new BackblazeStorageAdapter(makeConfig({})).fileExists('missing.png')).resolves.toBe(false);
    });

    it('returns false on HTTP 404 via $metadata alone', async () => {
      s3Mock.on(HeadObjectCommand).rejects({ $metadata: { httpStatusCode: 404 } });

      await expect(new BackblazeStorageAdapter(makeConfig({})).fileExists('missing.png')).resolves.toBe(false);
    });

    it('returns true when the object exists', async () => {
      s3Mock.on(HeadObjectCommand).resolves({});

      await expect(new BackblazeStorageAdapter(makeConfig({})).fileExists('exists.png')).resolves.toBe(true);
    });

    it('returns false on any other error (documented: "exists?" fails open to false)', async () => {
      s3Mock.on(HeadObjectCommand).rejects(internalError);

      // Existing behavior: a broken storage answers "not there". Nothing
      // destructive is gated on fileExists, so this is accepted — but it is
      // NOT distinguishable from a genuine 404 (same family as Pattern 1).
      await expect(new BackblazeStorageAdapter(makeConfig({})).fileExists('key.png')).resolves.toBe(false);
    });
  });

  describe('listFiles — fail-open on error (Pattern-1 territory)', () => {
    it('returns object keys from Contents, filtering empty/undefined keys', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'profile-pictures/u1/a.png' },
          { Key: 'profile-pictures/u1/b.png' },
          { Key: '' },
          { Key: undefined },
        ],
      });

      await expect(new BackblazeStorageAdapter(makeConfig({})).listFiles('profile-pictures/u1/')).resolves.toEqual([
        'profile-pictures/u1/a.png',
        'profile-pictures/u1/b.png',
      ]);
    });

    it('returns [] when no Contents are returned', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({});

      await expect(new BackblazeStorageAdapter(makeConfig({})).listFiles('empty/')).resolves.toEqual([]);
    });

    it('returns [] on any storage error — Pattern 1: a storage error looks like "no files" to the avatar-cleanup caller', async () => {
      s3Mock.on(ListObjectsV2Command).rejects(internalError);

      // FAIL-OPEN (docs/FAILURE_PATTERNS.md Pattern 1): the caller
      // (ProfilePictureService.deleteUserProfilePictures) cannot distinguish a
      // storage outage from an empty prefix and simply deletes nothing — files
      // stay in place (leak, never data loss). Asserted deliberately as the
      // current behavior; revisit if this result ever feeds a deletion guard.
      await expect(new BackblazeStorageAdapter(makeConfig({})).listFiles('profile-pictures/u1/')).resolves.toEqual([]);
    });
  });

  describe('listFileVersions — fail-open on error (Pattern-1 territory)', () => {
    it('maps Versions and DeleteMarkers to {key, versionId, isDeleteMarker}', async () => {
      s3Mock.on(ListObjectVersionsCommand).resolves({
        Versions: [{ Key: 'a.txt', VersionId: 'v1' }, { Key: 'no-version.txt' }],
        DeleteMarkers: [{ Key: 'd.txt', VersionId: 'dm1' }],
      });

      await expect(new BackblazeStorageAdapter(makeConfig({})).listFileVersions('a.txt')).resolves.toEqual([
        { key: 'a.txt', versionId: 'v1', isDeleteMarker: false },
        { key: 'no-version.txt', isDeleteMarker: false },
        { key: 'd.txt', versionId: 'dm1', isDeleteMarker: true },
      ]);
    });

    it('skips entries without a Key', async () => {
      s3Mock.on(ListObjectVersionsCommand).resolves({
        Versions: [{ VersionId: 'v1' }],
        DeleteMarkers: [{}],
      });

      await expect(new BackblazeStorageAdapter(makeConfig({})).listFileVersions('a.txt')).resolves.toEqual([]);
    });

    it('returns [] on any storage error — Pattern 1 fail-open like listFiles', async () => {
      s3Mock.on(ListObjectVersionsCommand).rejects(internalError);

      // Same deliberate fail-open contract as listFiles (see comment there):
      // an error is indistinguishable from "no versions" to the caller.
      await expect(new BackblazeStorageAdapter(makeConfig({})).listFileVersions('a.txt')).resolves.toEqual([]);
    });
  });
});
