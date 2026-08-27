import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBase: string;
};

let cachedClient: S3Client | null = null;

export function getR2Client(cfg: R2Config): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return cachedClient;
}

export async function getR2UploadUrl(
  cfg: R2Config,
  key: string,
  contentType: string,
  expiresIn = 300,
  metadata?: Record<string, string>,
): Promise<string> {
  const client = getR2Client(cfg);
  const cmd = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: contentType,
    ...(metadata && Object.keys(metadata).length > 0 ? { Metadata: metadata } : {}),
  });
  return getSignedUrl(client, cmd, { expiresIn });
}

/**
 * Delete one or more R2 objects by key. Uses DeleteObjects (multi-key
 * batch up to 1000 keys per request) when more than one key is given;
 * falls back to DeleteObject for the single-key case so the AWS SDK
 * doesn't complain about an empty Delete list.
 *
 * Used by §2 admin bulk delete — originals + their thumbnails both go
 * through this. Failures are surfaced to the caller (the photo row in
 * Supabase is only deleted after this resolves) so admin retries are
 * idempotent at the row level.
 */
export async function deleteR2Objects(
  cfg: R2Config,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  const client = getR2Client(cfg);
  if (keys.length === 1) {
    await client.send(
      new DeleteObjectCommand({ Bucket: cfg.bucket, Key: keys[0] }),
    );
    return;
  }
  await client.send(
    new DeleteObjectsCommand({
      Bucket: cfg.bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }),
  );
}
