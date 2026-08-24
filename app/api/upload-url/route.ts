import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBase: string;
};

function loadConfig(): { ok: true; config: R2Config } | { ok: false; missing: string[] } {
  const required = {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
  } as const;

  const missing = Object.entries(required)
    .filter(([, v]) => !v || !String(v).trim())
    .map(([k]) => k);

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      accountId: required.R2_ACCOUNT_ID as string,
      accessKeyId: required.R2_ACCESS_KEY_ID as string,
      secretAccessKey: required.R2_SECRET_ACCESS_KEY as string,
      bucket: required.R2_BUCKET as string,
      publicBase: (process.env.R2_PUBLIC_BASE ?? '').replace(/\/$/, ''),
    },
  };
}

let cachedClient: S3Client | null = null;
function getClient(cfg: R2Config): S3Client {
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

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'untitled'
  );
}

export async function POST(req: Request) {
  const ready = loadConfig();
  if (!ready.ok) {
    return Response.json(
      {
        error: 'R2 env not configured',
        missing: ready.missing,
        hint: '在 .env.local 填 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET 四个变量后重启 dev server',
      },
      { status: 503 },
    );
  }
  const { config } = ready;

  let body: { filename?: unknown; contentType?: unknown };
  try {
    body = (await req.json()) as { filename?: unknown; contentType?: unknown };
  } catch {
    return Response.json({ error: 'invalid json body' }, { status: 400 });
  }

  const filename = sanitizeFilename(String(body.filename ?? 'untitled'));
  const contentType =
    typeof body.contentType === 'string' && body.contentType
      ? body.contentType
      : 'application/octet-stream';

  const safeContentType = /^[\w.+-]+\/[\w.+-]+$/.test(contentType)
    ? contentType
    : 'application/octet-stream';

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `uploads/${date}/${Date.now()}-${filename}`;

  const client = getClient(config);
  const cmd = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: safeContentType,
  });
  const signedUrl = await getSignedUrl(client, cmd, { expiresIn: 300 });
  const publicUrl = config.publicBase
    ? `${config.publicBase}/${key}`
    : signedUrl.split('?')[0];

  return Response.json({ url: signedUrl, key, publicUrl });
}
