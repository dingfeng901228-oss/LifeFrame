// Self-test script for spec §53 full auth matrix (Phase 9).
//
// Verifies the 4-scenario matrix documented in
// app/api/photos/[id]/image/route.ts comments:
//
//   §53.1  anon + scenery                    → 200
//   §53.2  anon + person                     → 401
//   §53.3  auth + private, not owner/admin  → 403
//   §53.4  auth + any other                  → 200
//
// Scenarios 1 + 2 (+ the regression FAKE_UUID check) are
// verified here against Frank's dev database via service-role
// SELECT (bypasses RLS so we can pick photos whose categories
// contain 'person'). Scenarios 3 + 4 require an authenticated
// session; we document the curl steps in README.md since we
// don't have Frank's dev access token checked into the repo.
//
// Why service role: anon RLS hides person photos, so the anon
// route would never see them. The route handler enforces the
// matrix itself (canViewPhoto + private-ownership check), so we
// SELECT the test fixtures via service role and probe the route
// as anon to verify the matrix.
//
// Run with dev server up + .env.local containing
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY:
//   npm run dev   # in one terminal
//   node scripts/test-auth-matrix.mjs   # in another

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.LIFEFRAME_BASE ?? 'http://localhost:3000';
const OUT = 'screenshots';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

await mkdir(OUT, { recursive: true });

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'This script needs admin SELECT access to fetch test photo UUIDs.\n' +
      'Set both in .env.local or pass via env vars.',
  );
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

try {
  // ── Fetch one photo per category from dev db ────────────────
  // We use admin SELECTs because RLS would hide person +
  // private photos from anon key reads.

  const { data: scenery, error: sceneryErr } = await admin
    .from('photos')
    .select('id, visibility, categories')
    // categories do NOT contain 'person'
    .not('categories', 'cs', '{person}')
    .in('visibility', ['public', 'unlisted'])
    .limit(1)
    .maybeSingle();

  const { data: person, error: personErr } = await admin
    .from('photos')
    .select('id, visibility, categories')
    .contains('categories', ['person'])
    .in('visibility', ['public', 'unlisted'])
    .limit(1)
    .maybeSingle();

  const { data: priv, error: privErr } = await admin
    .from('photos')
    .select('id, visibility, categories, user_id')
    .eq('visibility', 'private')
    .limit(1)
    .maybeSingle();

  if (sceneryErr) console.warn('[scenery SELECT]', sceneryErr.message);
  if (personErr) console.warn('[person SELECT]', personErr.message);
  if (privErr) console.warn('[private SELECT]', privErr.message);

  record(
    'Found scenery photo in dev db',
    !!scenery?.id,
    scenery?.id ?? 'add a public/unlisted scenery photo to test §53.1',
  );
  record(
    'Found person photo in dev db',
    !!person?.id,
    person?.id ?? 'add a public/unlisted person photo to test §53.2',
  );
  record(
    'Found private photo in dev db',
    !!priv?.id,
    priv?.id ?? 'add a private photo to test §53.3',
  );

  // ── §53.1 anon + scenery → 200 ─────────────────────────────
  if (scenery?.id) {
    const r = await page.request.get(
      `${BASE}/api/photos/${scenery.id}/image`,
    );
    record(
      '[§53.1] anon + scenery → 200',
      r.status() === 200,
      `status ${r.status()}`,
    );
  }

  // ── §53.2 anon + person → 401 ──────────────────────────────
  if (person?.id) {
    const r = await page.request.get(
      `${BASE}/api/photos/${person.id}/image`,
    );
    record(
      '[§53.2] anon + person → 401',
      r.status() === 401,
      `status ${r.status()}`,
    );
  }

  // ── §53.3 anon + private → 401 or 403 ──────────────────────
  // Route order: canViewPhoto (categories.person check) →
  // private ownership. Anon fails canViewPhoto first when the
  // private photo's categories include 'person' (401). When
  // categories are non-person but visibility is 'private', the
  // anon request skips canViewPhoto (true) and fails the
  // ownership check (403). Accept either.
  if (priv?.id) {
    const r = await page.request.get(
      `${BASE}/api/photos/${priv.id}/image`,
    );
    const status = r.status();
    record(
      '[§53.3 anon] anon + private → 401 or 403',
      status === 401 || status === 403,
      `status ${status}`,
    );
  }

  // ── FAKE UUID regression guard (Phase 7 baseline) ──────────
  // Without this row, missing-fixture dev databases would still
  // surface a green row count. The FAKE UUID must NOT return
  // 200 — that's the auth gate's whole point.
  const FAKE = '00000000-0000-0000-0000-000000000099';
  const fakeRes = await page.request.get(
    `${BASE}/api/photos/${FAKE}/image`,
  );
  record(
    '[§53 regression] anon + FAKE UUID → non-200',
    fakeRes.status() !== 200,
    `status ${fakeRes.status()}`,
  );

  // ── §53.3 + §53.4 require Frank's session ─────────────────
  // Documented as manual verification in README.md:
  //   1. Sign in at /login as Frank (admin role).
  //   2. Export SUPABASE_AUTH_COOKIE for curl -b.
  //   3. curl -b cookies.txt $BASE/api/photos/<private-id>/image
  //      → 200 (you're the owner).
  //   4. Sign in as a non-admin test user.
  //   5. curl -b test-cookies.txt $BASE/api/photos/<private-id>/image
  //      → 403.
  console.log('\n=== Manual scenarios (require Frank session) ===');
  console.log(
    '  [§53.3 auth] auth + private, not owner/admin → 403 (manual)',
  );
  console.log(
    '  [§53.4 auth] auth + any other combination    → 200 (manual)',
  );
  console.log(
    '  See README.md "Phase 9 auth matrix" section for curl steps.',
  );
} catch (err) {
  record('Suite threw', false, String(err?.message ?? err));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
const total = results.length;
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
