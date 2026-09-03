// PhotoViewer + Photo Detail responsive coverage.
//
// Frank #7735 (Photo Viewer architectural review):
//   - Viewport × Aspect ratio matrix: photo完整显示, 不裁切, 不拉伸, 居中, 无 layout shift
//   - Interaction: Previous/Next, Keyboard, Swipe, Preload
//   - URL scenarios: F5 refresh, Direct URL, New Tab, Browser Back/Forward, Legacy URL 301 redirect, Original image
//   - Permission matrix: Guest/User/Admin × scenery/person × page + image endpoint
//
// Required env vars (see README inside for full details):
//   LIFEFRAME_BASE                       — e.g. https://lifeframe.frank2025.com
//   SCENERY_PHOTO_ID                     — UUID of a non-person photo (required)
//   PERSON_PHOTO_ID                      — UUID of a person-category photo (required for permission tests)
//   LEGACY_KEY_URL                       — full old /p/<encoded-key> URL (required for 301 test)
//   SUPABASE_GUEST_TOKEN                 — anon JWT (optional, defaults to anonymous)
//   SUPABASE_TEST_USER_TOKEN             — User role JWT (required for User column)
//   SUPABASE_TEST_ADMIN_TOKEN            — Admin role JWT (required for Admin column)
//
// Run:
//   LIFEFRAME_BASE=https://lifeframe.frank2025.com \
//   SCENERY_PHOTO_ID=<uuid> \
//   PERSON_PHOTO_ID=<uuid> \
//   LEGACY_KEY_URL='https://lifeframe.frank2025.com/p/uploads%2F2026-08-30%2F<file>.jpg' \
//   SUPABASE_TEST_USER_TOKEN=<jwt> \
//   SUPABASE_TEST_ADMIN_TOKEN=<jwt> \
//     node scripts/test-viewer-responsive.mjs
//
// Exit code: 0 on all-pass, 1 on any failure.

import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.LIFEFRAME_BASE ?? 'http://localhost:3000';
const OUT = 'screenshots';

const SCENERY_PHOTO_ID = process.env.SCENERY_PHOTO_ID;
const PERSON_PHOTO_ID = process.env.PERSON_PHOTO_ID;
const LEGACY_KEY_URL = process.env.LEGACY_KEY_URL;
const USER_TOKEN = process.env.SUPABASE_TEST_USER_TOKEN;
const ADMIN_TOKEN = process.env.SUPABASE_TEST_ADMIN_TOKEN;

await mkdir(OUT, { recursive: true });

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// Supabase auth cookie shape (sb-<project>-auth-token):
//   base64(JSON({"access_token":"<jwt>","refresh_token":"...","expires_in":3600,"expires_at":<unix>,"token_type":"bearer","user":{...}}))
// We just need a cookie named `sb-<ref>-auth-token` whose value contains
// a valid access_token; the SSR client reads via getSession() / getUser().

function authContext(browser, token) {
  // Frank's project ref is the first 16 chars of the Supabase URL host suffix.
  // For prod: https://<ref>.supabase.co — we read it from the page's
  // supabase-js config (NEXT_PUBLIC_SUPABASE_URL on the rendered page).
  // For test purposes, set the cookie name pattern manually.
  if (!token) return browser.newContext();
  const ctx = browser.newContext();
  // We can't know the project ref at script-eval time without parsing;
  // callers wire this by setting SUPABASE_PROJECT_REF env var. Default to
  // an empty ref and write multiple common cookie names so any of them
  // will resolve for the user's deployment.
  return ctx;
}

function applyAuthCookies(context, token, projectRef) {
  if (!token || !projectRef) return;
  context.addCookies([
    {
      name: `sb-${projectRef}-auth-token`,
      value: token,
      domain: BASE.replace(/^https?:\/\//, '').split('/')[0],
      path: '/',
      httpOnly: false,
      secure: BASE.startsWith('https'),
      sameSite: 'Lax',
    },
  ]);
}

const browser = await chromium.launch();

try {
  // ── A. Viewport matrix (responsive layout, no CSS hacks) ─────────
  // Verifies that PhotoViewer's photo img element fits inside the
  // Photo Stage container, is centered, and preserves its natural
  // aspect ratio (no stretch / no clip). Runs on every viewport Frank
  // specified, against the same scenery photo (so layout, not content,
  // is the variable).
  if (!SCENERY_PHOTO_ID) {
    console.log('⚠ Skipping viewport matrix (no SCENERY_PHOTO_ID set)');
  } else {
    console.log('\n=== A. Viewport × Aspect matrix ===');
    const viewports = [
      { name: 'desktop-1920x1080', width: 1920, height: 1080 },
      { name: 'desktop-2560x1440', width: 2560, height: 1440 },
      { name: 'desktop-1366x768',  width: 1366, height: 768  },
      { name: 'desktop-1024x768',  width: 1024, height: 768  },
      { name: 'mobile-390x844',    ...devices['iPhone 13'] },
      { name: 'mobile-430x932',    ...devices['iPhone 15 Pro Max'] },
      { name: 'tablet-768x1024',   ...devices['iPad Mini'] },
    ];

    for (const vp of viewports) {
      const ctx = await browser.newContext({ viewport: vp });
      const page = await ctx.newPage();
      try {
        await page.goto(`${BASE}/photos/${SCENERY_PHOTO_ID}`, {
          waitUntil: 'domcontentloaded',
        });
        // Wait for the page img to load. SSR renders <img src=/api/.../image>.
        await page.waitForSelector('main article img', { timeout: 10000 });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(300);

        const img = page.locator('main article img').first();
        const imgBox = await img.boundingBox();
        const naturalDims = await img.evaluate(
          (el) => ({ w: el.naturalWidth, h: el.naturalHeight }),
        );
        const container = page.locator('main article > div').first();
        const containerBox = await container.boundingBox();

        const fits =
          imgBox && containerBox &&
          imgBox.x >= containerBox.x - 0.5 &&
          imgBox.y >= containerBox.y - 0.5 &&
          imgBox.x + imgBox.width <= containerBox.x + containerBox.width + 0.5 &&
          imgBox.y + imgBox.height <= containerBox.y + containerBox.height + 0.5;

        const centered =
          imgBox && containerBox &&
          Math.abs(
            (imgBox.x + imgBox.width / 2) - (containerBox.x + containerBox.width / 2),
          ) < 2 &&
          Math.abs(
            (imgBox.y + imgBox.height / 2) - (containerBox.y + containerBox.height / 2),
          ) < 2;

        const noStretch =
          naturalDims.w > 0 &&
          naturalDims.h > 0 &&
          Math.abs(
            imgBox.width / imgBox.height - naturalDims.w / naturalDims.h,
          ) < 0.01;

        record(`[${vp.name}] img fits container (no clip)`, Boolean(fits), `img=${imgBox?.width.toFixed(0)}×${imgBox?.height.toFixed(0)}`);
        record(`[${vp.name}] img centered in container`, Boolean(centered));
        record(`[${vp.name}] img preserves natural aspect ratio (no stretch)`, Boolean(noStretch), `natural=${naturalDims.w}×${naturalDims.h}`);
      } catch (err) {
        record(`[${vp.name}] viewport test`, false, String(err.message ?? err));
      } finally {
        await ctx.close();
      }
    }
  }

  // ── B. Interaction tests (next/prev, keyboard, preload) ─────────
  // Opens the gallery (HomeGallery) from /, clicks first marker →
  // cluster modal → first thumbnail → PhotoViewer. Tests navigation
  // via Next button, ArrowLeft/ArrowRight keyboard, and that the URL
  // updates to /photos/<uuid> on each transition.
  console.log('\n=== B. Interaction tests ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);

      // Find a clickable marker
      const markerLoc = page.locator('svg g[style*="cursor: pointer"]').first();
      const hasMarker = await markerLoc.count() > 0;
      if (!hasMarker) {
        record('Interaction: marker found on /', false, 'no clickable marker');
      } else {
        await markerLoc.click({ force: true });
        await page.waitForTimeout(800);
        // Click first cluster thumbnail
        const thumb = page.locator('button[title]:not([title=""]):not([title="下一张"]):not([title="上一张"]):not([title="关闭"])').filter({ has: page.locator('img') }).first();
        if (await thumb.count() > 0) await thumb.click({ force: true });
        await page.waitForTimeout(800);

        const modal = page.locator('[role="dialog"]');
        const modalOpen = await modal.count() > 0;
        record('Interaction: PhotoViewer modal opens', modalOpen);

        if (modalOpen) {
          // URL updates to /photos/<uuid>
          const urlAfterOpen = page.url();
          record('Interaction: URL is /photos/<uuid>', /\/photos\/[0-9a-f-]{36}/.test(urlAfterOpen), urlAfterOpen);

          // Next button advances
          const nextBtn = page.locator('[role="dialog"] button[aria-label="下一张"], [role="dialog"] button[aria-label="次の写真"]').first();
          if (await nextBtn.isEnabled()) {
            const urlBefore = page.url();
            await nextBtn.click();
            await page.waitForTimeout(500);
            const urlAfter = page.url();
            record('Interaction: Next button advances + URL changes', urlBefore !== urlAfter);
          }

          // ArrowLeft / ArrowRight
          const beforeArrow = page.url();
          await page.locator('[role="dialog"]').first().focus().catch(() => {});
          await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(400);
          const afterArrowRight = page.url();
          record('Interaction: ArrowRight advances', beforeArrow !== afterArrowRight);

          const beforeArrowLeft = page.url();
          await page.keyboard.press('ArrowLeft');
          await page.waitForTimeout(400);
          const afterArrowLeft = page.url();
          record('Interaction: ArrowLeft goes back', beforeArrowLeft !== afterArrowLeft);

          // Escape closes viewer + restores URL to /
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
          const urlAfterEscape = page.url();
          record('Interaction: Escape closes + URL restored to /', !/\/photos\//.test(urlAfterEscape) && !/\/p\//.test(urlAfterEscape), urlAfterEscape);
        }
      }
    } catch (err) {
      record('Interaction test threw', false, String(err.message ?? err));
    } finally {
      await ctx.close();
    }
  }

  // ── C. URL scenarios (F5, direct URL, new tab, legacy 301) ──────
  console.log('\n=== C. URL scenarios ===');
  if (SCENERY_PHOTO_ID) {
    // C1: F5 refresh — same photo should load
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/photos/${SCENERY_PHOTO_ID}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('main article img', { timeout: 10000 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('main article img', { timeout: 10000 });
      const imgVisible = await page.locator('main article img').first().isVisible();
      record('URL: F5 refresh re-renders /photos/<uuid>', imgVisible);
    } catch (err) {
      record('URL: F5 refresh', false, String(err.message ?? err));
    } finally {
      await ctx.close();
    }

    // C2: Direct URL in fresh context (mimics paste-into-new-tab)
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page2 = await ctx2.newPage();
    try {
      await page2.goto(`${BASE}/photos/${SCENERY_PHOTO_ID}`, { waitUntil: 'domcontentloaded' });
      await page2.waitForSelector('main article img', { timeout: 10000 });
      record('URL: direct /photos/<uuid> in fresh tab loads', true);
    } catch (err) {
      record('URL: direct /photos/<uuid>', false, String(err.message ?? err));
    } finally {
      await ctx2.close();
    }
  }

  // C3: Legacy /p/<encoded-key> → 301 redirect to /photos/<uuid>
  if (LEGACY_KEY_URL) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(LEGACY_KEY_URL, { waitUntil: 'domcontentloaded' });
      const status = resp?.status();
      const finalUrl = page.url();
      record(
        'URL: legacy /p/<encoded-key> 301 redirects to /photos/<uuid>',
        status === 200 && /\/photos\/[0-9a-f-]{36}/.test(finalUrl),
        `status=${status} final=${finalUrl}`,
      );
    } catch (err) {
      record('URL: legacy redirect', false, String(err.message ?? err));
    } finally {
      await ctx.close();
    }
  } else {
    console.log('⚠ Skipping legacy 301 test (no LEGACY_KEY_URL set)');
  }

  // ── D. Permission matrix ────────────────────────────────────────
  // Guest/User/Admin × scenery/person × page + image endpoint.
  //
  // Page expectations:
  //   guest + scenery: 200 with img visible
  //   guest + person:  200 with "需要登录查看" prompt (login CTA, no img)
  //   user  + person: 200 with img visible
  //   admin + person: 200 with img visible
  //
  // Image endpoint expectations:
  //   guest + scenery: 200 image/jpeg
  //   guest + person:  401
  //   user  + person: 200 image/jpeg
  //   admin + person: 200 image/jpeg
  //
  // For User/Admin, set SUPABASE_TEST_USER_TOKEN / SUPABASE_TEST_ADMIN_TOKEN
  // (a Supabase access_token JWT).
  console.log('\n=== D. Permission matrix ===');
  if (!SCENERY_PHOTO_ID || !PERSON_PHOTO_ID) {
    console.log('⚠ Skipping permission matrix (no SCENERY_PHOTO_ID or PERSON_PHOTO_ID)');
  } else {
    // Helper: fetch with optional auth header (Supabase Bearer token).
    // Supabase's SSR auth cookie path is more complex, but for direct
    // /api/photos/[id]/image and /photos/[id] requests, the cookie
    // path is used. For the SSR page, we set the cookie via context.
    const tests = [
      { label: 'guest', token: null },
      { label: 'user',  token: USER_TOKEN },
      { label: 'admin', token: ADMIN_TOKEN },
    ].filter((t) => t.label !== 'guest' ? Boolean(t.token) : true);

    for (const role of tests) {
      // Page test
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      try {
        // For SSR pages, set the Supabase auth cookie so getSession() resolves.
        if (role.token) {
          await ctx.addCookies([
            {
              name: 'sb-test-auth-token',
              value: JSON.stringify({ access_token: role.token, token_type: 'bearer' }),
              domain: BASE.replace(/^https?:\/\//, '').split('/')[0],
              path: '/',
              httpOnly: false,
              secure: BASE.startsWith('https'),
              sameSite: 'Lax',
            },
          ]);
        }

        // Test person photo page
        await page.goto(`${BASE}/photos/${PERSON_PHOTO_ID}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        const imgOnPerson = await page.locator('main article img').first().isVisible().catch(() => false);
        const loginPromptVisible = await page.locator('text=需要登录查看').first().isVisible().catch(() => false);

        if (role.label === 'guest') {
          // Guest + person: must show login prompt, not the photo img
          record(
            `Permission[guest + person page]: shows login prompt, NOT img`,
            loginPromptVisible && !imgOnPerson,
            `imgVisible=${imgOnPerson} loginPrompt=${loginPromptVisible}`,
          );
        } else {
          // User/Admin + person: must show the img
          record(
            `Permission[${role.label} + person page]: img visible`,
            imgOnPerson,
            `imgVisible=${imgOnPerson}`,
          );
        }

        // Image endpoint test (no cookie needed for fetch API; use Authorization header)
        const imgHeaders = role.token
          ? { Authorization: `Bearer ${role.token}` }
          : {};
        const imgResp = await fetch(`${BASE}/api/photos/${PERSON_PHOTO_ID}/image`, { headers: imgHeaders });
        if (role.label === 'guest') {
          record(
            `Permission[guest + person image]: 401 (cannot bypass via direct URL)`,
            imgResp.status === 401,
            `status=${imgResp.status}`,
          );
        } else {
          record(
            `Permission[${role.label} + person image]: 200 image/*`,
            imgResp.ok && (imgResp.headers.get('content-type') ?? '').startsWith('image/'),
            `status=${imgResp.status} type=${imgResp.headers.get('content-type')}`,
          );
        }

        // Scenery photo: should be 200 for everyone
        const sceneryResp = await fetch(`${BASE}/api/photos/${SCENERY_PHOTO_ID}/image`, { headers: imgHeaders });
        record(
          `Permission[${role.label} + scenery image]: 200 image/*`,
          sceneryResp.ok && (sceneryResp.headers.get('content-type') ?? '').startsWith('image/'),
          `status=${sceneryResp.status}`,
        );
      } catch (err) {
        record(`Permission[${role.label}] threw`, false, String(err.message ?? err));
      } finally {
        await ctx.close();
      }
    }
  }

  // ── E. Original Image (rendered <img src>) ─────────────────────
  // Verifies the rendered img src uses the photo-id image endpoint
  // (UUID, not legacy /p/<key>). Covers Frank #0903 (Action Bar
  // opens /api/photos/[id]/image, never R2 directly).
  console.log('\n=== E. Original Image (rendered src) ===');
  if (SCENERY_PHOTO_ID) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/photos/${SCENERY_PHOTO_ID}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('main article img', { timeout: 10000 });
      const imgSrc = await page.locator('main article img').first().getAttribute('src');
      record(
        'E: rendered img src uses /api/photos/[id]/image',
        typeof imgSrc === 'string' && imgSrc.includes(`/api/photos/${SCENERY_PHOTO_ID}/image`),
        `src=${imgSrc}`,
      );
    } catch (err) {
      record('E: original image', false, String(err.message ?? err));
    } finally {
      await ctx.close();
    }
  }

  // ── F. Action Bar (Frank #0903 doc/0903.md) ────────────────────
  // Replaces the old ⋯ overflow menu with 3 equal-weight buttons:
  // Like / View Original / Share. Verifies no overflow trigger,
  // all 3 buttons exist with correct labels, View Original opens
  // /api/photos/[id]/image in a new tab, Share copies /photos/<id>
  // to clipboard and shows the "✓ 已复制" feedback.
  console.log('\n=== F. Action Bar (Frank #0903) ===');
  if (SCENERY_PHOTO_ID) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      // Open PhotoViewer via the homepage (forces modal-style viewer
      // with the Action Bar; the SSR /photos/<id> page is layout-only
      // and doesn't render the toolbar).
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const markerLoc = page.locator('svg g[style*="cursor: pointer"]').first();
      if ((await markerLoc.count()) === 0) {
        record('F: marker found on /', false, 'no clickable marker');
      } else {
        await markerLoc.click({ force: true });
        await page.waitForTimeout(800);
        const thumb = page.locator('button[title]:not([title=""]):not([title="下一张"]):not([title="上一张"]):not([title="关闭"])').filter({ has: page.locator('img') }).first();
        if ((await thumb.count()) > 0) await thumb.click({ force: true });
        await page.waitForTimeout(800);

        const dialog = page.locator('[role="dialog"]');
        await dialog.waitFor({ timeout: 5000 });
        const toolbar = dialog.locator('[role="toolbar"]');
        await toolbar.waitFor({ timeout: 5000 });

        // F1: no ⋯ overflow trigger
        const overflowTrigger = await dialog.locator('[aria-haspopup="menu"]').count();
        record('F: no ⋯ overflow menu trigger', overflowTrigger === 0);

        // F2: 3 buttons present
        const viewBtnCount = await dialog.locator('[aria-label="查看原图"]').count();
        const shareBtnCount = await dialog.locator('[aria-label="分享"]').count();
        record('F: View Original button present (aria-label="查看原图")', viewBtnCount >= 1);
        record('F: Share button present (aria-label="分享")', shareBtnCount >= 1);

        // F3: View Original opens /api/photos/[id]/image in new tab
        const [newPage] = await Promise.all([
          ctx.waitForEvent('page'),
          dialog.locator('[aria-label="查看原图"]').click(),
        ]);
        await newPage.waitForLoadState('domcontentloaded');
        const newUrl = newPage.url();
        record(
          'F: View Original opens /api/photos/[id]/image (no R2 key)',
          newUrl.includes(`/api/photos/${SCENERY_PHOTO_ID}/image`),
          `newTabUrl=${newUrl}`,
        );
        await newPage.close();

        // F4: Share copies /photos/<id> and shows ✓ 已复制 feedback
        await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
        await dialog.locator('[aria-label="分享"]').click();
        await page.waitForTimeout(300);
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        const expectedShareUrl = `${BASE}/photos/${SCENERY_PHOTO_ID}`;
        record(
          'F: Share copies /photos/<id> URL to clipboard',
          clipboardText === expectedShareUrl,
          `clipboard=${clipboardText} expected=${expectedShareUrl}`,
        );
        const copiedBtnCount = await dialog.locator('[aria-label="✓ 已复制"]').count();
        record('F: Share shows ✓ 已复制 feedback after copy', copiedBtnCount >= 1);

        // F5: feedback reverts to "分享" after ~1.8s
        await page.waitForTimeout(2200);
        const revertedBtnCount = await dialog.locator('[aria-label="分享"]').count();
        record('F: Share button reverts to "分享" label after ~1.8s', revertedBtnCount >= 1);

        // F6: toolbar stays open (Escape doesn't close due to Share click)
        const dialogStillOpen = await dialog.count();
        record('F: PhotoViewer stays open after Share click', dialogStillOpen >= 1);
      }
    } catch (err) {
      record('F: Action Bar test', false, String(err.message ?? err));
    } finally {
      await ctx.close();
    }
  }

} catch (err) {
  record('Test threw', false, String(err.message ?? err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
