/*
 * server/index.js — portfolio API + static file server.
 *
 * Pure Node built-ins (node:http, node:fs, node:path, node:url, node:crypto).
 * Serves the Vite production build from ../dist, the admin entry via the same
 * server, and exposes a JSON REST API under /api.
 *
 * Run:  node server/index.js   (or `npm start`)
 * Env:  PORT (default 4200), SITE_SECRET (recommended in production)
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const urlMod = require('node:url');

const { openDb, verifyPassword, LANGS, DEFAULT_LANG } = require('./db');
const { signToken, verifyToken } = require('./auth');

const PORT = Number(process.env.PORT) || 4200;
const HOST = process.env.HOST || '0.0.0.0';

const ROOT = path.join(__dirname, '..');
const DIST_DIR = process.env.DIST_DIR
  ? path.resolve(String(process.env.DIST_DIR))
  : path.join(ROOT, 'dist');
// Uploads are user-generated (admin image uploads) and must persist across
// restarts in production → point at the persistent disk via UPLOADS_DIR.
// Default (local, untouched): <repo>/uploads.
function resolveUploadsDir() {
  if (process.env.UPLOADS_DIR && String(process.env.UPLOADS_DIR).trim()) {
    return path.resolve(String(process.env.UPLOADS_DIR).trim());
  }
  if (process.env.RENDER) {
    // Ephemeral free-tier default: keep uploads off the read-only-ish checkout.
    return path.join('/tmp', 'site-data', 'uploads');
  }
  return path.join(ROOT, 'uploads');
}
const UPLOADS_DIR = resolveUploadsDir();

const API_PREFIX = '/api';
const STATIC_PREFIXES = ['/assets/', '/uploads/'];

// ---------------------------------------------------------------------------
// Static file serving (gated to dist + uploads).
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function contentType(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

function sendFile(req, res, absPath) {
  fs.readFile(absPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    const isHtml = ext === '.html';
    // Hashed /assets/ + /uploads/ can be cached hard; HTML (and everything else)
    // must be revalidated so an admin edit or a fresh build is picked up.
    const cacheControl = absPath.includes(STATIC_PREFIXES[0])
      ? 'public, max-age=31536000, immutable'
      : isHtml
        ? 'no-cache, no-store, must-revalidate'
        : 'no-cache';
    res.writeHead(200, {
      'Content-Type': contentType(absPath),
      'Cache-Control': cacheControl,
      ...(isHtml ? { Pragma: 'no-cache', Expires: '0' } : {}),
    });
    res.end(data);
  });
}

function serveBuildFile(filepath, fallback) {
  if (!fs.existsSync(filepath)) {
    const fb = path.join(DIST_DIR, fallback);
    return fs.existsSync(fb) ? fb : filepath;
  }
  return filepath;
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------
function readJsonBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function normInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function parseBullets(v) {
  if (Array.isArray(v)) return JSON.stringify(v.map(String));
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return '[]';
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed);
        return JSON.stringify(Array.isArray(arr) ? arr.map(String) : []);
      } catch {
        /* fall through to newline split */
      }
    }
    // allow newline-separated bullets from plain textareas
    return JSON.stringify(trimmed.split('\n').map((s) => s.trim()).filter(Boolean));
  }
  return '[]';
}

// Collect a per-language bullets payload from any of the accepted shapes:
//   { bullets_by_lang: {ru,lt,en} } | { bullets: {ru,lt,en} } |
//   { bullets: [...] } (same for all) | { bullets_ru, bullets_lt, bullets_en }
function collectBulletsByLang(b, cur) {
  if (b.bullets_by_lang && typeof b.bullets_by_lang === 'object' && !Array.isArray(b.bullets_by_lang)) {
    return parseBulletsByLang(b.bullets_by_lang);
  }
  if (b.bullets && typeof b.bullets === 'object' && !Array.isArray(b.bullets)) {
    return parseBulletsByLang(b.bullets);
  }
  const hasPerLang = LANGS.some((l) => b[`bullets_${l}`] !== undefined);
  if (hasPerLang) {
    const out = {};
    for (const lang of LANGS) {
      const v = Object.prototype.hasOwnProperty.call(b, `bullets_${lang}`)
        ? b[`bullets_${lang}`]
        : cur
          ? cur[`bullets_${lang}`]
          : [];
      out[lang] = parseBullets(v);
    }
    return out;
  }
  if (b.bullets !== undefined) {
    const parsed = parseBullets(b.bullets);
    return { ru: parsed, lt: parsed, en: parsed };
  }
  return null;
}

function normLang(v) {
  const l = String(v || '').toLowerCase();
  return LANGS.includes(l) ? l : DEFAULT_LANG;
}

// Parse a bullets value that may be a plain value or a per-language object.
function parseBulletsByLang(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const out = {};
    for (const lang of LANGS) out[lang] = parseBullets(v[lang]);
    return out;
  }
  return parseBullets(v);
}

// Pick a field value for a language: prefer <field>_<lang>, fall back to _ru,
// then to the base column. `bullets` is JSON-parsed into an array.
function pickField(row, field, lang) {
  const raw =
    row[`${field}_${lang}`] !== undefined && row[`${field}_${lang}`] !== ''
      ? row[`${field}_${lang}`]
      : row[`${field}_ru`] !== undefined && row[`${field}_ru`] !== ''
        ? row[`${field}_ru`]
        : row[field];
  if (field === 'bullets') {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return raw === undefined || raw === null ? '' : raw;
}

// ---------------------------------------------------------------------------
// DB + prepared statements
// ---------------------------------------------------------------------------
const db = openDb();
console.log(`[site] SQLite ready at ${require('./db').DB_PATH}`);
console.log(`[site] uploads dir → ${UPLOADS_DIR}`);
console.log(`[site] dist dir    → ${DIST_DIR}`);

const profileGetStmt = db.prepare('SELECT * FROM profile ORDER BY id ASC LIMIT 1');

const projectListStmt = db.prepare('SELECT * FROM projects ORDER BY sort_order ASC, id ASC');
const projectGetStmt = db.prepare('SELECT * FROM projects WHERE id = ?');
const projectDeleteStmt = db.prepare('DELETE FROM projects WHERE id = ?');

const stackListStmt = db.prepare('SELECT * FROM stack ORDER BY sort_order ASC, id ASC');
const stackGetStmt = db.prepare('SELECT * FROM stack WHERE id = ?');
const stackDeleteStmt = db.prepare('DELETE FROM stack WHERE id = ?');

const expListStmt = db.prepare('SELECT * FROM experience ORDER BY sort_order ASC, id ASC');
const expGetStmt = db.prepare('SELECT * FROM experience WHERE id = ?');
const expDeleteStmt = db.prepare('DELETE FROM experience WHERE id = ?');

const linkListStmt = db.prepare('SELECT * FROM links ORDER BY sort_order ASC, id ASC');
const linkGetStmt = db.prepare('SELECT * FROM links WHERE id = ?');
const linkDeleteStmt = db.prepare('DELETE FROM links WHERE id = ?');

const settingsRowsStmt = db.prepare('SELECT key, value FROM settings');
const settingUpsertStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

const uiListStmt = db.prepare('SELECT * FROM ui_strings ORDER BY key ASC');
const uiGetStmt = db.prepare('SELECT * FROM ui_strings WHERE key = ?');
const uiUpsertStmt = db.prepare(
  'INSERT INTO ui_strings (key, ru, lt, en) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET ru = excluded.ru, lt = excluded.lt, en = excluded.en'
);


const msgListStmt = db.prepare('SELECT * FROM messages ORDER BY created_at DESC, id DESC');
const msgGetStmt = db.prepare('SELECT * FROM messages WHERE id = ?');
const msgInsertStmt = db.prepare('INSERT INTO messages (name, contact, body, status) VALUES (?, ?, ?, ?)');
const msgStatusStmt = db.prepare('UPDATE messages SET status = ? WHERE id = ?');
const msgDeleteStmt = db.prepare('DELETE FROM messages WHERE id = ?');

const adminByNameStmt = db.prepare('SELECT * FROM admins WHERE username = ?');

// Serializers -------------------------------------------------------------
// Full multilingual row (all languages + base columns for backward compat).
function rowToProjectFull(r) {
  const bullets = {};
  for (const lang of LANGS) bullets[lang] = pickField(r, 'bullets', lang);
  return {
    id: r.id,
    // Russian/base mirrors for backward compatibility
    title: r.title_ru !== undefined ? r.title_ru : r.title,
    description: r.description_ru !== undefined ? r.description_ru : r.description,
    stack: r.stack_ru !== undefined ? r.stack_ru : r.stack,
    bullets: bullets.ru,
    // multilingual
    title_ru: r.title_ru ?? r.title ?? '',
    title_lt: r.title_lt ?? '',
    title_en: r.title_en ?? '',
    description_ru: r.description_ru ?? r.description ?? '',
    description_lt: r.description_lt ?? '',
    description_en: r.description_en ?? '',
    stack_ru: r.stack_ru ?? r.stack ?? '',
    stack_lt: r.stack_lt ?? '',
    stack_en: r.stack_en ?? '',
    bullets_ru: bullets.ru,
    bullets_lt: bullets.lt,
    bullets_en: bullets.en,
    image_url: r.image_url ?? '',
    repo_url: r.repo_url ?? '',
    sort_order: r.sort_order,
  };
}

// Language-projected project (public site).
function projectForLang(r, lang) {
  return {
    id: r.id,
    title: pickField(r, 'title', lang),
    description: pickField(r, 'description', lang),
    stack: pickField(r, 'stack', lang),
    bullets: pickField(r, 'bullets', lang),
    image_url: r.image_url ?? '',
    repo_url: r.repo_url ?? '',
    sort_order: r.sort_order,
  };
}

function stackForLang(r, lang) {
  return { id: r.id, name: pickField(r, 'name', lang), sort_order: r.sort_order };
}

function experienceForLang(r, lang) {
  return {
    id: r.id,
    period: r.period,
    company: pickField(r, 'company', lang),
    description: pickField(r, 'description', lang),
    sort_order: r.sort_order,
  };
}

function linkForLang(r, lang) {
  return {
    id: r.id,
    label: pickField(r, 'label', lang),
    url: r.url,
    sort_order: r.sort_order,
  };
}

function profileForLang(r, lang) {
  return {
    name: pickField(r, 'name', lang),
    title: pickField(r, 'title', lang),
    years: pickField(r, 'years', lang),
    bio_text: pickField(r, 'bio_text', lang),
    status: pickField(r, 'status', lang),
    email: r.email || '',
  };
}

function profileFull(r) {
  const out = { id: r.id, name: r.name_ru ?? r.name ?? '', email: r.email || '' };
  for (const lang of LANGS) out[`name_${lang}`] = r[`name_${lang}`] ?? '';
  for (const field of ['title', 'years', 'bio_text', 'status']) {
    out[field] = r[`${field}_ru`] ?? r[field] ?? '';
    for (const lang of LANGS) out[`${field}_${lang}`] = r[`${field}_${lang}`] ?? '';
  }
  return out;
}

// settings rows are stored as `s:<key>:<lang>` (plus legacy bare `<key>` rows).
function settingsRowsToMatrix(rows) {
  const matrix = {}; // key -> { ru, lt, en }
  for (const r of rows) {
    const m = /^s:(.+):(ru|lt|en)$/.exec(r.key);
    if (m) {
      const [, key, lang] = m;
      if (!matrix[key]) matrix[key] = { ru: '', lt: '', en: '' };
      matrix[key][lang] = r.value === null ? '' : r.value;
    }
  }
  // legacy bare rows: fill missing languages
  for (const r of rows) {
    if (/^s:/.test(r.key)) continue;
    if (!matrix[r.key]) matrix[r.key] = { ru: '', lt: '', en: '' };
    const v = r.value === null ? '' : r.value;
    for (const lang of LANGS) if (!matrix[r.key][lang]) matrix[r.key][lang] = v;
  }
  return matrix;
}

// Flat settings object for a single language (public site).
function settingsObject(lang = DEFAULT_LANG) {
  const matrix = settingsRowsToMatrix(settingsRowsStmt.all());
  const obj = {};
  for (const [key, byLang] of Object.entries(matrix)) {
    obj[key] = byLang[lang] || byLang.ru || byLang.en || '';
  }
  return obj;
}

function uiStringsForLang(lang) {
  const rows = uiListStmt.all();
  const out = {};
  for (const r of rows) out[r.key] = r[lang] || r.ru || r.en || '';
  return out;
}

// Upsert all three language rows of one setting key from { ru, lt, en }.
function uiUpsertSettingsKey(key, val = {}) {
  for (const lang of LANGS) {
    const v = val[lang];
    settingUpsertStmt.run(`s:${key}:${lang}`, v === null || v === undefined ? '' : String(v));
  }
}

function firstNumericSeg(parts, afterIndex) {
  for (let i = afterIndex; i < parts.length; i++) {
    if (/^\d+$/.test(parts[i])) return Number(parts[i]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  const parsed = urlMod.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname || '/');
  const parts = pathname.split('/').filter(Boolean);

  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  for (const [k, v] of Object.entries(corsHeaders())) res.setHeader(k, v);

  try {
    if (pathname.startsWith(API_PREFIX)) {
      return await handleApi(req, res, method, parts, pathname, parsed);
    }

    if (parts[0] === 'uploads') {
      const rel = parts.slice(1).join('/');
      const abs = path.join(UPLOADS_DIR, rel);
      if (!abs.startsWith(UPLOADS_DIR + path.sep)) return json(res, 403, { error: 'Forbidden' });
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return sendFile(req, res, abs);
      return json(res, 404, { error: 'Not found' });
    }

    let filePath;
    if (pathname === '/admin' || pathname === '/admin/') {
      filePath = serveBuildFile(path.join(DIST_DIR, 'admin.html'), 'admin.html');
    } else if (pathname === '/') {
      filePath = serveBuildFile(path.join(DIST_DIR, 'index.html'), 'index.html');
    } else {
      const candidate = path.join(DIST_DIR, pathname);
      if (
        candidate.startsWith(DIST_DIR + path.sep) &&
        fs.existsSync(candidate) &&
        fs.statSync(candidate).isFile()
      ) {
        filePath = candidate;
      } else {
        filePath =
          pathname.indexOf('/admin') === 0
            ? serveBuildFile(path.join(DIST_DIR, 'admin.html'), 'admin.html')
            : path.join(DIST_DIR, 'index.html');
        if (!fs.existsSync(filePath)) return json(res, 404, { error: 'Not found' });
      }
    }
    return sendFile(req, res, filePath);
  } catch (err) {
    console.error('[site] request error:', err);
    if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
    else res.end();
  }
});

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function handleApi(req, res, method, parts, pathname, parsed) {
  const query = (parsed && parsed.query) || {};
  const p = parts.slice(1); // strip 'api'

  if (p[0] === 'health') {
    let projects = 0;
    try {
      projects = Number(projectListStmt.all().length);
    } catch {
      projects = 0;
    }
    return json(res, 200, {
      status: 'ok',
      time: new Date().toISOString(),
      db: require('./db').DB_PATH,
      projects,
    });
  }

  // ---- auth ----
  if (p[0] === 'auth' && p[1] === 'login') {
    if (method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    const body = await readJsonBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) return json(res, 400, { error: 'Укажите логин и пароль' });
    const admin = adminByNameStmt.get(username);
    if (!admin || !verifyPassword(password, admin.salt, admin.password_hash))
      return json(res, 401, { error: 'Неверные учётные данные' });
    const token = signToken({ sub: admin.id, username: admin.username });
    return json(res, 200, { token, admin: { id: admin.id, username: admin.username } });
  }

  if (p[0] === 'auth' && p[1] === 'me') {
    const auth = authorize(req);
    if (!auth) return json(res, 401, { error: 'Unauthorized' });
    return json(res, 200, { admin: { id: auth.payload.sub, username: auth.payload.username } });
  }

  // ---- public GET /api/site?lang=ru|lt|en (everything for render) ----
  if (method === 'GET' && p[0] === 'site' && p.length === 1) {
    const lang = normLang(query.lang);
    const profile = profileGetStmt.get() || {};
    return json(res, 200, {
      lang,
      langs: LANGS,
      profile: profileForLang(profile, lang),
      projects: projectListStmt.all().map((r) => projectForLang(r, lang)),
      stack: stackListStmt.all().map((r) => stackForLang(r, lang)),
      experience: expListStmt.all().map((r) => experienceForLang(r, lang)),
      links: linkListStmt.all().map((r) => linkForLang(r, lang)),
      settings: settingsObject(lang),
      ui: uiStringsForLang(lang),
    });
  }

  // ---- public contact form (optional) ----
  if (p[0] === 'messages' && method === 'POST') {
    const body = await readJsonBody(req);
    const name = String(body.name || '').trim();
    const contact = String(body.contact || '').trim();
    const text = String(body.body || '').trim();
    if (!name || !contact || !text) return json(res, 400, { error: 'Заполните все поля' });
    const info = msgInsertStmt.run(name, contact, text, 'new');
    return json(res, 201, { id: Number(info.lastInsertRowid), ok: true });
  }

  // ================= ADMIN (token-protected) =================
  if (p[0] === 'admin') {
    const auth = authorize(req);
    if (!auth) return json(res, 401, { error: 'Unauthorized' });
    const a = p.slice(1);

    // -------- PROFILE --------
    if (a[0] === 'profile') {
      const cur = profileGetStmt.get();
      if (method === 'GET') return json(res, 200, cur ? profileFull(cur) : {});
      if (method === 'PUT' || method === 'PATCH' || method === 'POST') {
        if (!cur) return json(res, 404, { error: 'Profile missing' });
        const b = await readJsonBody(req);
        const cols = ['email'];
        const vals = [b.email !== undefined ? String(b.email) : cur.email];
        // name is multilingual: name_ru/_lt/_en, base `name` mirrors Russian.
        // If a base field (without language suffix) is sent, it means "same value
        // for all languages" — mirror it into ru/lt/en.
        const baseName = b.name !== undefined ? String(b.name) : null;
        for (const lang of LANGS) {
          const col = `name_${lang}`;
          let v;
          if (b[col] !== undefined) v = String(b[col]);
          else if (baseName !== null) v = baseName;
          else v = cur[col] ?? '';
          cols.push(col);
          vals.push(v);
        }
        cols.push('name');
        vals.push(
          b.name_ru !== undefined ? String(b.name_ru) : baseName !== null ? baseName : cur.name ?? ''
        );
        for (const field of ['title', 'years', 'bio_text', 'status']) {
          const baseVal = b[field] !== undefined ? String(b[field]) : null;
          const anyLangSet = LANGS.some((lang) => b[`${field}_${lang}`] !== undefined);
          let ruVal = cur[`${field}_ru`] ?? cur[field] ?? '';
          for (const lang of LANGS) {
            const col = `${field}_${lang}`;
            let v;
            if (b[col] !== undefined) v = String(b[col]);
            else if (baseVal !== null && !anyLangSet) v = baseVal;
            else v = cur[col] ?? '';
            if (lang === 'ru') ruVal = v;
            cols.push(col);
            vals.push(v);
          }
          // keep base column mirrored to Russian
          cols.push(field);
          vals.push(baseVal !== null ? baseVal : ruVal);
        }
        vals.push(cur.id);
        db.prepare(`UPDATE profile SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
          ...vals
        );
        return json(res, 200, profileFull(profileGetStmt.get()));
      }
    }

    // -------- MULTILINGUAL RESOURCE HELPERS --------
    // Generic list + create + update + delete for a localized content table.
    const CONTENT = {
      projects: {
        table: 'projects',
        fields: { title: 'text', description: 'text', stack: 'text', bullets: 'json' },
        extra: { sort_order: 'int', image_url: 'text', repo_url: 'text' },
        list: projectListStmt,
        get: projectGetStmt,
        del: projectDeleteStmt,
        serializeFull: rowToProjectFull,
      },
      stack: {
        table: 'stack',
        fields: { name: 'text' },
        extra: { sort_order: 'int' },
        list: stackListStmt,
        get: stackGetStmt,
        del: stackDeleteStmt,
        serializeFull: (r) => {
          const out = { id: r.id, name: r.name_ru ?? r.name ?? '', sort_order: r.sort_order };
          for (const lang of LANGS) out[`name_${lang}`] = r[`name_${lang}`] ?? '';
          return out;
        },
      },
      experience: {
        table: 'experience',
        fields: { company: 'text', description: 'text' },
        extra: { period: 'text', sort_order: 'int' },
        list: expListStmt,
        get: expGetStmt,
        del: expDeleteStmt,
        serializeFull: (r) => {
          const out = { id: r.id, period: r.period ?? '', sort_order: r.sort_order };
          for (const field of ['company', 'description']) {
            out[field] = r[`${field}_ru`] ?? r[field] ?? '';
            for (const lang of LANGS) out[`${field}_${lang}`] = r[`${field}_${lang}`] ?? '';
          }
          return out;
        },
      },
      links: {
        table: 'links',
        fields: { label: 'text' },
        extra: { url: 'text', sort_order: 'int' },
        list: linkListStmt,
        get: linkGetStmt,
        del: linkDeleteStmt,
        serializeFull: (r) => {
          const out = { id: r.id, label: r.label_ru ?? r.label ?? '', url: r.url ?? '', sort_order: r.sort_order };
          for (const lang of LANGS) out[`label_${lang}`] = r[`label_${lang}`] ?? '';
          return out;
        },
      },
    };

    if (CONTENT[a[0]]) {
      const cfg = CONTENT[a[0]];
      const id = firstNumericSeg(a, 1);

      if (method === 'GET' && !id)
        return json(res, 200, cfg.list.all().map((r) => cfg.serializeFull(r)));

      if (method === 'POST') {
        const b = await readJsonBody(req);
        const cols = [];
        const vals = [];
        for (const [field, kind] of Object.entries(cfg.fields)) {
          if (kind === 'json') {
            const byLang = collectBulletsByLang(b, null) || parseBulletsByLang(b.bullets);
            for (const lang of LANGS) {
              cols.push(`${field}_${lang}`);
              vals.push(byLang[lang] !== undefined ? byLang[lang] : '[]');
            }
            cols.push(field);
            vals.push(byLang.ru !== undefined ? byLang.ru : '[]');
          } else if (b[`${field}_by_lang`] || typeof b[`${field}_ru`] !== 'undefined') {
            for (const lang of LANGS) {
              const v = b[`${field}_${lang}`] !== undefined ? String(b[`${field}_${lang}`]).trim() : '';
              cols.push(`${field}_${lang}`);
              vals.push(v);
            }
            cols.push(field);
            vals.push(b[`${field}_ru`] !== undefined ? String(b[`${field}_ru`]).trim() : '');
          } else {
            const v = b[field] !== undefined ? String(b[field]).trim() : '';
            for (const lang of LANGS) {
              cols.push(`${field}_${lang}`);
              vals.push(v);
            }
            cols.push(field);
            vals.push(v);
          }
        }
        for (const [col, kind] of Object.entries(cfg.extra)) {
          cols.push(col);
          vals.push(kind === 'int' ? normInt(b[col], 0) : String(b[col] || '').trim());
        }
        const info = db
          .prepare(`INSERT INTO ${cfg.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .run(...vals);
        return json(res, 201, cfg.serializeFull(cfg.get.get(Number(info.lastInsertRowid))));
      }

      if ((method === 'PUT' || method === 'PATCH') && id) {
        const b = await readJsonBody(req);
        const cur = cfg.get.get(id);
        if (!cur) return json(res, 404, { error: 'Not found' });
        const sets = [];
        const vals = [];
        for (const [field, kind] of Object.entries(cfg.fields)) {
          if (kind === 'json') {
            const byLang =
              collectBulletsByLang(b, cur) ||
              parseBulletsByLang(b.bullets !== undefined ? b.bullets : cur);
            for (const lang of LANGS) {
              sets.push(`${field}_${lang} = ?`);
              vals.push(byLang[lang] !== undefined ? byLang[lang] : cur[`${field}_${lang}`]);
            }
            sets.push(`${field} = ?`);
            vals.push(byLang.ru !== undefined ? byLang.ru : cur[field]);
          } else {
            const anyLangSet = LANGS.some((l) => b[`${field}_${l}`] !== undefined);
            if (anyLangSet) {
              for (const lang of LANGS) {
                sets.push(`${field}_${lang} = ?`);
                vals.push(
                  b[`${field}_${lang}`] !== undefined
                    ? String(b[`${field}_${lang}`]).trim()
                    : cur[`${field}_${lang}`]
                );
              }
              sets.push(`${field} = ?`);
              vals.push(
                b[`${field}_ru`] !== undefined ? String(b[`${field}_ru`]).trim() : cur[field]
              );
            } else if (b[field] !== undefined) {
              const v = String(b[field]).trim();
              for (const lang of LANGS) {
                sets.push(`${field}_${lang} = ?`);
                vals.push(v);
              }
              sets.push(`${field} = ?`);
              vals.push(v);
            }
          }
        }
        for (const [col, kind] of Object.entries(cfg.extra)) {
          if (b[col] === undefined) continue;
          sets.push(`${col} = ?`);
          vals.push(kind === 'int' ? normInt(b[col], cur[col]) : String(b[col]).trim());
        }
        if (sets.length) {
          vals.push(id);
          db.prepare(`UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
        }
        return json(res, 200, cfg.serializeFull(cfg.get.get(id)));
      }

      if (method === 'DELETE' && id) {
        cfg.del.run(id);
        return json(res, 200, { ok: true, id });
      }
    }

    // -------- SETTINGS (multilingual matrix) --------
    if (a[0] === 'settings') {
      if (method === 'GET') return json(res, 200, settingsRowsToMatrix(settingsRowsStmt.all()));
      if (method === 'PUT' || method === 'PATCH' || method === 'POST') {
        const body = await readJsonBody(req);
        const patch = body && typeof body === 'object' ? body : {};
        if (patch.key && patch.ru !== undefined) {
          // single-key form: { key, ru, lt, en }
          uiUpsertSettingsKey(patch.key, patch);
        } else {
          for (const [key, val] of Object.entries(patch)) {
            if (key === 'key' || key === 'value') continue;
            if (val && typeof val === 'object') {
              for (const lang of LANGS) {
                settingUpsertStmt.run(
                  `s:${key}:${lang}`,
                  val[lang] === null || val[lang] === undefined ? '' : String(val[lang])
                );
              }
            } else {
              for (const lang of LANGS) {
                settingUpsertStmt.run(`s:${key}:${lang}`, val === null ? '' : String(val));
              }
            }
          }
        }
        return json(res, 200, settingsRowsToMatrix(settingsRowsStmt.all()));
      }
    }

    // -------- UI STRINGS --------
    if (a[0] === 'ui_strings') {
      const key = a[1] ? decodeURIComponent(a.slice(1).join('/')) : null;
      if (method === 'GET' && !key) return json(res, 200, uiListStmt.all());
      if (method === 'GET' && key) return json(res, 200, uiGetStmt.get(key) || {});
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        const b = await readJsonBody(req);
        const k = String((key || b.key || '')).trim();
        if (!k) return json(res, 400, { error: 'Missing key' });
        const cur = uiGetStmt.get(k) || { ru: '', lt: '', en: '' };
        uiUpsertStmt.run(
          k,
          b.ru !== undefined ? String(b.ru) : cur.ru,
          b.lt !== undefined ? String(b.lt) : cur.lt,
          b.en !== undefined ? String(b.en) : cur.en
        );
        return json(res, 200, uiGetStmt.get(k));
      }
      if (method === 'DELETE' && key) {
        db.prepare('DELETE FROM ui_strings WHERE key = ?').run(key);
        return json(res, 200, { ok: true, key });
      }
    }

    // -------- MESSAGES --------
    if (a[0] === 'messages') {
      const id = firstNumericSeg(a, 1);
      if (method === 'GET' && !id) return json(res, 200, msgListStmt.all());
      if ((method === 'PUT' || method === 'PATCH') && id) {
        const b = await readJsonBody(req);
        if (b.status !== undefined) msgStatusStmt.run(String(b.status), id);
        return json(res, 200, msgGetStmt.get(id) || {});
      }
      if (method === 'DELETE' && id) {
        msgDeleteStmt.run(id);
        return json(res, 200, { ok: true, id });
      }
    }

    // -------- UPLOAD (base64 JSON) --------
    if (a[0] === 'upload' && method === 'POST') {
      return await handleUpload(req, res);
    }

    return json(res, 404, { error: 'Unknown admin resource' });
  }

  return json(res, 404, { error: 'Not found' });
}

// ---------------------------------------------------------------------------
// Upload: accept { filename, data(base64), mime } and store into uploads dir
// ---------------------------------------------------------------------------
function handleUpload(req, res) {
  return readJsonBody(req, 8 * 1024 * 1024).then((body) => {
    if (!body.data) return json(res, 400, { error: 'Missing base64 data' });
    const mime = String(body.mime || 'image/png').toLowerCase();
    const extMap = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
    };
    const ext = extMap[mime] || '.png';
    const base64 = String(body.data).split(',')[1] || String(body.data);
    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return json(res, 400, { error: 'Invalid base64' });
    }
    if (!buffer.length) return json(res, 400, { error: 'Empty image data' });
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const name = `img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, name), buffer);
    return json(res, 201, { url: `/uploads/${name}`, filename: name });
  });
}

function authorize(req) {
  const header = req.headers['authorization'] || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const payload = verifyToken(m[1].trim());
  if (!payload) return null;
  return { token: m[1].trim(), payload };
}

server.listen(PORT, HOST, () => {
  console.log(`[site] 🕸️  server up → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`[site]    Public site   → http://localhost:${PORT}/`);
  console.log(`[site]    Admin panel   → http://localhost:${PORT}/admin`);
  console.log(`[site]    API           → http://localhost:${PORT}/api/site`);
});
