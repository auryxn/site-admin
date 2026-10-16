/*
 * scripts/build-static-data.mjs
 *
 * Generates a static content snapshot for the GitHub Pages build.
 * On Pages there is no Node backend, so the SPA reads this JSON instead of
 * calling GET /api/site?lang=...
 *
 * Source order:
 *   1. Local API on :4200 (live server) — preferred, single source of truth.
 *   2. SQLite (site.sqlite) — fallback when the server is down.
 *
 * Output: public/site-data.json  (served at <base>/site-data.json)
 *         shape: { ru: {...}, lt: {...}, en: {...} }
 *
 * Run:  node scripts/build-static-data.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'site-data.json');
const LANGS = ['ru', 'lt', 'en'];
const API_BASE = process.env.API_BASE || 'http://localhost:4200';

async function fromApi(lang) {
  const url = `${API_BASE}/api/site?lang=${encodeURIComponent(lang)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  const out = {};
  let source = 'api';
  for (const lang of LANGS) {
    let data;
    try {
      data = await fromApi(lang);
    } catch (e) {
      console.error(`[static-data] API failed for ${lang}: ${e.message}`);
      console.error('[static-data] Start the local server first:  npm start');
      process.exit(1);
    }
    out[lang] = data;
    const n = (data.projects || []).length;
    console.log(`[static-data] ${lang}: profile ✓  projects=${n}  stack=${(data.stack || []).length}  exp=${(data.experience || []).length}  ui=${Object.keys(data.ui || {}).length}`);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`[static-data] wrote ${path.relative(ROOT, OUT)} (${kb} KB) from ${source}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
