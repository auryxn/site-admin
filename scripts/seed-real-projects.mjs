/*
 * scripts/seed-real-projects.mjs
 * -------------------------------------------------------------
 * Uploads the real project screenshots to the running admin API
 * (POST /api/admin/upload, base64) and writes data/project_media.json
 * mapping project title -> { image_url, repo_url }.
 *
 * server/db.js reads that map on every open and backfills the
 * projects.image_url / projects.repo_url columns (idempotent).
 *
 * Usage (server must be running, default http://localhost:4200):
 *   node scripts/seed-real-projects.mjs [BASE_URL]
 *   BASE_URL=http://localhost:4200 node scripts/seed-real-projects.mjs
 *
 * Nothing here deletes data. Re-running re-uploads and refreshes the map.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WORKSPACE = path.resolve(ROOT, '..', '..');
const SHOTS = path.join(WORKSPACE, 'screenshots');
const DATA_DIR = path.join(ROOT, 'data');
const MEDIA_PATH = path.join(DATA_DIR, 'project_media.json');

const BASE_URL = (process.env.BASE_URL || process.argv[2] || 'http://localhost:4200').replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

const GITHUB = 'https://github.com/auryxn';

// project title -> screenshot path (relative to screenshots/) + repo slug
const PROJECTS = [
  { title: 'site-admin', shot: 'site-admin/home.png', repo: 'site-admin' },
  { title: 'velora-cafe', shot: 'velora-cafe/home.png', repo: 'velora-cafe' },
  { title: 'kavine-koralai', shot: 'kavine-koralai/home.png', repo: 'kavine-koralai' },
  { title: 'barlink', shot: 'barlink/desktop.png', repo: 'barlink' },
  { title: 'filmrank', shot: 'filmrank/mobile.png', repo: 'filmrank' },
  { title: 'internet-city', shot: 'internet-city/desktop.png', repo: 'internet-city' },
  { title: 'ai-creative-studio', shot: 'ai-creative-studio/desktop.png', repo: 'ai-creative-studio' },
  { title: 'baltic-brew', shot: 'baltic_brew_preview/desktop.png', repo: 'baltic_brew-preview' },
];

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.token) throw new Error('login: no token');
  return data.token;
}

async function upload(token, absPath) {
  const buf = fs.readFileSync(absPath);
  const data = buf.toString('base64');
  const res = await fetch(`${BASE_URL}/api/admin/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ filename: path.basename(absPath), data, mime: 'image/png' }),
  });
  if (!res.ok) throw new Error(`upload failed for ${absPath}: HTTP ${res.status}`);
  const out = await res.json();
  if (!out.url) throw new Error(`upload: no url for ${absPath}`);
  return out.url;
}

async function main() {
  const token = await login();
  const media = fs.existsSync(MEDIA_PATH)
    ? JSON.parse(fs.readFileSync(MEDIA_PATH, 'utf8'))
    : {};

  for (const p of PROJECTS) {
    const abs = path.join(SHOTS, p.shot);
    if (!fs.existsSync(abs)) {
      console.warn(`! missing screenshot: ${abs}`);
      continue;
    }
    const url = await upload(token, abs);
    media[p.title] = {
      image_url: url,
      repo_url: `${GITHUB}/${p.repo}`,
    };
    console.log(`+ ${p.title}: ${url}  ->  ${GITHUB}/${p.repo}`);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MEDIA_PATH, JSON.stringify(media, null, 2) + '\n');
  console.log(`\nWrote ${MEDIA_PATH}`);
  console.log('Restart the server (or it picks up on next open) to backfill image_url/repo_url.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
