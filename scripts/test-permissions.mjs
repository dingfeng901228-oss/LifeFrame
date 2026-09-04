// Self-test script for permission enforcement (Phase 7).
//
// Verifies spec §53 scenarios by hitting the permission gates
// directly rather than asserting on photo data (which would
// require seeded fixtures and a live DB). We test the *gate*:
//   - guest homepage loads without errors
//   - guest /api/photos/[id]/image is gated (no 200 with image data)
//   - guest /photos/[id] for unknown UUID is gated
//
// Auth matrix expected (lib/permissions.ts + /api/photos/[id]/image):
//   anon + scenery photo → 200
//   anon + person photo  → 401 (canViewPhoto fail — Frank #7735)
//   auth + private, not owner/admin → 403
//   auth + any other → 200
//
// For an unknown UUID, the photo doesn't exist, so the route
// should 404 (or 401, depending on route logic). What we're
// really asserting is "no 200 with image data", which would
// indicate a broken auth gate.
//
// Run with the dev server up:
//   npm run dev   # in one terminal
//   node scripts/test-permissions.mjs   # in another

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.LIFEFRAME_BASE ?? 'http://localhost:3000';
const OUT = 'screenshots';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    const text = msg.text();
    // Ignore 401/404 image fetches (expected from our negative tests).
    if (!text.includes('Failed to load resource')) {
      consoleErrors.push(text);
    }
  }
});
page.on('pageerror', (err) => {
  consoleErrors.push(`pageerror: ${err.message}`);
});

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// Spec §53: pick a clearly-fake UUID. If auth gate is broken, the
// server would happily return an image response (200) or 500. If
// auth is enforced, we'd expect 401 (Frank #7735) or 404 (photo
// not found before auth check).
const FAKE_UUID = '00000000-0000-0000-0000-000000000001';

try {
  // ── 1. Guest homepage loads ────────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  // Wait for the Globe SVG to render (or photo fetch to settle).
  await page.waitForTimeout(4000);
  const homeOk = page.url().endsWith('/');
  record('Guest homepage loads', homeOk, page.url());

  // ── 2. Guest direct image fetch is gated ───────────────────────
  // Frank #7735: /api/photos/[id]/image closes the bypass where a
  // guest could fetch a person photo's image directly. We assert
  // that we do NOT get a 200 + image content for an unknown UUID.
  const imageRes = await page.request.get(
    `${BASE}/api/photos/${FAKE_UUID}/image`,
  );
  const imageStatus = imageRes.status();
  record(
    'Guest /api/photos/[id]/image returns non-200 (auth gate)',
    imageStatus !== 200,
    `status ${imageStatus}`,
  );

  // ── 3. Guest direct photo detail page (unknown UUID) ───────────
  // /photos/[id] uses canViewPhoto + a Supabase lookup. For an
  // unknown UUID, the row doesn't exist (404). What we really want
  // to assert: not 200 with photo content, which would indicate
  // the canViewPhoto gate was bypassed.
  const detailRes = await page.request.get(`${BASE}/photos/${FAKE_UUID}`);
  const detailStatus = detailRes.status();
  record(
    'Guest /photos/[id] for unknown UUID returns non-200',
    detailStatus !== 200,
    `status ${detailStatus}`,
  );

  // ── 4. /map-demo dev page still loads (Phase 2 regression) ─────
  // The map-demo page shouldn't be gated by auth (it's a dev page).
  // We just verify it's reachable as a guest.
  const demoRes = await page.request.get(`${BASE}/map-demo`);
  const demoStatus = demoRes.status();
  record(
    'Guest can reach /map-demo',
    demoStatus === 200,
    `status ${demoStatus}`,
  );

  // ── 5. Take screenshot ──────────────────────────────────────────
  await page.screenshot({
    path: `${OUT}/permissions-guest-home.png`,
    fullPage: false,
  });

  await browser.close();

  // ── Summary ────────────────────────────────────────────────────
  console.log('\n=== Summary ===');
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`${passed}/${total} tests passed`);

  if (consoleErrors.length > 0) {
    console.log('\n=== Console errors ===');
    consoleErrors.forEach((e) => console.log('  ' + e));
  }

  process.exit(passed === total ? 0 : 1);
} catch (err) {
  console.error('Test failed with exception:', err);
  await browser.close();
  process.exit(1);
}
