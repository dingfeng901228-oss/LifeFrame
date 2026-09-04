// Self-test script for Phase 10 performance audit.
//
// Measures Web Vitals + custom timings across 6 viewports
// (desktop 1920/1366/1024, tablet 768, mobile 390/430):
//
//   Standard (all viewports):
//     TTFB              Time to First Byte (ms)
//     FCP               First Contentful Paint (ms)
//     DCL               DOMContentLoaded (ms)
//     Load              loadEventEnd (ms)
//     Globe ready       time until ≥1 marker visible (ms)
//     Resources         count of network resources loaded
//     Transfer          sum of Content-Length headers (KB)
//
//   Custom (desktop 1920 + mobile 390 only):
//     PhotoViewer open  click marker → [role=dialog] visible (ms)
//
// We deliberately skip LCP because it requires a
// PerformanceObserver installed via initScript (adds complexity
// without changing the pass/fail story for an informational
// audit). Phase 10 is non-blocking — exit 0 regardless of
// pass/fail count so the orchestrator's other suites don't get
// dragged down by a slow dev server.
//
// Web Vitals "good" thresholds sourced from web.dev/vitals.
//
// Run with dev server up:
//   npm run dev   # in one terminal
//   node scripts/perf-audit.mjs   # in another

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.LIFEFRAME_BASE ?? 'http://localhost:3000';
const OUT = 'screenshots';

await mkdir(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop-1920', width: 1920, height: 1080, kind: 'desktop' },
  { name: 'desktop-1366', width: 1366, height: 768, kind: 'desktop' },
  { name: 'desktop-1024', width: 1024, height: 768, kind: 'desktop' },
  { name: 'tablet-768', width: 768, height: 1024, kind: 'tablet' },
  { name: 'mobile-390', width: 390, height: 844, kind: 'mobile' },
  { name: 'mobile-430', width: 430, height: 932, kind: 'mobile' },
];

// Web Vitals "good" thresholds (web.dev/vitals)
const T = {
  ttfb: 800,
  fcp: 1800,
  dcl: 5000,
  load: 10000,
  globeReady: 6000,
  photoOpen: 1500,
  transferKB: 2048, // 2MB
  resourceCount: 100,
};

const rows = [];
function record(name, value, ok, threshold) {
  const detail =
    threshold != null ? `${value} (≤ ${threshold})` : `${value}`;
  rows.push({ name, value, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}: ${detail}`);
}

const browser = await chromium.launch();

try {
  for (const vp of VIEWPORTS) {
    console.log(`\n--- ${vp.name} (${vp.width}x${vp.height}) ---`);
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      isMobile: vp.kind === 'mobile',
      hasTouch: vp.kind === 'mobile',
    });
    const page = await ctx.newPage();

    let transferSize = 0;
    page.on('response', (response) => {
      try {
        const len = response.headers()['content-length'];
        if (len) transferSize += parseInt(len, 10);
      } catch {
        // some responses don't expose content-length; ignore
      }
    });

    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500); // Supabase + globe + MapLibre warmup

    // ── Web Vitals via Performance Timeline ────────────────────
    const vitals = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByType('paint');
      const fcp = paint.find((p) => p.name === 'first-contentful-paint');
      return {
        ttfb: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
        fcp: fcp ? Math.round(fcp.startTime) : null,
        dcl: nav
          ? Math.round(nav.domContentLoadedEventEnd - nav.startTime)
          : null,
        load: nav ? Math.round(nav.loadEventEnd - nav.startTime) : null,
        resourceCount: performance.getEntriesByType('resource').length,
      };
    });

    // ── Globe marker-ready (custom) ────────────────────────────
    // Poll up to 50 × 200ms = 10s for ≥1 visible marker.
    const markerStart = Date.now();
    let markerReadyMs = null;
    const markerLocator = page.locator(
      'svg g[style*="cursor: pointer"]',
    );
    for (let i = 0; i < 50; i++) {
      const total = await markerLocator.count();
      for (let j = 0; j < total; j++) {
        const v = await markerLocator
          .nth(j)
          .isVisible()
          .catch(() => false);
        if (v) {
          markerReadyMs = Date.now() - markerStart;
          break;
        }
      }
      if (markerReadyMs != null) break;
      await page.waitForTimeout(200);
    }

    record(
      `[${vp.name}] TTFB (ms)`,
      vitals.ttfb ?? 'N/A',
      vitals.ttfb != null && vitals.ttfb <= T.ttfb,
      T.ttfb,
    );
    record(
      `[${vp.name}] FCP (ms)`,
      vitals.fcp ?? 'N/A',
      vitals.fcp != null && vitals.fcp <= T.fcp,
      T.fcp,
    );
    record(
      `[${vp.name}] DCL (ms)`,
      vitals.dcl ?? 'N/A',
      vitals.dcl != null && vitals.dcl <= T.dcl,
      T.dcl,
    );
    record(
      `[${vp.name}] Load (ms)`,
      vitals.load ?? 'N/A',
      vitals.load != null && vitals.load <= T.load,
      T.load,
    );
    record(
      `[${vp.name}] Globe marker ready (ms)`,
      markerReadyMs ?? 'timeout',
      markerReadyMs != null && markerReadyMs <= T.globeReady,
      T.globeReady,
    );
    record(
      `[${vp.name}] Resources loaded`,
      vitals.resourceCount,
      vitals.resourceCount <= T.resourceCount,
      T.resourceCount,
    );
    record(
      `[${vp.name}] Transfer size (KB)`,
      Math.round(transferSize / 1024),
      transferSize / 1024 <= T.transferKB,
      T.transferKB,
    );

    await page.screenshot({
      path: `${OUT}/perf-${vp.name}.png`,
      fullPage: false,
    });

    // ── PhotoViewer open latency (desktop 1920 + mobile 390) ──
    if (
      markerReadyMs != null &&
      (vp.name === 'desktop-1920' || vp.name === 'mobile-390')
    ) {
      const clickStart = Date.now();
      await markerLocator.first().click({ force: true });
      await page.waitForTimeout(800);
      const thumb = page.locator('button img').first();
      if ((await thumb.count()) > 0) {
        await thumb.click({ force: true });
        await page.waitForTimeout(800);
      }
      const modal = await page.locator('[role="dialog"]').count();
      if (modal > 0) {
        const openMs = Date.now() - clickStart;
        record(
          `[${vp.name}] PhotoViewer open (ms)`,
          openMs,
          openMs <= T.photoOpen,
          T.photoOpen,
        );
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }

    await ctx.close();
  }
} catch (err) {
  console.error('Suite threw:', String(err?.message ?? err));
} finally {
  await browser.close();
}

// ── Summary ────────────────────────────────────────────────────
const passed = rows.filter((r) => r.ok).length;
console.log(`\n=== Summary ===`);
console.log(
  `${passed}/${rows.length} thresholds met (Phase 10 is informational, not blocking)`,
);

// Top 5 metrics by raw value — quick triage even when "good".
const numeric = rows.filter((r) => typeof r.value === 'number');
const sorted = [...numeric].sort((a, b) => b.value - a.value);
console.log(`\n=== Top 5 by raw value ===`);
sorted.slice(0, 5).forEach((r) => {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}: ${r.value}`);
});

process.exit(0);
