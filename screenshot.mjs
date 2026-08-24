// Capture both pages for the MVP skeleton proof.
// Requires: npx playwright install chromium
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.LIFEFRAME_BASE ?? 'http://localhost:3001';
const OUT = 'screenshots';

const targets = [
  { url: `${BASE}/`, file: 'home.png' },
  { url: `${BASE}/upload`, file: 'upload.png' },
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

for (const t of targets) {
  const page = await ctx.newPage();
  await page.goto(t.url, { waitUntil: 'domcontentloaded' });
  // give cobe a moment to mount + run a few frames
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${t.file}`, fullPage: false });
  console.log(`captured: ${t.url} -> ${OUT}/${t.file}`);
  await page.close();
}

await ctx.close();
await browser.close();
console.log('done');
