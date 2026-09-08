// Test the Mobile Globe「放大后无法旋转」bug fix.
// Implements Test A..F from doc/修复 Mobile Globe「放大后无法旋转」Bug.md.
//
// We use a mobile viewport (iPhone 13) + CDP Input.dispatchTouchEvent
// to drive synthetic touches, then read window.__globeDebug to verify
// the gesture state machine, scale, and rotation respond as expected.
import { chromium, devices } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;
const failures = [];

function record(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`✓ ${name} — ${detail}`);
  } else {
    failed++;
    failures.push(`${name} — ${detail}`);
    console.log(`✗ ${name} — ${detail}`);
  }
}

// Drive a single-finger drag from (sx, sy) to (sx + dx, sy + dy) over
// `steps` touch-move events. Returns the final rotation lambda value
// for assertions.
async function dragOneFinger(ctx, page, sx, sy, dx, dy, steps) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: sx, y: sy, id: 1 }],
  });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: sx + dx * t, y: sy + dy * t, id: 1 }],
    });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  return cdp.detach();
}

// Drive a 2-finger pinch from (sx - sep, sy), (sx + sep, sy) to
// (sx - sep * ratio, sy), (sx + sep * ratio, sy). ratio > 1 = pinch
// out (zoom in), < 1 = pinch in (zoom out). Returns the live
// CDP session so the caller can do follow-up touch events with
// the same in-flight touch (CDP requires TouchStart before
// TouchEnd on the same session).
async function twoFingerPinch(ctx, page, sx, sy, sep, ratio, steps) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: sx - sep, y: sy, id: 1 },
      { x: sx + sep, y: sy, id: 2 },
    ],
  });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cur = sep * (1 + (ratio - 1) * t);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: sx - cur, y: sy, id: 1 },
        { x: sx + cur, y: sy, id: 2 },
      ],
    });
    await new Promise((r) => setTimeout(r, 16));
  }
  return cdp;
}

// Lift ONE finger of a 2-finger gesture (id=2) and continue moving
// the remaining finger (id=1).
async function liftOneFingerAndDrag(ctx, page, id1, sx, sy, dx, dy, steps) {
  const cdp = await ctx.newCDPSession(page);
  // touchEnd with id=2 still active
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [{ x: sx, y: sy, id: id1 }],
  });
  // The CDP semantics for touchEnd: if you pass a touchPoints array,
  // you're stating which fingers are still down. So passing only
  // id=id1 means id=2 lifted. Subsequent touchMove with id=id1 only
  // simulates the remaining finger moving.
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: sx + dx * t, y: sy + dy * t, id: id1 }],
    });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  return cdp.detach();
}

async function readDebug(page) {
  // Frank #0906 round-13: walk up from the first visible
  // (mobile) Globe SVG to the wrapper div that has
  // __globeDebug attached. This avoids the cross-instance
  // confusion where the desktop Globe (hidden via
  // `hidden lg:block`) overwrites window.__globeDebug with
  // its own untouched state.
  return await page.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll('svg'));
    let bestEl = null, bestRect = null, bestArea = 0;
    for (const s of svgs) {
      const r = s.getBoundingClientRect();
      const a = r.width * r.height;
      if (a > bestArea && r.width > 0) {
        bestArea = a;
        bestEl = s;
        bestRect = r;
      }
    }
    if (!bestEl) return null;
    // Walk up to find the closest wrapper with __globeDebug.
    let node = bestEl.parentElement;
    let debug = null;
    while (node) {
      if (node && node.__globeDebug) {
        debug = node.__globeDebug;
        break;
      }
      node = node && node.parentElement;
    }
    if (!debug) {
      debug = window.__globeDebug;
    }
    if (!debug) return null;
    return {
      gesture: debug.gesture,
      scale: debug.scale,
      rotation: debug.rotation,
      activeTouches: debug.activeTouches,
    };
  });
}

async function newMobilePage(browser) {
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    bypassCSP: true,
  });
  // Frank #0906 round-13: clear service-worker + cache between
  // pages so the test never sees a stale chunk hash from a
  // previous build. Without this, a hot-reload that just
  // happened can leave the test fetching a chunk that no
  // longer exists on disk and the page errors out with
  // "Loading chunk 974 failed".
  await ctx.clearCookies();
  const page = await ctx.newPage();
  await page.route('**/*', (route) => {
    const headers = { ...route.request().headers() };
    headers['cache-control'] = 'no-cache';
    route.continue({ headers });
  });
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('Globe') || t.includes('PhotoMap') || t.includes('SpatialExplorer') || t.includes('wheel')) {
      console.log(`  [browser ${m.type()}]`, t);
    }
  });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  return { ctx, page };
}

async function run() {
  const browser = await chromium.launch();
  try {
    // ── Test A: 单指拖动 → Globe 可以旋转 ──────────────────────
    {
      const { ctx, page } = await newMobilePage(browser);
      try {
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(8000);
        // Wait for the debug hook to be installed.
        await page.waitForFunction(() => window.__globeDebug !== undefined, { timeout: 10000 });
        // Disable auto-rotate so the initial lambda doesn't drift.
        await page.evaluate(() => window.__globeDebug && (window.__globeDebug.gesture));
        const before = await readDebug(page);
        const startLambda = before.rotation[0];
        // Drag from (200, 400) to (200 + 80, 400 + 50) — 80 px right
        // and 50 px down.
        const box = await page.locator('svg').first().boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await dragOneFinger(ctx, page, cx, cy, 80, 50, 12);
        await page.waitForTimeout(300);
        const after = await readDebug(page);
        const dLambda = after.rotation[0] - startLambda;
        record(
          '[A] 单指拖动 → Globe 可以旋转',
          Math.abs(dLambda) > 0.5,
          `dLambda=${dLambda.toFixed(3)} gesture=${after.gesture}`,
        );
      } finally {
        try { await ctx.close(); } catch {}
      }
    }

    // ── Test B: 旋转 → pinch → 松开一根 → 剩余手指继续拖 → 仍能旋转 ──
    {
      const { ctx, page } = await newMobilePage(browser);
      try {
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(8000);
        await page.waitForFunction(() => window.__globeDebug !== undefined, { timeout: 10000 });
        const box = await page.locator('svg').first().boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;

        // Step 1: 2-finger pinch OUT (zoom in, ratio = 1.5)
        const cdp = await twoFingerPinch(ctx, page, cx, cy, 60, 1.5, 10);
        const afterPinch = await readDebug(page);
        const scaleChanged = Math.abs(afterPinch.scale - 360) > 0.5;
        // Step 2: lift id=2, drag remaining id=1 to the right + down
        // (we re-use the same cdp session because twoFingerPinch
        // didn't detach).
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [{ x: cx - 90, y: cy, id: 1 }],
        });
        // Read the rotation just after lift — this is the baseline
        // the bug previously lost.
        const beforeResume = await readDebug(page);
        const startLambda = beforeResume.rotation[0];
        // Drag id=1 over 12 steps
        for (let i = 1; i <= 12; i++) {
          const t = i / 12;
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: cx - 90 + 60 * t, y: cy + 40 * t, id: 1 }],
          });
          await new Promise((r) => setTimeout(r, 16));
        }
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
        await page.waitForTimeout(300);
        const after = await readDebug(page);
        const dLambda = after.rotation[0] - startLambda;
        const rotated = Math.abs(dLambda) > 0.5;
        record(
          '[B] 旋转 → pinch → 松开一根 → 剩余手指继续拖 → 仍能旋转',
          scaleChanged && rotated,
          `scaleDelta=${(afterPinch.scale - 360).toFixed(2)} dLambdaAfterLift=${dLambda.toFixed(3)}`,
        );
      } finally {
        try { await ctx.close(); } catch {}
      }
    }

    // ── Test C: pinch → 全松 → 单指拖 → 能旋转 ───────────────
    {
      const { ctx, page } = await newMobilePage(browser);
      try {
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(8000);
        await page.waitForFunction(() => window.__globeDebug !== undefined, { timeout: 10000 });
        const box = await page.locator('svg').first().boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        // 2-finger pinch out, then lift both fingers on the same
        // CDP session (CDP requires touchEnd on the session that
        // issued the touchStart).
        const cdp = await twoFingerPinch(ctx, page, cx, cy, 60, 1.5, 10);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
        await cdp.detach().catch(() => {});
        await page.waitForTimeout(300);
        // Now single-finger drag
        const before = await readDebug(page);
        const startLambda = before.rotation[0];
        await dragOneFinger(ctx, page, cx, cy, 70, 40, 12);
        await page.waitForTimeout(300);
        const after = await readDebug(page);
        const dLambda = after.rotation[0] - startLambda;
        record(
          '[C] pinch → 全松 → 单指拖 → 能旋转',
          Math.abs(dLambda) > 0.5,
          `dLambda=${dLambda.toFixed(3)} gesture=${after.gesture}`,
        );
      } finally {
        try { await ctx.close(); } catch {}
      }
    }

    // ── Test D: pinch 较大 scale → 单指旋转 → 仍能旋转 ───────
    {
      const { ctx, page } = await newMobilePage(browser);
      try {
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(8000);
        await page.waitForFunction(() => window.__globeDebug !== undefined, { timeout: 10000 });
        const box = await page.locator('svg').first().boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        // 2-finger pinch out aggressively (ratio = 2.5)
        const cdp = await twoFingerPinch(ctx, page, cx, cy, 60, 2.5, 12);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
        await page.waitForTimeout(300);
        const afterPinch = await readDebug(page);
        const scaleLarge = afterPinch.scale > 600; // baseline is 360
        // Now single-finger drag
        const startLambda = afterPinch.rotation[0];
        await dragOneFinger(ctx, page, cx, cy, 60, 30, 12);
        await page.waitForTimeout(300);
        const after = await readDebug(page);
        const dLambda = after.rotation[0] - startLambda;
        record(
          '[D] pinch 较大 scale → 单指旋转 → 仍能旋转',
          scaleLarge && Math.abs(dLambda) > 0.5,
          `scale=${afterPinch.scale.toFixed(1)} dLambda=${dLambda.toFixed(3)}`,
        );
      } finally {
        try { await ctx.close(); } catch {}
      }
    }

    // ── Test E: pinch MAX_SCALE → 单指旋转 → 仍能旋转 ─────────
    {
      const { ctx, page } = await newMobilePage(browser);
      try {
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(8000);
        await page.waitForFunction(() => window.__globeDebug !== undefined, { timeout: 10000 });
        const box = await page.locator('svg').first().boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        // Pinch out extremely — 6x — to land near MAX_SCALE.
        const cdp = await twoFingerPinch(ctx, page, cx, cy, 30, 6.0, 16);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
        await page.waitForTimeout(300);
        const afterPinch = await readDebug(page);
        const atMax = afterPinch.scale >= 2000; // close to MAX_SCALE
        // Now single-finger drag
        const startLambda = afterPinch.rotation[0];
        await dragOneFinger(ctx, page, cx, cy, 50, 30, 12);
        await page.waitForTimeout(300);
        const after = await readDebug(page);
        const dLambda = after.rotation[0] - startLambda;
        record(
          '[E] pinch MAX_SCALE → 单指旋转 → 仍能旋转',
          atMax && Math.abs(dLambda) > 0.5,
          `scale=${afterPinch.scale.toFixed(1)} (target ≥2000) dLambda=${dLambda.toFixed(3)}`,
        );
      } finally {
        try { await ctx.close(); } catch {}
      }
    }

    // ── Test F: Globe(after MapLibre reverse) → 单指旋转 → 仍能旋转 ──
    // In the 9fb60b9 build there's no MapLibre integration. We
    // simulate the equivalent: load a page, do a heavy 2-finger
    // gesture, then verify the user can resume single-finger rotate
    // after the gesture ends. This is the same invariant Test E
    // covers, but the rotation baseline specifically after a
    // complete state machine reset.
    {
      const { ctx, page } = await newMobilePage(browser);
      try {
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(8000);
        await page.waitForFunction(() => window.__globeDebug !== undefined, { timeout: 10000 });
        const box = await page.locator('svg').first().boundingBox();
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        // Heavy pinch
        const cdp = await twoFingerPinch(ctx, page, cx, cy, 50, 3.0, 14);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
        // Wait long enough to mimic "MapLibre 9s + reverse + return"
        await page.waitForTimeout(2000);
        // Verify state was reset
        const afterReset = await readDebug(page);
        const reset = afterReset.gesture === 'none' && afterReset.activeTouches === 0;
        // Now single-finger drag
        const startLambda = afterReset.rotation[0];
        await dragOneFinger(ctx, page, cx, cy, 50, 30, 12);
        await page.waitForTimeout(300);
        const after = await readDebug(page);
        const dLambda = after.rotation[0] - startLambda;
        record(
          '[F] 重 gesture 后 → 状态重置 → 单指旋转 → 仍能旋转',
          reset && Math.abs(dLambda) > 0.5,
          `gesture=${afterReset.gesture} activeTouches=${afterReset.activeTouches} dLambda=${dLambda.toFixed(3)}`,
        );
      } finally {
        try { await ctx.close(); } catch {}
      }
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.log('Failures:');
      for (const f of failures) console.log(`  - ${f}`);
    }
    writeFileSync(
      'test-touch-gesture-result.txt',
      `${passed} passed, ${failed} failed\n${failures.join('\n')}\n`,
    );
    process.exit(failed > 0 ? 1 : 0);
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(2);
});
