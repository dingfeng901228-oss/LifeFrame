// Frank #7243 review: lighthouse audit via chrome-launcher.
// Uses desktop preset, mobile preset, and runs the 4 key
// routes. Each route gets full Performance/SEO/A11y/Best
// Practices scores. Output to console + JSON file.
import { chromium } from 'playwright';
import lighthouse from 'lighthouse';
import { writeFileSync } from 'node:fs';

const BASE = 'https://lifeframe.frank2025.com';
const ROUTES = [
  { path: '/', label: 'home' },
  { path: '/welcome', label: 'welcome' },
  { path: '/stats', label: 'stats' },
  { path: '/login', label: 'login' },
];

// Lighthouse needs a CDP-compatible browser, but we can
// also use the chrome-launcher to spawn chrome directly.
// Use playwright chromium to get the debugging port.
const browser = await chromium.launch({
  args: ['--remote-debugging-port=9222'],
});
const port = 9222;
const results = [];

for (const route of ROUTES) {
  for (const formFactor of ['desktop', 'mobile']) {
    const config = formFactor === 'mobile'
      ? { extends: 'lighthouse:default', settings: { formFactor: 'mobile', screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }, throttlingMethod: 'simulate', throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 } } }
      : { extends: 'lighthouse:default', settings: { formFactor: 'desktop', screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }, throttling: { rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 } } };
    try {
      const r = await lighthouse(`${BASE}${route.path}`, { port, output: 'json', logLevel: 'error' }, config);
      const lhr = r.lhr;
      const cats = lhr.categories;
      results.push({
        route: route.path,
        label: route.label,
        formFactor,
        scores: {
          performance: Math.round(cats.performance.score * 100),
          accessibility: Math.round(cats.accessibility.score * 100),
          bestPractices: Math.round(cats['best-practices'].score * 100),
          seo: Math.round(cats.seo.score * 100),
        },
        audits: {
          lcp: lhr.audits['largest-contentful-paint']?.displayValue,
          cls: lhr.audits['cumulative-layout-shift']?.displayValue,
          fcp: lhr.audits['first-contentful-paint']?.displayValue,
          tbt: lhr.audits['total-blocking-time']?.displayValue,
        },
      });
    } catch (e) {
      results.push({ route: route.path, formFactor, error: String(e).slice(0, 200) });
    }
  }
}

await browser.close();
writeFileSync('F:/WebSite/LifeFrame_photo_websit/screenshots/lighthouse-report.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));