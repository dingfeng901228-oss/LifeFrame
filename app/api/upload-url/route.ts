import { getR2UploadUrl, type R2Config } from '@/lib/r2';
import { getSupabaseAdmin } from '@/lib/supabase';

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

  type UploadRequestBody = {
    filename?: unknown;
    contentType?: unknown;
    exif?: {
      takenAt?: unknown;
      lat?: unknown;
      lng?: unknown;
      make?: unknown;
      model?: unknown;
      locationName?: unknown;
    };
    // §9 of the spec: multi-tag classification. Subset of {person, scenery}.
    // Empty array = uncategorized.
    categories?: unknown;
    // §24 share level. Defaults server-side to 'private' if absent.
    visibility?: unknown;
  };

  let body: UploadRequestBody;
  try {
    body = (await req.json()) as UploadRequestBody;
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

  // Build EXIF metadata for R2 object (only when client provided exif)
  const exif = body.exif;
  const metadata: Record<string, string> = {};
  if (exif && typeof exif === 'object') {
    if (typeof exif.takenAt === 'string') metadata['exif-taken-at'] = exif.takenAt;
    if (typeof exif.lat === 'number' && Number.isFinite(exif.lat)) {
      metadata['exif-lat'] = exif.lat.toFixed(6);
    }
    if (typeof exif.lng === 'number' && Number.isFinite(exif.lng)) {
      metadata['exif-lng'] = exif.lng.toFixed(6);
    }
    if (typeof exif.make === 'string') metadata['exif-make'] = exif.make;
    if (typeof exif.model === 'string') metadata['exif-model'] = exif.model;
    if (typeof exif.locationName === 'string' && exif.locationName.length > 0) {
      metadata['exif-location-name'] = exif.locationName.slice(0, 240);
    }
  }
  // Categories are top-level on the request body (not part of EXIF),
  // and only valid as an array of literal strings. Anything else is
  // silently dropped to avoid R2 metadata garbage.
  const categories = Array.isArray(body.categories)
    ? body.categories.filter((x): x is string => typeof x === 'string')
    : [];
  if (categories.length > 0) {
    metadata['exif-categories'] = categories.join(',').slice(0, 240);
  }

  const signedUrl = await getR2UploadUrl(config, key, safeContentType, 300, metadata);
  // Note: AWS SDK hoists x-amz-meta-* into URL query params (visible in signedUrl),
  // so R2 applies them automatically. Client only needs PUT(url, body).

  const publicUrl = config.publicBase
    ? `${config.publicBase}/${key}`
    : signedUrl.split('?')[0];

  // §24: validate visibility. Anything invalid falls back to 'private'
  // — never let a malformed client write 'public' when they shouldn't.
  const visibility: 'private' | 'unlisted' | 'public' =
    body.visibility === 'unlisted' || body.visibility === 'public'
      ? body.visibility
      : 'private';

  // Insert photo metadata into Supabase (best-effort — don't fail the request).
  // Orphan rows (Supabase row but no R2 object) can happen if client fails PUT;
  // we'll add a status field + cleanup job later if needed.
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('photos').insert({
      key,
      public_url: publicUrl,
      filename,
      content_type: safeContentType,
      taken_at: typeof exif?.takenAt === 'string' ? exif.takenAt : null,
      lat: typeof exif?.lat === 'number' && Number.isFinite(exif.lat) ? exif.lat : null,
      lng: typeof exif?.lng === 'number' && Number.isFinite(exif.lng) ? exif.lng : null,
      camera_make: typeof exif?.make === 'string' ? exif.make : null,
      camera_model: typeof exif?.model === 'string' ? exif.model : null,
      location_name: typeof exif?.locationName === 'string' && exif.locationName.length > 0 ? exif.locationName.slice(0, 240) : null,
      categories: categories.length > 0 ? categories : [],
      visibility,
    });
    if (error) {
      console.error('[supabase insert error]', error.message);
    }
  } catch (err) {
    console.error('[supabase init/insert error]', err);
  }

  return Response.json({ url: signedUrl, key, publicUrl });
}