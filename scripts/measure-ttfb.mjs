// Frank #7243 round-2: TTFB measurement for the production site.
//
// The site is served through Cloudflare (proxy on) → Vercel. This
// script samples TTFB for the key routes and prints the median,
// so before/after changes can be compared objectively.
//
// USAGE
//   node scripts/measure-ttfb.mjs            # default: 6 samples/route
//   node scripts/measure-ttfb.mjs 12         # more samples
//
// It also probes Vercel's anycast directly with --resolve, which
// simulates what the site would look like with the Cloudflare
// proxy turned off (DNS-only). That's the "expected" number once
// the DNS record is changed.

const SAMPLES = Number(process.argv[2] || 6);
const HOST = 'lifeframe.frank2025.com';
const VERCEL_IP = '76.76.21.21'; // Vercel anycast
const ROUTES = ['/', '/welcome', '/stats', '/login', '/sw.js'];

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function sample(url, extra = []) {
  const t0 = performance.now();
  const res = await fetch(url, { redirect: 'manual', ...extra });
  const ttfb = Number(res.headers.get('x-measured-ttfb') || 0);
  await res.arrayBuffer();
  return { ms: performance.now() - t0, status: res.status };
}

// Use curl for the timing (fetch doesn't expose TTFB separately).
async function curlTtfb(url, resolveIp) {
  const { execFile } = await import('node:child_process');
  const args = ['-s', '-o', 'NUL', '--max-time', '25', '-w', '%{time_starttransfer} %{http_code}'];
  if (resolveIp) args.push('--resolve', `${HOST}:443:${resolveIp}`);
  args.push(url);
  const out = await new Promise((res) => {
    execFile('curl', args, (err, stdout) => res(stdout));
  });
  const [t, code] = out.trim().split(/\s+/);
  return { ttfb: Number(t), status: Number(code) };
}

console.log(`TTFB measurement — ${SAMPLES} samples per route`);
console.log(`host: ${HOST}\n`);

for (const route of ROUTES) {
  const viaCf = [];
  const viaDirect = [];
  for (let i = 0; i < SAMPLES; i++) {
    const a = await curlTtfb(`https://${HOST}${route}`);
    viaCf.push(a.ttfb);
    const b = await curlTtfb(`https://${HOST}${route}`, VERCEL_IP);
    viaDirect.push(b.ttfb);
  }
  const f = (x) => `${(median(x) * 1000).toFixed(0)}ms`;
  console.log(
    `  ${route.padEnd(10)} CF:${f(viaCf).padStart(7)}  Vercel-direct:${f(viaDirect).padStart(7)}` +
      `   [min ${(Math.min(...viaCf) * 1000).toFixed(0)} / max ${(Math.max(...viaCf) * 1000).toFixed(0)}]`,
  );
}
console.log('\n"CF" = current (Cloudflare proxy on).');
console.log('"Vercel-direct" = simulated DNS-only → Vercel anycast.');
