// Self-test script for Phase 10 bundle audit (post-build).
//
// Reads .next/build-manifest.json + .next/app-build-manifest.json +
// .next/static/chunks/ to enumerate chunks and their on-disk sizes.
// Identifies the top-N largest chunks so Frank can prioritize
// code-splitting / tree-shaking work.
//
// Informational only — prints a table, exits 0. Run AFTER
// `npm run build` (otherwise .next/ doesn't exist).
//
// Usage:
//   npm run build   # generate .next/
//   node scripts/bundle-audit.mjs   # print chunk table

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const NEXT_DIR = join(ROOT, '.next');

if (!existsSync(NEXT_DIR)) {
  console.error(
    `.next/ not found. Run \`npm run build\` first to generate the build output.`,
  );
  process.exit(2);
}

console.log('=== Bundle audit (informational) ===\n');

// Walk .next/static/chunks/ recursively and collect {path, bytes}.
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const chunks = [];
for (const file of walk(join(NEXT_DIR, 'static'))) {
  try {
    const bytes = statSync(file).size;
    if (bytes > 0) chunks.push({ file, bytes });
  } catch {
    // ignore
  }
}

chunks.sort((a, b) => b.bytes - a.bytes);
const totalBytes = chunks.reduce((s, c) => s + c.bytes, 0);
const totalKB = (totalBytes / 1024).toFixed(1);

console.log(`Total chunks: ${chunks.length}`);
console.log(`Total bundle size: ${totalKB} KB\n`);

console.log('=== Top 20 largest chunks ===');
console.log(
  '  Size (KB)   Type                              File',
);
console.log(
  '  ---------   -------------------------------   -----------------------------------',
);
chunks.slice(0, 20).forEach((c) => {
  const rel = c.file.replace(NEXT_DIR + '\\', '').replace(/\\/g, '/');
  const kb = (c.bytes / 1024).toFixed(1).padStart(8);
  const type = rel.includes('chunks/app/')
    ? 'app route'
    : rel.includes('chunks/framework-')
      ? 'framework'
    : rel.includes('chunks/main-')
      ? 'main'
      : rel.includes('chunks/webpack-')
        ? 'webpack runtime'
        : rel.includes('chunks/pages/')
          ? 'pages route'
          : rel.includes('chunks/lib/')
            ? 'shared lib'
            : 'other';
  console.log(`  ${kb}    ${type.padEnd(31)}   ${rel}`);
});

// Try to read build-manifest.json for route → chunk mapping.
const buildManifestPath = join(NEXT_DIR, 'app-build-manifest.json');
if (existsSync(buildManifestPath)) {
  console.log('\n=== Route → chunk mapping (top 10 by chunk count) ===');
  try {
    const manifest = JSON.parse(readFileSync(buildManifestPath, 'utf8'));
    const routes = Object.entries(manifest.pages ?? {});
    const sortedRoutes = routes
      .map(([route, files]) => ({ route, count: files.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    sortedRoutes.forEach((r) => {
      console.log(`  ${String(r.count).padStart(3)} chunks  ${r.route}`);
    });
  } catch (err) {
    console.warn('  Could not parse app-build-manifest.json:', err.message);
  }
}

console.log('\n=== Optimization suggestions ===');
console.log(
  '  • If a shared-lib chunk > 150KB, consider splitting heavy deps',
);
console.log(
  '    (maplibre-gl ~600KB, d3-geo, world-atlas) with dynamic imports.',
);
console.log(
  '  • If app route chunks cluster > 100KB, look for barrel re-exports',
);
console.log(
  '    pulling unused code into the route.',
);
console.log(
  '  • Use @next/bundle-analyzer (npm i -D @next/bundle-analyzer) for',
);
console.log(
  '    a treemap visualization once a baseline size is committed.',
);

process.exit(0);
