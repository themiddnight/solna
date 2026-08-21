#!/usr/bin/env bun

/**
 * Backblaze B2 Staging to Dev TRUE Sync Script
 * 
 * Synchronises the Staging B2 bucket to the Dev B2 bucket.
 * - Copies/Overwrites files from Staging to Dev.
 * - Deletes files in Dev that do not exist in Staging.
 * 
 * Reads Dev bucket settings from app/backend/.env automatically.
 * Reads Staging bucket settings from environment variables.
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from 'dotenv';
import { join } from 'path';
import type { Readable } from 'stream';

// Load dev .env file explicitly
config({ path: join(process.cwd(), '.env') });

// Dev (Destination) config
const devAccessKeyId = process.env.BUCKET_ACCESS_KEY_ID;
const devSecretAccessKey = process.env.BUCKET_SECRET_ACCESS_KEY;
const devBucketName = process.env.BUCKET_BUCKET_NAME;
const devEndpoint = process.env.BUCKET_ENDPOINT;
const devRegion = process.env.BUCKET_REGION || 'us-west-004';

// Staging (Source) config
const stgAccessKeyId = process.env.STG_BUCKET_ACCESS_KEY_ID;
const stgSecretAccessKey = process.env.STG_BUCKET_SECRET_ACCESS_KEY;
const stgBucketName = process.env.STG_BUCKET_BUCKET_NAME;
const stgEndpoint = process.env.STG_BUCKET_ENDPOINT || devEndpoint; // fallback to dev endpoint if same region/provider
const stgRegion = process.env.STG_BUCKET_REGION || devRegion;

interface StgObject {
  Key: string;
  Size?: number;
}

interface S3ListResponse {
  Contents?: Array<{ Key?: string; Size?: number }>;
  NextContinuationToken?: string;
}

interface S3GetResponse {
  Body?: Readable;
  ContentType?: string;
}

async function runSync() {
  console.log('🔄 Backblaze B2 Staging -> Dev TRUE Sync Tool');
  console.log('==================================================');

  // Validate Dev credentials
  if (!devAccessKeyId || !devSecretAccessKey || !devBucketName || !devEndpoint) {
    console.error('❌ Error: Dev B2 configuration is missing from your .env file.');
    console.error('Please configure BUCKET_ACCESS_KEY_ID, BUCKET_SECRET_ACCESS_KEY, BUCKET_BUCKET_NAME, and BUCKET_ENDPOINT in your .env file.\n');
    process.exit(1);
  }

  // Validate Staging credentials
  if (!stgAccessKeyId || !stgSecretAccessKey || !stgBucketName) {
    console.error('❌ Error: Missing Staging B2 bucket credentials.');
    console.error('Please run the script by passing environment variables for Staging:');
    console.error('  - STG_BUCKET_ACCESS_KEY_ID');
    console.error('  - STG_BUCKET_SECRET_ACCESS_KEY');
    console.error('  - STG_BUCKET_BUCKET_NAME');
    console.error('  - STG_BUCKET_ENDPOINT (optional, defaults to Dev endpoint)');
    console.error('  - STG_BUCKET_REGION (optional, defaults to Dev region)\n');
    console.error('Example:');
    console.error('  STG_BUCKET_ACCESS_KEY_ID=stgKey STG_BUCKET_SECRET_ACCESS_KEY=stgSecret STG_BUCKET_BUCKET_NAME=collab-stg bun run scripts/sync-b2-stg2dev.ts\n');
    process.exit(1);
  }

  // Helper to standardise endpoints (prepend https:// if missing)
  const formatEndpoint = (ep: string) => ep.startsWith('http') ? ep : `https://${ep}`;

  if (!stgEndpoint) {
    console.error('❌ Error: Staging endpoint is missing. Set STG_BUCKET_ENDPOINT or ensure Dev endpoint is configured.');
    process.exit(1);
  }

  const stgEndpointFormatted = formatEndpoint(stgEndpoint);
  const devEndpointFormatted = formatEndpoint(devEndpoint);

  // Initialize clients
  const stagingClient = new S3Client({
    endpoint: stgEndpointFormatted,
    region: stgRegion,
    credentials: {
      accessKeyId: stgAccessKeyId,
      secretAccessKey: stgSecretAccessKey,
    }
  });

  const devClient = new S3Client({
    endpoint: devEndpointFormatted,
    region: devRegion,
    credentials: {
      accessKeyId: devAccessKeyId,
      secretAccessKey: devSecretAccessKey,
    }
  });

  console.log(`🚀 Sync Details:`);
  console.log(`   [Source] Staging Bucket: ${stgBucketName} (endpoint: ${stgEndpointFormatted})`);
  console.log(`   [Target] Dev Bucket:     ${devBucketName} (endpoint: ${devEndpointFormatted})`);
  console.log(`--------------------------------------------------`);

  // Prompt developer for confirmation to prevent accidental dev bucket wipes
  const answer = prompt('\n⚠️  WARNING: This is a TRUE SYNC. Any files in the Dev bucket that do NOT exist in the Staging bucket will be PERMANENTLY DELETED. Do you want to proceed? (y/N):');
  if (answer?.toLowerCase() !== 'y') {
    console.log('❌ Sync cancelled by user.');
    process.exit(0);
  }

  console.log('\n🔍 Scanning buckets...');

  const stagingKeys = new Set<string>();
  const stagingObjects: StgObject[] = [];
  const devKeys: string[] = [];

  try {
    // 1. Scan Staging Bucket
    let continuationToken: string | undefined = undefined;
    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: stgBucketName,
        ContinuationToken: continuationToken,
      });
      const response: S3ListResponse = await stagingClient.send(listCommand) as S3ListResponse;
      const objects = response.Contents ?? [];
      for (const obj of objects) {
        if (obj.Key) {
          stagingKeys.add(obj.Key);
          stagingObjects.push({ Key: obj.Key, ...(obj.Size !== undefined ? { Size: obj.Size } : {}) });
        }
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    console.log(`   found ${stagingObjects.length} files in Staging.`);

    // 2. Scan Dev Bucket
    continuationToken = undefined;
    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: devBucketName,
        ContinuationToken: continuationToken,
      });
      const response: S3ListResponse = await devClient.send(listCommand) as S3ListResponse;
      const objects = response.Contents ?? [];
      for (const obj of objects) {
        if (obj.Key) {
          devKeys.push(obj.Key);
        }
      }
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    console.log(`   found ${devKeys.length} files in Dev.`);

    // 3. Find files to delete in Dev (exist in Dev but not in Staging)
    const keysToDelete = devKeys.filter((key) => !stagingKeys.has(key));

    console.log(`--------------------------------------------------`);
    console.log(`📂 Syncing files to Dev (Copy/Overwrite)...`);

    let copiedCount = 0;
    let copyErrorCount = 0;

    // 4. Copy/Overwrite Staging files to Dev
    if (stagingObjects.length === 0) {
      console.log('ℹ️ Staging bucket is empty.');
    } else {
      for (const obj of stagingObjects) {
        const sizeKb = obj.Size ? (obj.Size / 1024).toFixed(1) : '0.0';
        console.log(`📁 Copying: ${obj.Key} (${sizeKb} KB)...`);

        try {
          // Download file from staging bucket
          const getCommand = new GetObjectCommand({
            Bucket: stgBucketName,
            Key: obj.Key,
          });
          const getResponse: S3GetResponse = await stagingClient.send(getCommand) as S3GetResponse;

          // Convert stream to Buffer
          const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
            return new Promise((resolve, reject) => {
              const chunks: Buffer[] = [];
              stream.on('data', (chunk: Buffer) => chunks.push(chunk));
              stream.on('error', reject);
              stream.on('end', () => resolve(Buffer.concat(chunks)));
            });
          };

          if (!getResponse.Body) {
            throw new Error(`Empty body returned for file: ${obj.Key}`);
          }
          const bodyBuffer = await streamToBuffer(getResponse.Body);

          // Upload file to dev bucket
          const putCommand = new PutObjectCommand({
            Bucket: devBucketName,
            Key: obj.Key,
            Body: bodyBuffer,
            ContentType: getResponse.ContentType,
          });
          await devClient.send(putCommand);

          console.log(`   ✅ Success`);
          copiedCount++;
        } catch (err) {
          console.error(`   ❌ Failed to copy ${obj.Key}:`, err instanceof Error ? err.message : err);
          copyErrorCount++;
        }
      }
    }

    // 5. Clean up Dev (Delete extra files)
    let deletedCount = 0;
    let deleteErrorCount = 0;

    if (keysToDelete.length > 0) {
      console.log(`--------------------------------------------------`);
      console.log(`🗑️ Deleting ${keysToDelete.length} extra files from Dev bucket...`);

      for (const key of keysToDelete) {
        console.log(`🗑️ Deleting: ${key}...`);
        try {
          const deleteCommand = new DeleteObjectCommand({
            Bucket: devBucketName,
            Key: key,
          });
          await devClient.send(deleteCommand);
          console.log(`   ✅ Deleted`);
          deletedCount++;
        } catch (err) {
          console.error(`   ❌ Failed to delete ${key}:`, err instanceof Error ? err.message : err);
          deleteErrorCount++;
        }
      }
    }

    console.log(`==================================================`);
    console.log(`📊 Sync Summary:`);
    console.log(`   ✅ Copied/Overwritten: ${copiedCount} files`);
    console.log(`   🗑️ Deleted from Dev:   ${deletedCount} files`);
    console.log(`   ❌ Copy Errors:        ${copyErrorCount} files`);
    console.log(`   ❌ Delete Errors:      ${deleteErrorCount} files`);
    
    if (copyErrorCount === 0 && deleteErrorCount === 0) {
      console.log(`🎉 TRUE SYNC completed successfully! Dev is now identical to Staging.`);
    } else {
      console.log(`⚠️ Sync completed with errors. Please check the logs above.`);
    }
  } catch (globalError) {
    console.error('❌ Sync job failed with a global error:', globalError instanceof Error ? globalError.message : globalError);
    process.exit(1);
  }
}

// Run synchronization
void runSync();
