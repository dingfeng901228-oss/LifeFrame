// Frank #7243 review: a11y audit via axe-core. Run against
// the production deployment (https://lifeframe.frank2025.com)
// because local dev has HMR / dev tooling that masks a11y
// issues. Walks the main public routes and the auth-gated
// ones (we test the redirect behavior too).
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'https://lifeframe.frank2025.com';
const ROUTES = [
  { path: '/', label: 'home' },
  { path: '/welcome', label: 'welcome' },
  { path: '/stats', label: 'stats' },
  { path: '/login', label: 'login' },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const allResults = [];

for (const route of ROUTES) {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000); // Let Globe / MapLibre / SVGs settle
    // Frank #7243 review: force the theme to resolve so axe sees
    // consistent colors. The app's inline theme bootstrap reads
    // localStorage + prefers-color-scheme; if for any reason that
    // script didn't add .light / .dark to <html>, nudge it here
    // so axe isn't comparing text against a body bg of #000
    // (the :root default) when the page is really in light mode.
    const htmlClass = await page.evaluate(() => document.documentElement.className);
    if (htmlClass !== 'light' && htmlClass !== 'dark') {
      await page.evaluate(() => {
        const v = localStorage.getItem('lifeframe-theme');
        const resolved = v === 'light' || v === 'dark'
          ? v
          : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        document.documentElement.classList.add(resolved);
      });
      await page.waitForTimeout(300);
    }
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'])
      .analyze();
    allResults.push({
      route: route.path,
      label: route.label,
      url: page.url(),
      violations: results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.length,
        sample: v.nodes.slice(0, 3).map((n) => n.html),
      })),
      passes: results.passes.length,
      incomplete: results.incomplete.length,
      inapplicable: results.inapplicable.length,
    });
    await page.close();
  } catch (e) {
    allResults.push({ route: route.path, label: route.label, error: String(e).slice(0, 200) });
    await page.close().catch(() => {});
  }
}

await browser.close();
writeFileSync('F:/WebSite/LifeFrame_photo_websit/screenshots/axe-report.json', JSON.stringify(allResults, null, 2));
console.log(JSON.stringify(allResults, null, 2));