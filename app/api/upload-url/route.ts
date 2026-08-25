import { getR2UploadUrl, type R2Config } from '@/lib/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  const signedUrl = await getR2UploadUrl(config, key, safeContentType, 300);
  const publicUrl = config.publicBase
    ? `${config.publicBase}/${key}`
    : signedUrl.split('?')[0];

  return Response.json({ url: signedUrl, key, publicUrl });
}
