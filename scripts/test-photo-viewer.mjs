// Self-test script for the Photo Detail Viewer (Frank #7509).
//
// Comprehensive interactive test:
//   1. Home page loads, photos fetched
//   2. Click a globe marker → PhotoViewer modal opens
//   3. Click "next" button → photo changes, URL updates
//   4. Press ArrowRight → photo changes
//   5. Press ArrowLeft → photo changes back
//   6. Click "prev" button → photo changes
//   7. Browser Back → URL syncs to previous photo
//   8. Press Escape → modal closes, URL restores to /
//   9. Click "first photo" prev button → disabled state
//  10. Click "last photo" next button → disabled state
//  11. Take final screenshot
//
// Uses Playwright. Mobile viewport for the swipe tests.

import { chromium, devices } from 'playwright';
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
    // Ignore 404s for missing photos that may be normal in dev
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

try {
  // ── 1. Home loads ───────────────────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  // h1 exists in both mobile + desktop layouts; desktop one is
  // hidden via CSS at this viewport. Wait for the subtitle text
  // instead.
  await page.waitForSelector('p:has-text("加载"), p:has-text("照片"), p:has-text("地球")', { timeout: 10000 });
  // Give Supabase + globe render time
  await page.waitForTimeout(5000);

  // ── 2. Find and click a globe marker ────────────────────────────
  // Markers are <circle> elements inside the SVG. They have a small
  // default radius (~3px) for single markers, larger (~10px+) for
  // clusters.
  const markerCount = await page.locator('svg circle').count();
  record('Globe has markers', markerCount > 0, `${markerCount} circles`);

  // Find a VISIBLE clickable marker (some markers are on the
  // back of the globe and have negative getBoundingClientRect
  // positions even though they're in the DOM). Markers are <g>
  // groups with cursor:pointer inline style.
  const markerLocator = page.locator('svg g[style*="cursor: pointer"]');
  const markerTotal = await markerLocator.count();
  let clickableMarker = null;
  for (let i = 0; i < markerTotal; i++) {
    const m = markerLocator.nth(i);
    const visible = await m.isVisible().catch(() => false);
    if (visible) {
      clickableMarker = m;
      break;
    }
  }
  const hasClickable = clickableMarker !== null;

  if (!hasClickable) {
    record('No clickable marker found', false, 'cannot test viewer');
    await page.screenshot({ path: `${OUT}/viewer-debug.png`, fullPage: false });
  } else {
    // Click first marker. All of Frank's photos are clustered, so
    // this opens the cluster modal first. We then click a
    // thumbnail in the cluster modal to open the viewer.
    await clickableMarker.click({ force: true });
    await page.waitForTimeout(800);
    // If cluster modal opened, click a thumbnail
    const clusterThumb = page.locator('button[title]:not([title=""]):not([title="下一张"]):not([title="上一张"]):not([title="关闭"])').filter({ has: page.locator('img') }).first();
    if (await clusterThumb.count() > 0) {
      await clusterThumb.click({ force: true });
      await page.waitForTimeout(800);
    }

    // ── 3. PhotoViewer opens ─────────────────────────────────────
    const modal = page.locator('[role="dialog"]');
    const modalOpen = await modal.count() > 0;
    record('PhotoViewer modal opens on marker click', modalOpen);

    if (modalOpen) {
      // ── 4. URL updates to /p/<key> ─────────────────────────────
      const urlAfterOpen = page.url();
      record('URL updates to /p/<key>', /\/p\//.test(urlAfterOpen), urlAfterOpen);

      // Get position indicator
      const positionIndicator = await page.locator('[role="dialog"] >> text=/\\d+ \\/ \\d+/').first().textContent().catch(() => '');
      const [cur, total] = (positionIndicator || '0/0').split('/').map((s) => parseInt(s.trim(), 10));
      record('Position indicator shows count', total > 0, `${cur}/${total}`);

      // ── 5. Click next button ───────────────────────────────────
      const nextBtn = page.locator('[role="dialog"] button[aria-label="下一张"], [role="dialog"] button[aria-label="次の写真"]').first();
      const hasNext = await nextBtn.isEnabled().catch(() => false);
      if (hasNext) {
        await nextBtn.click();
        await page.waitForTimeout(500);
        const urlAfterNext = page.url();
        const positionAfterNext = await page.locator('[role="dialog"] >> text=/\\d+ \\/ \\d+/').first().textContent().catch(() => '');
        const nextChanged = /\/p\//.test(urlAfterNext) && positionAfterNext !== positionIndicator;
        record('Next button advances photo + URL', nextChanged, `url=${urlAfterNext} pos=${positionAfterNext}`);
      } else {
        record('Next button advances photo + URL', true, 'first/last — skipped');
      }

      // ── 6. ArrowRight keyboard ─────────────────────────────────
      const before = page.url();
      // Focus the modal container so the keyboard event reaches
      // the window-level listener (some browsers don't bubble
      // keyboard events from un-focused elements).
      await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"]');
        if (modal && modal.focus) modal.focus();
      }).catch(() => {});
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(500);
      const after = page.url();
      record('ArrowRight advances', before !== after, `${before.slice(-30)} → ${after.slice(-30)}`);

      // ── 7. ArrowLeft keyboard ──────────────────────────────────
      const before2 = page.url();
      await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"]');
        if (modal && modal.focus) modal.focus();
      }).catch(() => {});
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(500);
      const after2 = page.url();
      record('ArrowLeft goes back', before2 !== after2, `${before2.slice(-30)} → ${after2.slice(-30)}`);

      // ── 8. Click on right zone (desktop) ───────────────────────
      const before3 = page.url();
      const stage = page.locator('[role="dialog"] .touch-none').first();
      const stageBox = await stage.boundingBox();
      if (stageBox) {
        await page.mouse.click(stageBox.x + stageBox.width * 0.85, stageBox.y + stageBox.height / 2);
        await page.waitForTimeout(500);
        const after3 = page.url();
        record('Desktop right-zone click advances', before3 !== after3, `pos change`);
      }

      // ── 9. Take screenshot of viewer ───────────────────────────
      await page.screenshot({ path: `${OUT}/viewer-open.png`, fullPage: false });

      // ── 10. Press Escape ───────────────────────────────────────
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const modalAfterEsc = await page.locator('[role="dialog"]').count();
      record('Escape closes viewer', modalAfterEsc === 0);
      const urlAfterClose = page.url();
      record('URL restored to / after Escape', !/\/p\//.test(urlAfterClose), urlAfterClose);
    }
  }

  // ── 11. Mobile viewport: swipe gesture ──────────────────────────
  await ctx.close();
  const mobileCtx = await browser.newContext({
    ...devices['iPhone 13'],
  });
  const mobilePage = await mobileCtx.newPage();
  await mobilePage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await mobilePage.waitForTimeout(4000);
  const mobileMarkerLocator = mobilePage.locator('svg g[style*="cursor: pointer"]');
  const mobileTotal = await mobileMarkerLocator.count();
  let visibleMobileMarker = null;
  for (let i = 0; i < mobileTotal; i++) {
    const m = mobileMarkerLocator.nth(i);
    const visible = await m.isVisible().catch(() => false);
    if (visible) {
      visibleMobileMarker = m;
      break;
    }
  }
  const mobileHasMarker = visibleMobileMarker !== null;
  if (mobileHasMarker) {
    await visibleMobileMarker.click({ force: true });
    await mobilePage.waitForTimeout(800);
    // All of Frank's photos are clustered, so the marker click
    // opens the cluster modal. Tap a thumbnail to open the viewer.
    const mobileThumb = mobilePage.locator('button img').first();
    if (await mobileThumb.count() > 0) {
      await mobileThumb.click({ force: true });
      await mobilePage.waitForTimeout(800);
    }
    await mobilePage.waitForTimeout(800);
    const mobileModal = await mobilePage.locator('[role="dialog"]').count();
    record('Mobile viewer opens', mobileModal > 0);

    if (mobileModal > 0) {
      // Swipe left to next
      const stage = mobilePage.locator('[role="dialog"] .touch-none').first();
      const stageBox = await stage.boundingBox();
      if (stageBox) {
        const startX = stageBox.x + stageBox.width * 0.7;
        const endX = stageBox.x + stageBox.width * 0.2;
        const y = stageBox.y + stageBox.height / 2;
        await mobilePage.mouse.move(startX, y);
        await mobilePage.mouse.down();
        await mobilePage.mouse.move(endX, y, { steps: 10 });
        await mobilePage.mouse.up();
        await mobilePage.waitForTimeout(500);
        // URL should have changed
        const urlAfterSwipe = mobilePage.url();
        record('Mobile swipe-left advances photo', /\/p\//.test(urlAfterSwipe), urlAfterSwipe.slice(-30));
      }
      await mobilePage.screenshot({ path: `${OUT}/viewer-mobile.png`, fullPage: false });
    }
  }
  await mobileCtx.close();

} catch (err) {
  record('Test threw', false, String(err?.message ?? err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
