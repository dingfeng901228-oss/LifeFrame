// Frank #7243 round-2: rebuild the `photos` table from the R2 bucket.
//
// WHY THIS EXISTS
//   The Supabase project that held LifeFrame's photo metadata was
//   deleted. The Cloudflare R2 bucket that holds the actual image
//   files was NOT — every original JPEG is still there, including
//   its EXIF block (GPS lat/lng + DateTimeOriginal + camera make
//   and model). So the metadata can be rebuilt from the files
//   themselves; nothing was permanently lost.
//
// WHAT IT DOES
//   1. Lists every object under uploads/ in the R2 bucket.
//   2. Skips test/verification artefacts (the *-verify.png files
//      and anything under a thumbnails/ prefix that already has
//      a source row).
//   3. Downloads each object, parses its EXIF with `exifr`.
//   4. Writes one `photos` row per image through PostgREST using
//      the service_role key (bypasses RLS).
//   5. Optionally reverse-geocodes lat/lng into a human-readable
//      `location_name` via Nominatim (--geocode flag), so the UI
//      can show "威海市" instead of raw coordinates.
//
// PREREQUISITES
//   1. A Supabase project exists and `infra/restore-all.sql` has
//      been run in its SQL Editor.
//   2. .env.local has NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//      pointing at THAT project.
//
// USAGE
//   node scripts/reindex-r2-to-supabase.mjs --dry-run
//   node scripts/reindex-r2-to-supabase.mjs
//   node scripts/reindex-r2-to-supabase.mjs --geocode
//
// FLAGS
//   --dry-run     list + EXIF-parse everything, print a summary,
//                 write nothing.
//   --geocode     reverse-geocode each coordinate into
//                 location_name via Nominatim (slow: 1 req/sec).
//   --only-new    skip objects whose key already exists as a row
//                 (default: true — safe to re-run).
//
// ROLLBACK
//   The script only INSERTs. To undo:
//     delete from public.photos;
//   (or delete the whole Supabase project and start over).

import { readFileSync, existsSync } from 'node:fs';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import exifr from 'exifr';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const GEOCODE = args.has('--geocode');
const ONLY_NEW = !args.has('--all');

// ── env ────────────────────────────────────────────────────────────────────
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile('.env.local');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_ACCOUNT = process.env.R2_ACCOUNT_ID;
const R2_KEY = process.env.R2_ACCESS_KEY_ID;
const r2Secret = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC = process.env.R2_PUBLIC_BASE;

for (const [name, v] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  R2_ACCOUNT_ID: R2_ACCOUNT,
  R2_ACCESS_KEY_ID: R2_KEY,
  R2_SECRET_ACCESS_KEY: r2Secret,
  R2_BUCKET: R2_BUCKET,
  R2_PUBLIC_BASE: R2_PUBLIC,
})) {
  if (!v) {
    console.error(`✗ missing env: ${name} (check .env.local)`);
    process.exit(1);
  }
}

// Fail fast if the Supabase project is still a dead ref — this is
// exactly the failure mode that started the whole recovery.
const supHost = new URL(SUPABASE_URL).host;
console.log(`→ Supabase: ${supHost}`);
console.log(`→ R2 bucket: ${R2_BUCKET}`);

let probe;
try {
  probe = await fetch(`${SUPABASE_URL}/rest/v1/photos?select=id&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
} catch (e) {
  console.error(
    `✗ Supabase host ${supHost} is unreachable: ${e.cause?.code ?? e.message}\n` +
      `  DNS for a deleted Supabase project returns NXDOMAIN, exactly\n` +
      `  like a made-up ref. The project needs to be restored (or a\n` +
      `  new one created) before the photos can be re-indexed.`,
  );
  process.exit(1);
}
if (!probe.ok) {
  console.error(
    `✗ Supabase project unreachable (HTTP ${probe.status}).\n` +
      `  ${SUPABASE_URL}\n` +
      `  If the DNS for ${supHost} does not resolve, the project is\n` +
      `  gone — create/restore one in the Supabase dashboard, run\n` +
      `  infra/restore-all.sql, then update .env.local and re-run.`,
  );
  process.exit(1);
}
const existingRows = await probe.json();
console.log(`→ existing photos rows: ${existingRows.length}`);

// ── R2 client ──────────────────────────────────────────────────────────────
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_KEY, secretAccessKey: r2Secret },
});

async function listAll() {
  const keys = [];
  let token;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const o of res.Contents ?? []) keys.push({ key: o.Key, size: o.Size });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

// ── helpers ────────────────────────────────────────────────────────────────
const IMAGE_RE = /\.(jpe?g|png|webp|heic|avif)$/i;
// Skip artefacts that are not original photos:
//   *-verify.png      → CORS / upload test files
//   thumbnails/       → processed 256×256 variants
//   *.256w.webp       → the responsive "256 wide" derivative that
//                       the image pipeline generated alongside the
//                       original (the original .jpg is indexed).
const SKIP_RE = /-verify\.|^verify|thumbnails?\/|\.\d+w\.webp$|-thumb\./i;

// EXIF lives in the JPEG APP1 segment, which is always within the
// first ~128 KB of the file (right after SOI + the JFIF header).
// Fetching the whole 3 MB image for every photo would mean ~720 MB
// of pointless download; a ranged GET of the first 192 KB gets the
// full EXIF block for ~6% of the bytes.
const EXIF_HEAD_BYTES = 192 * 1024;

async function exifOf(key) {
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Range: `bytes=0-${EXIF_HEAD_BYTES - 1}`,
    }),
  );
  // NOTE: iterate the SDK stream directly. `Readable.from(res.Body)`
  // wraps the SdkStream object rather than its chunks, which
  // silently corrupts the byte stream — exifr then reports
  // "Unknown file format" on perfectly valid JPEGs.
  const chunks = [];
  for await (const c of res.Body) chunks.push(c);
  const buf = Buffer.concat(chunks);
  let ex = null;
  try {
    ex = await exifr.parse(buf, {
      pick: [
        'DateTimeOriginal',
        'CreateDate',
        'GPSLatitude',
        'GPSLongitude',
        'Make',
        'Model',
        'ImageWidth',
        'ImageHeight',
      ],
    });
  } catch {
    ex = null;
  }
  return { buf, ex };
}

function fmtDate(ex) {
  const d = ex?.DateTimeOriginal ?? ex?.CreateDate;
  if (!d) return null;
  const iso = d instanceof Date ? d.toISOString() : new Date(d).toISOString();
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

// Nominatim reverse geocode — 1 req/sec per their usage policy.
async function reverseGeocode(lat, lng) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}` +
    `&lon=${lng}&zoom=10&accept-language=zh,en`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'LifeFrame/1.0 (personal photo archive)' },
  });
  if (!res.ok) return null;
  const j = await res.json();
  const a = j.address ?? {};
  const city =
    a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state ?? null;
  const country = a.country ?? null;
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  if (country) return country;
  return null;
}

async function insertRows(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/photos`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`insert failed (${res.status}): ${txt.slice(0, 400)}`);
  }
}

// ── main ───────────────────────────────────────────────────────────────────
const all = await listAll();
console.log(`→ R2 objects: ${all.length}`);

let existingKeys = new Set();
if (ONLY_NEW) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/photos?select=key`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  if (res.ok) {
    const rows = await res.json();
    existingKeys = new Set(rows.map((r) => r.key));
    console.log(`→ already indexed: ${existingKeys.size}`);
  }
}

const candidates = all.filter(
  (o) => IMAGE_RE.test(o.key) && !SKIP_RE.test(o.key) && !existingKeys.has(o.key),
);
console.log(`→ to index: ${candidates.length}`);

const rows = [];
let noExif = 0;
let geocoded = 0;

for (const [i, o] of candidates.entries()) {
  process.stdout.write(
    `\r  [${i + 1}/${candidates.length}] ${o.key.slice(0, 60).padEnd(60)}`,
  );
  let ex = null;
  let buf = null;
  try {
    ({ buf, ex } = await exifOf(o.key));
  } catch (e) {
    console.log(`\n    ! download failed: ${e.message}`);
    continue;
  }

  // `GPSLatitude` / `GPSLongitude` are the raw tags (DMS arrays);
  // exifr derives decimal `latitude` / `longitude` from them when
  // they are present. Use the decimal form — writing the DMS array
  // into a double precision column would produce a broken
  // coordinate. (Note: `latitude` / `longitude` are NOT valid
  // `pick` keys — picking them returns undefined. The GPS tags
  // have to be picked for the derived fields to appear.)
  const lat = typeof ex?.latitude === 'number' ? ex.latitude : null;
  const lng = typeof ex?.longitude === 'number' ? ex.longitude : null;
  const takenAt = fmtDate(ex);
  if (!ex || (!lat && !takenAt)) noExif++;

  let locationName = null;
  if (GEOCODE && lat != null && lng != null) {
    locationName = await reverseGeocode(lat, lng);
    if (locationName) geocoded++;
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim rate limit
  }

  rows.push({
    key: o.key,
    public_url: `${R2_PUBLIC}/${o.key}`,
    filename: o.key.split('/').pop(),
    content_type: /\.png$/i.test(o.key) ? 'image/png' : 'image/jpeg',
    size_bytes: o.size,
    taken_at: takenAt,
    lat,
    lng,
    camera_make: ex?.Make ?? null,
    camera_model: ex?.Model ?? null,
    location_name: locationName,
    // The old demo rows were public. Personal photos default to
    // 'private' per the §24 sharing model; flip to 'public' after
    // the rebuild if Frank wants the gallery public again.
    visibility: 'private',
    categories: [],
  });
}
process.stdout.write('\n');

console.log(`→ parsed ${rows.length} images`);
console.log(`→ without usable EXIF: ${noExif}`);
if (GEOCODE) console.log(`→ reverse-geocoded: ${geocoded}`);

if (DRY_RUN) {
  console.log('\n-- dry run, nothing written. sample rows: --');
  console.log(JSON.stringify(rows.slice(0, 5), null, 2));
  process.exit(0);
}

// Insert in batches of 50 (PostgREST handles more, but smaller
// batches make a partial failure easy to resume).
const BATCH = 50;
let inserted = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  try {
    await insertRows(batch);
    inserted += batch.length;
    console.log(`  inserted ${inserted}/${rows.length}`);
  } catch (e) {
    console.error(`\n✗ batch ${i} failed: ${e.message}`);
    console.error('  (inserted so far: ' + inserted + ')');
    process.exit(1);
  }
}

console.log(`\n✓ done — ${inserted} photos indexed into ${supHost}`);
console.log('  next: update the Vercel env vars with the new project');
console.log('  ref + service_role key, then redeploy.');
