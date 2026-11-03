// Frank #7243 round-2: regenerate the PWA icons.
//
// Before: icon-192.png 41 KB, icon-512.png 253 KB — both
// uncompressed 8-bit RGBA PNGs with an alpha channel. Every
// page load pulled icon-192.png (41 KB, 1.2 s on a slow
// mobile connection) just for the favicon link.
//
// After: palette-quantised PNGs (8-bit indexed colour, which
// is what an icon actually needs) → ~4 KB / ~9 KB, plus a
// 180×180 apple-touch-icon (iOS doesn't scale a 512 PNG
// down well) and a 32×32 favicon.ico.
//
// Run: node scripts/optimize-icons.mjs
import sharp from 'sharp';
import { writeFileSync, statSync, renameSync } from 'node:fs';

const jobs = [
  { src: 'public/icon-192.png', out: 'public/icon-192.png', size: 192, colors: 64 },
  { src: 'public/icon-512.png', out: 'public/icon-512.png', size: 512, colors: 64 },
  // iOS home-screen icon: 180×180, opaque (iOS adds its own
  // rounded-corner mask and a black background shows through
  // transparent PNGs, which looks broken).
  { src: 'public/icon-512.png', out: 'public/apple-touch-icon.png', size: 180, colors: 64, opaque: true },
];

for (const j of jobs) {
  const before = statSync(j.src).size;
  let pipeline = sharp(j.src)
    .resize(j.size, j.size, { fit: 'cover' })
    .ensureAlpha();
  if (j.opaque) {
    pipeline = pipeline.flatten({ background: '#0a0e1a' });
  }
  const tmp = j.out + '.tmp.png';
  await pipeline
    .png({ palette: true, colours: j.colors, compressionLevel: 9, effort: 10 })
    .toFile(tmp);
  renameSync(tmp, j.out);
  const after = statSync(j.out).size;
  console.log(
    `${j.out}: ${before} B -> ${after} B (${Math.round((1 - after / before) * 100)}% smaller)`,
  );
}

// favicon.ico — 32×32 PNG-in-ICO (browsers accept a PNG payload
// inside an .ico container since IE11).
const ico32 = await sharp('public/icon-512.png')
  .resize(32, 32, { fit: 'cover' })
  .png({ palette: true, colours: 64, compressionLevel: 9 })
  .toBuffer();

// Minimal ICO container: header + 1 directory entry + the PNG.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = icon
header.writeUInt16LE(1, 4); // image count
const entry = Buffer.alloc(16);
entry.writeUInt8(32, 0); // width
entry.writeUInt8(32, 1); // height
entry.writeUInt8(0, 2); // palette
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // colour planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(ico32.length, 8); // data size
entry.writeUInt32LE(22, 12); // data offset
writeFileSync('public/favicon.ico', Buffer.concat([header, entry, ico32]));
console.log(
  `public/favicon.ico: ${statSync('public/favicon.ico').size} B`,
);
