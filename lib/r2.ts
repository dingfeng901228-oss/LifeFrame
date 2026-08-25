import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
