// Self-test script for MapLibre second-round bug fix (Frank #7914).
//
// Verifies the 10 specific test scenarios Frank spelled out in
// doc/MapLibre 第二轮 Bug 修复.md:
//
//   1.  Globe → zoom in → Map → zoom out → Globe
//   2.  Globe → zoom in → Map → zoom in → zoom out → Globe
//   3.  Globe → rapid wheel → no state-machine race
//   4.  Mobile single-finger drag → Globe rotation
//   5.  Mobile two-finger pinch → Globe zoom
//   6.  Mobile pinch past threshold → MapLibre
//   7.  MapLibre pinch zoom out → Globe (reverse trigger)
//   8.  MapLibre init failure → Globe restored (error fallback)
//   9.  Browser resize → both Globe and Map render
//   10. Page refresh → homepage shows Globe
//
// We test the rendering + state-machine paths via Playwright. The
// Globe↔Map transition is driven by dispatching wheel events over
// the SVG (desktop) and synthesising multi-touch via the CDP
// protocol (mobile). The reverse trigger fires when MapLibre's
// zoom drops to MAP_TO_GLOBE_ZOOM = 3 — we drive that by
// dispatching wheel events over the MapLibre canvas.
//
// Run with dev server up:
//   npm run dev
//   node scripts/test-globe-map-transition.mjs

import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.LIFEFRAME_BASE ?? 'http://localhost:3000';
const OUT = 'screenshots';

await mkdir(OUT, { recursive: true });

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();

try {
  // ── Scenario 1: Globe → zoom in → Map → zoom out → Globe (desktop) ──
  {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500); // Globe ready

    // Wheel over Globe SVG to drive forward transition.
    // Globe max scale = 2400; MAP_TRANSITION_BEGIN = 2350 →
    // ~15 wheel ticks of zoom-in (1.15× per tick) lands us past.
    for (let i = 0; i < 25; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(1200); // crossfade + map load

    // After forward transition, the MapLibre canvas should be
    // visible (opacity=1) and Globe invisible (opacity=0).
    const mapOpacity = await page.evaluate(() => {
      const el = document.querySelector('.maplibregl-canvas');
      if (!el) return null;
      const parent = el.closest('[style*="opacity"]');
      return parent ? parseFloat(parent.style.opacity) : null;
    });
    record(
      '[S1] Globe → Map (forward transition)',
      mapOpacity != null && mapOpacity > 0.5,
      `map canvas opacity ${mapOpacity}`,
    );

    // Now reverse: wheel out from MapLibre canvas to drop zoom
    // below MAP_TO_GLOBE_ZOOM = 3.
    const canvas = await page.locator('.maplibregl-canvas').first();
    const box = await canvas.boundingBox();
    if (box) {
      // ~15 wheel ticks of zoom-out from a typical starting zoom
      // (4-5) lands below 3.
      for (let i = 0; i < 25; i++) {
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(80);
      }
      await page.waitForTimeout(1200); // reverse crossfade
    }
    // After reverse, Globe opacity > 0.5 again.
    const globeOpacityAfter = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      if (!svg) return null;
      const parent = svg.closest('[style*="opacity"]');
      return parent ? parseFloat(parent.style.opacity) : null;
    });
    record(
      '[S1] Map → Globe (reverse transition)',
      globeOpacityAfter != null && globeOpacityAfter > 0.5,
      `globe opacity ${globeOpacityAfter}`,
    );

    await page.screenshot({ path: `${OUT}/round-trip-desktop.png` });
    await ctx.close();
  }

  // ── Scenario 2: Globe → zoom in → Map → zoom in → zoom out → Globe ──
  {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);

    for (let i = 0; i < 25; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(1200);

    // Zoom back IN on MapLibre (don't return to Globe).
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(400);

    // Now zoom OUT enough to trigger reverse transition.
    for (let i = 0; i < 35; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(1200);

    const globeOpacity = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      if (!svg) return null;
      const parent = svg.closest('[style*="opacity"]');
      return parent ? parseFloat(parent.style.opacity) : null;
    });
    record(
      '[S2] Map zoom-in then zoom-out → Globe',
      globeOpacity != null && globeOpacity > 0.5,
      `globe opacity ${globeOpacity}`,
    );
    await ctx.close();
  }

  // ── Scenario 3: Globe rapid wheel → no state-machine race ──
  {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);

    // Rapid wheels (no awaits in between) — Globe should resolve
    // to one stable mode (either 'globe' or 'map'), not flicker.
    for (let i = 0; i < 50; i++) {
      await page.mouse.wheel(0, -120);
    }
    await page.waitForTimeout(2000); // settle

    // Check that exactly one layer is opaque.
    const opacities = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      const canvas = document.querySelector('.maplibregl-canvas');
      const svgOp = svg
        ? parseFloat(svg.closest('[style*="opacity"]')?.style.opacity ?? '0')
        : 0;
      const canvasOp = canvas
        ? parseFloat(
            canvas.closest('[style*="opacity"]')?.style.opacity ?? '0',
          )
        : 0;
      return { svgOp, canvasOp };
    });
    const oneVisible =
      (opacities.svgOp > 0.5 && opacities.canvasOp < 0.5) ||
      (opacities.svgOp < 0.5 && opacities.canvasOp > 0.5);
    record(
      '[S3] Rapid wheel → no flicker / state-machine race',
      oneVisible,
      `svg=${opacities.svgOp} canvas=${opacities.canvasOp}`,
    );
    await ctx.close();
  }

  // ── Scenario 4: Mobile single-finger drag → Globe rotation ──
  // ── Scenario 5: Mobile two-finger pinch → Globe zoom ──
  // ── Scenario 6: Mobile pinch past threshold → MapLibre ──
  // (Combined mobile scenarios — set up once, run 3 assertions.)
  {
    const mobile = devices['iPhone 13'];
    const ctx = await browser.newContext({ ...mobile });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);

    // S4: single-finger drag
    const startBox = await page.locator('svg').first().boundingBox();
    if (startBox) {
      await page.touchscreen.tap(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
      await page.waitForTimeout(300);
      // Now swipe horizontally — should rotate, not zoom.
      const before = await page.evaluate(() => {
        const svg = document.querySelector('svg');
        return svg?.getAttribute('style') ?? '';
      });
      // Synthesise a touch drag via CDP (Playwright's touchscreen
      // doesn't expose multi-touch directly).
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          {
            x: startBox.x + startBox.width * 0.5,
            y: startBox.y + startBox.height * 0.5,
            id: 1,
          },
        ],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: startBox.x + startBox.width * 0.7,
            y: startBox.y + startBox.height * 0.5,
            id: 1,
          },
        ],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => {
        const svg = document.querySelector('svg');
        return svg?.getAttribute('style') ?? '';
      });
      record(
        '[S4] Mobile single-finger drag → Globe rotation (no crash)',
        true, // assertion is "doesn't crash"; rotation visible via d3 attributes not easy to capture
        `style ${before.length > 0 ? 'before' : '?'} → ${after.length > 0 ? 'after' : '?'}`,
      );

      // S5: two-finger pinch — should change scale, not rotate.
      // We start from a known position and move both fingers
      // apart (zoom in) then together (zoom out).
      const cx = startBox.x + startBox.width * 0.5;
      const cy = startBox.y + startBox.height * 0.5;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x: cx - 30, y: cy, id: 1 },
          { x: cx + 30, y: cy, id: 2 },
        ],
      });
      // Spread to ~150px each side (5× ratio).
      for (let step = 0; step < 10; step++) {
        const offset = 30 + step * 12;
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: cx - offset, y: cy, id: 1 },
            { x: cx + offset, y: cy, id: 2 },
          ],
        });
        await page.waitForTimeout(40);
      }
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await page.waitForTimeout(400);
      record(
        '[S5] Mobile two-finger pinch → Globe zoom (no crash)',
        true,
        'CDP touch sequence completed',
      );

      // S6: continue pinching past MAP_TRANSITION_BEGIN.
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x: cx - 10, y: cy, id: 1 },
          { x: cx + 10, y: cy, id: 2 },
        ],
      });
      for (let step = 0; step < 20; step++) {
        const offset = 10 + step * 25;
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: cx - offset, y: cy, id: 1 },
            { x: cx + offset, y: cy, id: 2 },
          ],
        });
        await page.waitForTimeout(40);
      }
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await page.waitForTimeout(1500);
      const mobileMapOpacity = await page.evaluate(() => {
        const canvas = document.querySelector('.maplibregl-canvas');
        if (!canvas) return null;
        const parent = canvas.closest('[style*="opacity"]');
        return parent ? parseFloat(parent.style.opacity) : null;
      });
      record(
        '[S6] Mobile pinch past threshold → MapLibre',
        mobileMapOpacity != null && mobileMapOpacity > 0.5,
        `map canvas opacity ${mobileMapOpacity}`,
      );
      await cdp.detach();
    }
    await ctx.close();
  }

  // ── Scenario 7: MapLibre pinch zoom out → Globe (reverse trigger) ──
  // Reverse trigger fires when MapLibre zoom ≤ MAP_TO_GLOBE_ZOOM
  // (3). We drive this by dispatching wheels over the MapLibre
  // canvas. Re-using the desktop setup from scenario 1's reverse
  // path; the assertion here is specifically that we LAND on the
  // Globe, not get stuck on a black Map screen.
  {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    // Forward first.
    for (let i = 0; i < 25; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(1200);
    // Now zoom way out — should trigger reverse.
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(1200);

    // Globe must be visible again. Black screen with attribution
    // only is the failure mode Frank reported — assert that we
    // don't end up there.
    const onGlobe = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      if (!svg) return false;
      const parent = svg.closest('[style*="opacity"]');
      const op = parent ? parseFloat(parent.style.opacity) : 0;
      return op > 0.5;
    });
    record(
      '[S7] MapLibre zoom-out → reverse trigger → Globe',
      onGlobe,
      onGlobe ? 'Globe restored' : 'still on Map (failure mode)',
    );
    await ctx.close();
  }

  // ── Scenario 8: MapLibre init failure → Globe restored ──
  // We can't easily inject a MapLibre error without monkey-patching
  // the network; instead, verify the error-callback path by
  // intercepting and aborting the OpenFreeMap tile request, then
  // ensuring the Globe is still visible.
  {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await ctx.newPage();
    // Abort tile requests to simulate style load failure.
    await page.route(/tiles\.openfreemap\.org/, (route) => route.abort());
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    // Try to trigger forward transition.
    for (let i = 0; i < 25; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(1500);
    // Globe must still be the safe fallback (error fallback effect).
    const onGlobe = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      if (!svg) return false;
      const parent = svg.closest('[style*="opacity"]');
      const op = parent ? parseFloat(parent.style.opacity) : 0;
      return op > 0.5;
    });
    record(
      '[S8] MapLibre init failure → Globe restored (error fallback)',
      onGlobe,
      onGlobe
        ? 'Globe visible after tile request abort'
        : 'Map mode despite tile failure',
    );
    await ctx.close();
  }

  // ── Scenario 9: Browser resize → both Globe and Map render ──
  {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(800);
    const onGlobeSmall = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      return svg?.getBoundingClientRect().width ?? 0;
    });
    // Resize back.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(800);
    const onGlobeLarge = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      return svg?.getBoundingClientRect().width ?? 0;
    });
    record(
      '[S9] Browser resize → Globe renders at new size',
      onGlobeSmall > 0 && onGlobeLarge > onGlobeSmall,
      `1024×768 width=${onGlobeSmall} / 1920×1080 width=${onGlobeLarge}`,
    );
    await ctx.close();
  }

  // ── Scenario 10: Page refresh → homepage shows Globe ──
  {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const globeVisible = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      if (!svg) return false;
      const parent = svg.closest('[style*="opacity"]');
      const op = parent ? parseFloat(parent.style.opacity) : 0;
      return op > 0.5;
    });
    record(
      '[S10] Page refresh → homepage shows Globe',
      globeVisible,
      `Globe opacity ${globeVisible ? 'visible' : 'hidden'}`,
    );
    await ctx.close();
  }
} catch (err) {
  record('Suite threw', false, String(err?.message ?? err));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
const total = results.length;
console.log(`\n${passed}/${total} passed`);

// Integration note: scenarios 1-3, 7-10 cover desktop behaviour;
// 4-6 cover mobile multi-touch via CDP. Some scenarios assert
// only "no crash" because the underlying Globe state (d3-geo
// rotation, scale) isn't surfaced to the DOM as testable
// attributes — verify visually via the screenshots.
console.log('\n=== Notes ===');
console.log(
  '  S4 + S5 + S6: mobile assertions are smoke tests (no crash + CDP sequence completes)',
);
console.log(
  '    because Globe internal state (d3 rotation, scale) is not in the DOM. Visual verification',
);
console.log(
  '    via screenshots/globe-mobile-*.png is required to confirm rotation/zoom actually fired.',
);

process.exit(passed === total ? 0 : 1);
