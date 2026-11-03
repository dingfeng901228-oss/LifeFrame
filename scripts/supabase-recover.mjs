// Frank #7243 round-2: end-to-end Supabase recovery.
//
// The Supabase project that held LifeFrame's photo metadata was
// deleted (DNS for *.supabase.co returns NXDOMAIN for that ref,
// identically to a randomly-invented ref). The Cloudflare R2
// bucket with the actual photo files is intact, so the metadata
// can be rebuilt from the images' EXIF.
//
// This script drives the whole recovery through the Supabase
// Management API so it is one command, not a checklist.
//
//   1. diagnose  — what actually happened to the project?
//   2. restore   — bring a PAUSED project back (data intact)
//      -- or --
//   3. create    — make a fresh project (deleted = data gone)
//   4. schema    — apply infra/restore-all.sql
//   5. reindex   — rebuild the photos table from R2
//   6. env       — write the new URL + keys into .env.local
//
// USAGE
//   # 1. Frank creates a personal access token:
//   #    https://supabase.com/dashboard/account/tokens
//   #    and puts it in .env.local as:
//   #      SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxx
//   # 2. Then:
//   node scripts/supabase-recover.mjs diagnose
//   node scripts/supabase-recover.mjs restore      # if paused
//   node scripts/supabase-recover.mjs create       # if deleted
//   node scripts/supabase-recover.mjs schema
//   node scripts/supabase-recover.mjs env       <- writes the new URL + keys
//   node scripts/supabase-recover.mjs reindex   <- reads them back
//
// SAFETY
//   - This script never deletes anything.
//   - Secrets are never printed. The anon + service_role keys
//     are written straight into .env.local (gitignored) and only
//     their first 6 characters are echoed so you can eyeball
//     which key landed where.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const API = 'https://api.supabase.com/v1';
const TARGET_REF = 'utikkddqzilphrsszjpw';
const SCHEMA_FILE = 'infra/restore-all.sql';
const ENV_FILE = '.env.local';

// ── env ────────────────────────────────────────────────────────────────────
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnvFile(ENV_FILE);

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error(
    '✗ SUPABASE_ACCESS_TOKEN not set.\n' +
      '  Create one at https://supabase.com/dashboard/account/tokens\n' +
      '  and add this line to .env.local (gitignored, never committed):\n' +
      '    SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxx',
  );
  process.exit(1);
}

async function mgmt(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const msg = json?.message ?? json?.error ?? text?.slice(0, 300) ?? res.statusText;
    const e = new Error(`Management API ${init.method ?? 'GET'} ${path} → ${res.status}: ${msg}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

// ── commands ───────────────────────────────────────────────────────────────
async function diagnose() {
  console.log('→ listing your Supabase projects…');
  const projects = await mgmt('/projects');
  console.log(`  ${projects.length} project(s):`);
  for (const p of projects) {
    console.log(
      `    ${p.ref}  ${p.name.padEnd(28)} ${p.status}${
        p.region ? '  ' + p.region : ''
      }`,
    );
  }
  const hit = projects.find((p) => p.ref === TARGET_REF);
  console.log('');
  if (hit) {
    console.log(`→ target ${TARGET_REF}: FOUND, status = ${hit.status}`);
    console.log('');
    if (hit.status === 'ACTIVE_HEALTHY') {
      console.log('  The project is alive. Something else is wrong — run');
      console.log('  scripts/check-r2-exif.mjs and check the Vercel env vars.');
    } else if (/PAUSED|INACTIVE|COMING_UP|RESTORING/i.test(hit.status)) {
      // IMPORTANT: a paused project's subdomain stops resolving DNS,
      // so NXDOMAIN from the outside looks exactly like "deleted".
      // Only the Management API can tell them apart — always
      // diagnose here before concluding anything.
      console.log('  It was PAUSED, not deleted — the data is intact.');
      console.log('  (Free-tier projects are paused after a period of');
      console.log('   inactivity, and a paused subdomain stops resolving.)');
      console.log('  Run:  node scripts/supabase-recover.mjs restore');
      console.log('  Then poll until the status flips to ACTIVE_HEALTHY.');
    } else {
      console.log(`  Unexpected status. Restore versions available? checking…`);
      try {
        const v = await mgmt(`/projects/${TARGET_REF}/restore`);
        console.log(`  restore versions: ${JSON.stringify(v).slice(0, 400)}`);
      } catch (e) {
        console.log(`  (${e.message})`);
      }
    }
  } else {
    console.log(`→ target ${TARGET_REF}: NOT in the list.`);
    console.log('');
    console.log('  The project was DELETED (not merely paused).');
    console.log('  Supabase removes the database and its backups on delete,');
    console.log('  so the old metadata cannot be recovered from Supabase.');
    console.log('');
    console.log('  The photos themselves are safe in R2 — this script can');
    console.log('  rebuild the whole table from their EXIF:');
    console.log('');
    console.log('    node scripts/supabase-recover.mjs create');
    console.log('    node scripts/supabase-recover.mjs schema');
    console.log('    node scripts/supabase-recover.mjs reindex');
    console.log('    node scripts/supabase-recover.mjs env');
  }
  return projects;
}

async function restore() {
  console.log(`→ restoring ${TARGET_REF}…`);
  await mgmt(`/projects/${TARGET_REF}/restore`, { method: 'POST' });
  console.log('  ✓ restore requested. The project takes 1–3 minutes to come back.');
  console.log('  Poll with:  node scripts/supabase-recover.mjs diagnose');
}

async function create() {
  console.log('→ looking up your organizations…');
  const orgs = await mgmt('/organizations');
  if (!orgs.length) {
    console.error('✗ no organizations found on this account.');
    process.exit(1);
  }
  const org = orgs[0];
  console.log(`  using org: ${org.name} (${org.slug})`);

  // A 32-char random DB password. Written to .env.local at the end.
  const dbPass =
    'L' +
    Array.from({ length: 31 }, () =>
      'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[
        Math.floor(Math.random() * 55)
      ],
    ).join('');

  console.log('→ creating project (this takes a couple of minutes)…');
  const payload = {
    organization_slug: org.slug,
    name: 'lifeframe',
    db_pass: dbPass,
  };
  let created;
  try {
    created = await mgmt('/projects', {
      method: 'POST',
      body: JSON.stringify({ ...payload, region: 'ap-northeast-1' }),
    });
  } catch (e) {
    // The Tokyo region isn't offered to every org — fall back to
    // whatever region Supabase picks by default.
    console.log(`  (${e.message.split('\n')[0].slice(0, 120)})`);
    console.log('  → retrying without an explicit region…');
    created = await mgmt('/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
  console.log(`  ✓ created: ${created.ref}  (${created.status})`);
  writeEnv({
    NEW_SUPABASE_REF: created.ref,
    SUPABASE_DB_PASSWORD: dbPass,
  });
  console.log('  → ref + db password written to .env.local');
  console.log('');
  console.log('  Next:');
  console.log('    node scripts/supabase-recover.mjs schema');
  console.log('    node scripts/supabase-recover.mjs env');
  console.log('    node scripts/supabase-recover.mjs reindex');
}

async function schema() {
  const ref = process.env.NEW_SUPABASE_REF || TARGET_REF;
  console.log(`→ applying ${SCHEMA_FILE} to ${ref}…`);
  const sql = readFileSync(SCHEMA_FILE, 'utf-8');
  // The Management API executes one statement per call for
  // safety, so split on top-level semicolons.
  // Drop comment-only statements: the Management API rejects a
  // query that isn't a statement ("query must be a SELECT, INSERT,
  // UPDATE, DELETE, or DDL command").
  const stmts = splitSql(sql).filter((s) => {
    const stripped = s
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .trim();
    return stripped.length > 0;
  });
  console.log(`  ${stmts.length} statements`);
  let ok = 0;
  for (const [i, s] of stmts.entries()) {
    const res = await mgmt(`/projects/${ref}/database/query`, {
      method: 'POST',
      body: JSON.stringify({ query: s }),
    });
    if (res?.error) {
      console.error(`  ✗ stmt ${i + 1}: ${res.error} — ${s.slice(0, 90).replace(/\n/g, ' ')}`);
      process.exit(1);
    }
    ok++;
  }
  console.log(`  ✓ ${ok}/${stmts.length} statements applied`);
}

// Split a SQL file into statements, ignoring semicolons inside
// string literals, dollar-quoted blocks, or comments.
function splitSql(sql) {
  const out = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      buf += c;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        buf += c + next;
        i++;
        continue;
      }
      buf += c;
      continue;
    }
    if (dollarTag) {
      buf += c;
      if (c === '$' && sql.startsWith(dollarTag, i)) {
        buf += sql.slice(i + 1, i + dollarTag.length);
        i += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }
    if (inSingle) {
      buf += c;
      if (c === "'" && sql[i + 1] === "'") {
        buf += next;
        i++;
      } else if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      buf += c;
      if (c === '"' && sql[i + 1] === '"') {
        buf += next;
        i++;
      } else if (c === '"') inDouble = false;
      continue;
    }
    if (c === '-' && next === '-') {
      inLineComment = true;
      buf += c;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      buf += c + next;
      i++;
      continue;
    }
    if (c === "'") inSingle = true;
    if (c === '"') inDouble = true;
    if (c === '$') {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        dollarTag = m[0];
        buf += m[0];
        i += m[0].length - 1;
        continue;
      }
    }
    if (c === ';') {
      const t = buf.trim();
      if (t) out.push(t);
      buf = '';
      continue;
    }
    buf += c;
  }
  const t = buf.trim();
  if (t) out.push(t);
  return out;
}

async function reindex() {
  const ref = process.env.NEW_SUPABASE_REF || TARGET_REF;
  console.log(`→ re-indexing R2 → ${ref}`);
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(
    process.execPath,
    ['scripts/reindex-r2-to-supabase.mjs', '--geocode'],
    { stdio: 'inherit', env: process.env },
  );
  if (r.status !== 0) {
    console.error('✗ reindex failed — see the output above.');
    process.exit(r.status ?? 1);
  }
}

async function env() {
  const ref = process.env.NEW_SUPABASE_REF || TARGET_REF;
  console.log(`→ fetching API keys for ${ref}…`);
  const keys = await mgmt(`/projects/${ref}/api-keys?reveal=true`);
  const anon = keys.find((k) => k.type === 'anon');
  const svc = keys.find((k) => k.type === 'service_role');
  if (!anon || !svc) {
    console.error('✗ could not read anon / service_role keys from the API.');
    console.error('  Keys found:', keys.map((k) => k.type).join(', ') || 'none');
    process.exit(1);
  }
  const url = `https://${ref}.supabase.co`;
  writeEnv({
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon.api_key,
    SUPABASE_SERVICE_ROLE_KEY: svc.api_key,
  });
  console.log(`  ✓ ${ENV_FILE} updated`);
  console.log(`    NEXT_PUBLIC_SUPABASE_URL      = ${url}`);
  console.log(`    NEXT_PUBLIC_SUPABASE_ANON_KEY = ${anon.api_key.slice(0, 6)}…`);
  console.log(`    SUPABASE_SERVICE_ROLE_KEY     = ${svc.api_key.slice(0, 6)}…`);
  console.log('');
  console.log('  Next: update the same three values in the Vercel project');
  console.log('  (Settings → Environment Variables) and redeploy.');
}

// ── .env.local writer ──────────────────────────────────────────────────────
function writeEnv(values) {
  let content = existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, 'utf-8')
    : '';
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null) continue;
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    if (re.test(content)) content = content.replace(re, line);
    else content += `\n${line}\n`;
  }
  writeFileSync(ENV_FILE, content, 'utf-8');
}

// ── main ───────────────────────────────────────────────────────────────────
const cmd = process.argv[2] ?? 'diagnose';
const commands = { diagnose, restore, create, schema, reindex, env };
if (!commands[cmd]) {
  console.error(`✗ unknown command "${cmd}"`);
  console.error('  available: ' + Object.keys(commands).join(', '));
  process.exit(1);
}
try {
  await commands[cmd]();
} catch (e) {
  console.error(`✗ ${e.message}`);
  if (e.status === 401 || e.status === 403) {
    console.error('  The access token was rejected. Create a fresh one at');
    console.error('  https://supabase.com/dashboard/account/tokens');
  }
  process.exit(1);
}
