// Frank #7243 round-5: a11y audit of the Places panel in its OPEN
// state.
//
// The regular audit (scripts/audit-a11y.mjs) loads a page and scans
// it as-is — the Places panel only exists after a marker click, so
// it was never covered. This script opens the panel, then runs
// axe-core over the page with the panel visible.
//
//   node scripts/audit-place-panel.mjs            # local
//   LF_BASE=https://lifeframe.frank2025.com node scripts/audit-place-panel.mjs

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');
const AXE_SOURCE = readFileSync(axePath, 'utf8');

const BASE = process.env.LF_BASE || 'http://localhost:3000';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const report = { base: BASE, viewports: [] };

for (const vp of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Wait for the client-side photo fetch to land the markers.
  await page.waitForTimeout(9000);

  // Click the first clickable marker group (the Globe draws one <g>
  // per marker with `cursor: pointer`).
  const opened = await page.evaluate(() => {
    const groups = Array.from(document.querySelectorAll('g')).filter(
      (g) => (g.getAttribute('style') || '').includes('cursor: pointer'),
    );
    const visible = groups.filter((g) => {
      const c = g.querySelector('circle');
      const r = c?.getBoundingClientRect();
      return r && r.width > 0 && r.top > 120 && r.bottom < window.innerHeight * 0.8;
    });
    if (!visible.length) return false;
    visible[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  await page.waitForTimeout(1500);

  const panelOpen = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('[role=dialog]')).some(
        (d) => d.getBoundingClientRect().width > 0,
      ),
  );

  await page.addScriptTag({ content: AXE_SOURCE });
  const result = await page.evaluate(async () => {
    // @ts-ignore — injected global
    const res = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return {
      violations: res.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        sample: v.nodes.slice(0, 2).map((n) => n.html.slice(0, 160)),
      })),
      passes: res.passes.length,
    };
  });

  report.viewports.push({
    viewport: vp.name,
    markerClicked: opened,
    panelOpen,
    violations: result.violations,
    passes: result.passes,
  });

  console.log(
    `  ${vp.name.padEnd(8)} marker=${opened ? 'ok' : 'none'} panel=${
      panelOpen ? 'open' : 'MISSING'
    } violations=${result.violations.length}`,
  );
  for (const v of result.violations) {
    console.log(`      - ${v.id} (${v.impact}) nodes=${v.nodes}`);
    for (const s of v.sample) console.log(`        ${s}`);
  }
}

await browser.close();
writeFileSync(
  'F:/WebSite/LifeFrame_photo_websit/screenshots/axe-place-panel.json',
  JSON.stringify(report, null, 2),
);

const total = report.viewports.reduce((s, v) => s + v.violations.length, 0);
console.log(`\nTOTAL violations: ${total}`);
if (total > 0) process.exitCode = 1;
