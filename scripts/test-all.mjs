// Self-test orchestrator (Phase 9).
//
// Runs all Phase 7/8 + PhotoViewer test scripts sequentially
// and aggregates results into a single summary. Exit code 0
// iff all child scripts exit 0.
//
// Sub-suites:
//   - test-permissions.mjs       (Phase 7: auth gate)
//   - test-photo-viewer.mjs      (PhotoViewer modal — cluster
//                                 context + keyboard + URL sync)
//   - test-viewer-responsive.mjs (Phase 8 follow-up: PhotoViewer
//                                 responsive viewports)
//   - test-spatial-mobile.mjs    (Phase 8: multi-viewport
//                                 spatial UI baseline)
//   - test-auth-matrix.mjs       (Phase 9: spec §53 full auth
//                                 matrix — anon + manual auth)
//
// Run with dev server up:
//   npm run dev   # in one terminal
//   node scripts/test-all.mjs   # in another
//
// Filter to a single suite via CLI arg:
//   node scripts/test-all.mjs auth-matrix

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  'test-permissions.mjs',
  'test-photo-viewer.mjs',
  'test-viewer-responsive.mjs',
  'test-spatial-mobile.mjs',
  'test-auth-matrix.mjs',
];

const arg = process.argv[2];
const filtered = arg
  ? SUITES.filter((s) => s.includes(arg))
  : SUITES;

if (filtered.length === 0) {
  console.error(
    `No suite matches "${arg}". Available:\n  ${SUITES.join('\n  ')}`,
  );
  process.exit(2);
}

const startedAt = Date.now();
const results = [];

for (const suite of filtered) {
  console.log(`\n=== ${suite} ===`);
  const t0 = Date.now();
  const code = await new Promise((resolve) => {
    const proc = spawn('node', [join(__dirname, suite)], {
      cwd: __dirname,
      stdio: 'inherit',
      env: process.env,
    });
    proc.on('close', (c) => resolve(c ?? 1));
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  results.push({ suite, code, elapsed });
  console.log(`--- ${suite} exited ${code} (${elapsed}s)`);
}

const totalElapsed = ((Date.now() - startedAt) / 60).toFixed(1);
const passed = results.filter((r) => r.code === 0).length;
const failed = results.length - passed;

console.log(`\n=== Orchestrator Summary ===`);
console.log(`${passed}/${results.length} suites passed in ${totalElapsed}m`);
results.forEach((r) => {
  const icon = r.code === 0 ? '✓' : '✗';
  console.log(`  ${icon} ${r.suite} (${r.elapsed}s)`);
});

process.exit(failed > 0 ? 1 : 0);
