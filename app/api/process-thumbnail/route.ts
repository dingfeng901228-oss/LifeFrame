import { getR2UploadUrl, type R2Config } from '@/lib/r2';
import { getSupabaseAdmin } from '@/lib/supabase';
import sharp from 'sharp';

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

// Read the original photo from R2 via its public URL. Frank's bucket
// is configured for public read, so we don't need a signed GET — the
// upload-url flow already made the object world-readable.
async function downloadFromR2(config: R2Config, key: string): Promise<Buffer> {
  if (!config.publicBase) {
    throw new Error('R2_PUBLIC_BASE not set — cannot fetch original for thumbnail generation');
  }
  const url = `${config.publicBase}/${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function uploadToR2(
  config: R2Config,
  key: string,
  body: Buffer,
  contentType: string,
  metadata: Record<string, string> = {},
): Promise<string> {
  const signedUrl = await getR2UploadUrl(config, key, contentType, 300, metadata);
  const put = await fetch(signedUrl, {
    method: 'PUT',
    // Buffer isn't part of the BodyInit union in DOM lib types; wrap
    // in Uint8Array view so TypeScript is happy.
    body: new Uint8Array(body),
  });
  if (!put.ok) {
    throw new Error(`PUT ${put.status}: ${await put.text()}`);
  }
  return config.publicBase
    ? `${config.publicBase}/${key}`
    : signedUrl.split('?')[0];
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

  type Body = { key?: unknown };
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'invalid json body' }, { status: 400 });
  }
  const key = typeof body.key === 'string' ? body.key : null;
  if (!key) {
    return Response.json({ error: 'missing key' }, { status: 400 });
  }

  // Derive the thumbnail key from the original. We strip the original
  // extension and add `.256w.webp` so it's obvious in the bucket UI.
  const ext = key.match(/\.[^./]+$/)?.[0] ?? '';
  const baseKey = ext ? key.slice(0, -ext.length) : key;
  const thumbnailKey = `${baseKey}.256w.webp`;

  // No-op if a thumbnail already exists for this key — clients can
  // safely call this endpoint on every upload.
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from('photos')
    .select('thumbnail_key')
    .eq('key', key)
    .maybeSingle();

  if (existing?.thumbnail_key === thumbnailKey) {
    return Response.json({
      ok: true,
      thumbnailKey,
      thumbnailUrl: config.publicBase
        ? `${config.publicBase}/${thumbnailKey}`
        : null,
      skipped: 'already exists',
    });
  }

  let original: Buffer;
  try {
    original = await downloadFromR2(config, key);
  } catch (err) {
    return Response.json(
      {
        error: 'failed to fetch original',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  // 256×256 webp, fit inside (don't upscale tiny images), quality 75
  // (good enough for a Timeline popup; saves ~70% size vs original).
  let thumbnail: Buffer;
  try {
    thumbnail = await sharp(original)
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
  } catch (err) {
    return Response.json(
      {
        error: 'sharp processing failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  let thumbnailUrl: string;
  try {
    thumbnailUrl = await uploadToR2(
      config,
      thumbnailKey,
      thumbnail,
      'image/webp',
      // Carry the EXIF-taken-at forward so the thumbnail shows up in
      // any date-ordered queries that key off object metadata.
      { 'thumb-of': key.slice(0, 240) },
    );
  } catch (err) {
    return Response.json(
      {
        error: 'thumbnail upload failed',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  // Update the photos row so the home page picks up the thumbnail on
  // its next refetch. Errors here are non-fatal (the thumbnail is
  // already in R2); just log and return success anyway.
  try {
    const { error } = await supabase
      .from('photos')
      .update({ thumbnail_key: thumbnailKey, thumbnail_url: thumbnailUrl })
      .eq('key', key);
    if (error) {
      console.error('[supabase update error]', error.message);
    }
  } catch (err) {
    console.error('[supabase init/update error]', err);
  }

  return Response.json({ ok: true, thumbnailKey, thumbnailUrl });
}