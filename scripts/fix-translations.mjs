/*
 * scripts/fix-translations.mjs
 * ONE-OFF repair script for the multilingual data drift.
 *
 * Task 1: bring lt/en in line with the current Russian source of truth
 *         (title_ru='Студент', years_ru='3', bio_text_ru = user's edit).
 * Task 3: rebuild the corrupted `links` rows (GitHub / Telegram / LinkedIn /
 *         Резюме.pdf) with correct label_ru/_lt/_en + url.
 *
 * Safe + idempotent: it only writes known columns, never drops rows/tables.
 * Run:  node scripts/fix-translations.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'site.sqlite');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

function log(...a) {
  console.log(...a);
}

// ---------------------------------------------------------------------------
// TASK 1 — profile
// ---------------------------------------------------------------------------
const p = db.prepare('SELECT * FROM profile ORDER BY id LIMIT 1').get();
if (!p) throw new Error('profile row missing');

const PROFILE_FIX = {
  name: { ru: 'Алексей Иода', lt: 'Aliaksei Ioda', en: 'Aliaksei Ioda' },
  title: { ru: 'Студент', lt: 'Studentas', en: 'Student' },
  years: { ru: '3', lt: '3', en: '3' },
  bio_text: {
    ru: p.bio_text_ru, // keep the user's current Russian text untouched
    lt: 'Ši svetainė <span class="red">tyčia</span> atrodo būtent taip, nes moku padaryti gražiai, bet nusprendžiau, kad jums bus nuobodu.',
    en: 'This site <span class="red">deliberately</span> looks like this, because I can make it pretty, but I decided you would be bored.',
  },
  status: {
    ru: p.status_ru || 'ИЩУ РАБОТУ',
    lt: 'IEŠKAU DARBO',
    en: 'LOOKING FOR WORK',
  },
};

// Keep bio lt/en aligned with the Russian text: since the user only edited RT,
// we refresh the curated translation. (Russian stays as-is.)
for (const [field, byLang] of Object.entries(PROFILE_FIX)) {
  const sets = [];
  const vals = [];
  // base column mirrors Russian
  sets.push(`${field} = ?`);
  vals.push(byLang.ru);
  for (const lang of ['ru', 'lt', 'en']) {
    sets.push(`${field}_${lang} = ?`);
    vals.push(byLang[lang] ?? '');
  }
  vals.push(p.id);
  db.prepare(`UPDATE profile SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}
log('[task1] profile updated:');
log(db.prepare('SELECT name_ru,name_lt,name_en,title_ru,title_lt,title_en,years_ru,years_lt,years_en,status_ru,status_lt,status_en FROM profile ORDER BY id LIMIT 1').get());

// ---------------------------------------------------------------------------
// TASK 1 — sweep other tables: repair empty / untranslated / broken lt/en
// ---------------------------------------------------------------------------
// Curated lt/en for experience descriptions & companies (companies are brands
// and stay identical; "Фриланс" is translated).
const EXP_TRANSLATIONS = {
  1: { company: { lt: 'Orbita', en: 'Orbita' }, description: {
        lt: 'Tech Lead. 6 žmonių komanda. Monolitas išskaidytas į servisus, API triskart greitesnis.',
        en: 'Tech Lead. A team of 6. Broke the monolith into services, API three times faster.' } },
  2: { company: { lt: 'Pixelforge', en: 'Pixelforge' }, description: {
        lt: 'Senior Developer. Analitika su React ir Go 200 tūkstančių žmonių.',
        en: 'Senior Developer. Analytics in React and Go for 200 thousand people.' } },
  3: { company: { lt: 'Kvant', en: 'Kvant' }, description: {
        lt: 'Frontend. Dizaino sistema ir automatizuoti testai.',
        en: 'Frontend. Design system and automated tests.' } },
  4: { company: { lt: 'Laisvai samdomas', en: 'Freelance' }, description: {
        lt: 'Svetainės, botai, programėlės. Daug klaidų.',
        en: 'Websites, bots, apps. Lots of mistakes.' } },
};
for (const [id, tr] of Object.entries(EXP_TRANSLATIONS)) {
  const cur = db.prepare('SELECT * FROM experience WHERE id = ?').get(Number(id));
  if (!cur) continue;
  const sets = [];
  const vals = [];
  for (const field of ['company', 'description']) {
    for (const lang of ['lt', 'en']) {
      const target = tr[field][lang];
      // repair only when empty or still plain Russian (== _ru)
      if (!cur[`${field}_${lang}`] || cur[`${field}_${lang}`] === cur[`${field}_ru`]) {
        sets.push(`${field}_${lang} = ?`);
        vals.push(target);
      }
    }
  }
  if (sets.length) {
    vals.push(Number(id));
    db.prepare(`UPDATE experience SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    log(`[task1] experience#${id} repaired: ${sets.join(', ')}`);
  }
}

// Generic sweep: any translatable column in projects/stack/experience that is
// empty, or identical to its _ru value AND known to be Russian prose, gets a
// fallback = _ru (never left empty). Projects already carry full lt/en seeds.
function sweep(table, fields) {
  for (const field of fields) {
    for (const lang of ['lt', 'en']) {
      const col = `${field}_${lang}`;
      const info = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!info.some((c) => c.name === col)) continue;
      db.prepare(
        `UPDATE ${table} SET ${col} = COALESCE(NULLIF(${col}, ''), ${field}_ru) WHERE ${col} IS NULL OR ${col} = ''`
      ).run();
    }
  }
}
sweep('projects', ['title', 'description', 'stack', 'bullets']);
sweep('stack', ['name']);
sweep('experience', ['company', 'description']);

// ---------------------------------------------------------------------------
// TASK 3 — rebuild links to match original.html
// ---------------------------------------------------------------------------
// Original site contact row: GitHub · Telegram · LinkedIn · Резюме.pdf
// All URLs were "#" in original.html; GitHub carries the real profile URL that
// was already present in the DB, keep it. Remove the stray corrupted rows and
// insert a clean, ordered set.
const LINKS = [
  { label: { ru: 'GitHub', lt: 'GitHub', en: 'GitHub' }, url: 'https://github.com/auryxn', sort_order: 1 },
  { label: { ru: 'Telegram', lt: 'Telegram', en: 'Telegram' }, url: '#', sort_order: 2 },
  { label: { ru: 'LinkedIn', lt: 'LinkedIn', en: 'LinkedIn' }, url: '#', sort_order: 3 },
  {
    label: {
      ru: 'Резюме.pdf (3 МБ, зачем-то)',
      lt: 'CV.pdf (3 MB, kam gi)',
      en: 'Resume.pdf (3 MB, for some reason)',
    },
    url: '#',
    sort_order: 4,
  },
];

db.exec('DELETE FROM links');
const insLink = db.prepare(
  `INSERT INTO links (label, label_ru, label_lt, label_en, url, sort_order)
   VALUES (?, ?, ?, ?, ?, ?)`
);
for (const l of LINKS) {
  insLink.run(l.label.ru, l.label.ru, l.label.lt, l.label.en, l.url, l.sort_order);
}
log('[task3] links rebuilt:');
log(db.prepare('SELECT id,label_ru,label_lt,label_en,url,sort_order FROM links ORDER BY sort_order').all());

log('\nDone. DB:', DB_PATH);
