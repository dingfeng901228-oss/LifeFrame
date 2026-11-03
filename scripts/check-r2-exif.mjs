// Standalone check: list R2 + parse EXIF for every image, WITHOUT
// touching Supabase. Verifies the recovery data source is intact.
import { readFileSync, existsSync } from 'node:fs';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import exifr from 'exifr';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnvFile('.env.local');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const BUCKET = process.env.R2_BUCKET;

const keys = [];
let token;
do {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token, MaxKeys: 1000 }));
  for (const o of res.Contents ?? []) keys.push(o.Key);
  token = res.IsTruncated ? res.NextContinuationToken : undefined;
} while (token);

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const SKIP_RE = /-verify\.|^verify|thumbnails?\/|\.\d+w\.webp$/i;
const imgs = keys.filter((k) => IMAGE_RE.test(k) && !SKIP_RE.test(k));

let withGps = 0, withTime = 0, withCamera = 0, noExif = 0, errs = 0;
const years = {};
const samples = [];

const LIMIT = Number(process.env.LIMIT || 40);
for (const k of imgs.slice(0, LIMIT)) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: k, Range: 'bytes=0-196607' }));
    const chunks = [];
    for await (const x of res.Body) chunks.push(x);
    const buf = Buffer.concat(chunks);
    const ex = await exifr.parse(buf, {
      pick: ['DateTimeOriginal', 'CreateDate', 'GPSLatitude', 'GPSLongitude', 'Make', 'Model'],
    });
    if (!ex || (!ex.GPSLatitude && !ex.DateTimeOriginal)) { noExif++; continue; }
    if (typeof ex.latitude === 'number') withGps++;
    const d = ex.DateTimeOriginal ?? ex.CreateDate;
    if (d) {
      withTime++;
      const y = new Date(d).getFullYear();
      years[y] = (years[y] ?? 0) + 1;
    }
    if (ex.Make) withCamera++;
    if (samples.length < 5) {
      samples.push({ key: k.split('/').pop(), lat: ex.latitude, lng: ex.longitude, date: d ? new Date(d).toISOString().slice(0, 10) : null, make: ex.Make, model: ex.Model });
    }
  } catch (e) { errs++; if (errs <= 3) console.error(`  ! ${k.split('/').pop()}: ${e.name}: ${e.message}`); }
}

console.log(JSON.stringify({
  totalObjects: keys.length,
  candidateImages: imgs.length,
  scanned: Math.min(LIMIT, imgs.length),
  withGps, withTime, withCamera, noExif, errs,
  yearHistogram: years,
  samples,
}, null, 2));
