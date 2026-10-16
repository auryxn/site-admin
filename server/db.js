/*
 * server/db.js
 * -------------------------------------------------------------
 * Opens (or creates) the portfolio SQLite database at ./site.sqlite
 * using the Node 24 built-in `node:sqlite` (DatabaseSync). Zero extra deps.
 *
 * Creates all tables and seeds them idempotently with the site's current
 * hardcoded content (profile, projects, stack, experience, links, settings)
 * plus a default admin.
 *
 * MULTILINGUAL (ru default / lt / en):
 *   - Every content table gets `<field>_ru`, `<field>_lt`, `<field>_en`
 *     columns. The original `<field>` column is KEPT as the Russian value
 *     (backward compatibility), and `<field>_ru` mirrors it.
 *   - A dedicated `ui_strings` table holds the static UI labels
 *     (key, ru, lt, en).
 *   - Migration is additive + idempotent: existing rows are never dropped,
 *     new columns are added with ALTER TABLE and backfilled from `<field>`.
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DB_PATH = path.join(__dirname, '..', 'site.sqlite');

const LANGS = ['ru', 'lt', 'en'];
const DEFAULT_LANG = 'ru';

// Translatable columns per table. Each item is the base column name; the
// localized columns are `<base>_ru`, `<base>_lt`, `<base>_en`.
const TRANSLATABLE = {
  profile: ['name', 'title', 'years', 'bio_text', 'status'],
  projects: ['title', 'description', 'stack', 'bullets'],
  stack: ['name'],
  experience: ['company', 'description'],
  links: ['label'],
  settings: ['value'],
};

// ---------------------------------------------------------------------------
// Table schema (base columns for a fresh database)
// ---------------------------------------------------------------------------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL DEFAULT '',
  years      TEXT NOT NULL DEFAULT '',
  bio_text   TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  stack       TEXT NOT NULL DEFAULT '',
  bullets     TEXT NOT NULL DEFAULT '[]',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  image_url   TEXT NOT NULL DEFAULT '',
  repo_url    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS stack (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS experience (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  period      TEXT NOT NULL DEFAULT '',
  company     TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL DEFAULT '',
  url        TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS ui_strings (
  key TEXT PRIMARY KEY,
  ru  TEXT NOT NULL DEFAULT '',
  lt  TEXT NOT NULL DEFAULT '',
  en  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL DEFAULT '',
  contact    TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL
);
`;

// ---------------------------------------------------------------------------
// Seed data — Russian is the source of truth; lt/en are translations
// ---------------------------------------------------------------------------
const SEED_PROFILE = {
  name: {
    ru: 'Алексей Иода',
    lt: 'Aliaksei Ioda',
    en: 'Aliaksei Ioda',
  },
  email: 'hello@alexvolkov.dev',
  title: {
    ru: 'Студент',
    lt: 'Studentas',
    en: 'Student',
  },
  years: {
    ru: '3',
    lt: '3',
    en: '3',
  },
  bio_text: {
    ru: 'Этот сайт <span class="red">намеренно</span> выглядит так, потому что я умею делать красиво, но решил, что вам будет скучно.',
    lt: 'Ši svetainė <span class="red">tyčia</span> atrodo būtent taip, nes moku padaryti gražiai, bet nusprendžiau, kad jums bus nuobodu.',
    en: 'This site <span class="red">deliberately</span> looks like this, because I can make it pretty, but I decided you would be bored.',
  },
  status: {
    ru: 'ИЩУ РАБОТУ',
    lt: 'IEŠKAU DARBO',
    en: 'LOOKING FOR WORK',
  },
};

// Real portfolio projects (public repos under github.com/auryxn). The ids
// PULSE_REAL_PROJECTS and image/repo URLs are filled at runtime by
// seedRealProjects() in server/index.js after screenshots are uploaded.
const SEED_PROJECTS = [
  {
    title: { ru: 'site-admin', lt: 'site-admin', en: 'site-admin' },
    description: {
      ru: 'Личный сайт-портфолио в стиле Web 1.0 с админкой.',
      lt: 'Asmeninė Web 1.0 stiliaus portfelio svetainė su administravimo skydeliu.',
      en: 'Personal Web 1.0 style portfolio site with an admin panel.',
    },
    stack: { ru: 'React, Vite, Node.js, SQLite', lt: 'React, Vite, Node.js, SQLite', en: 'React, Vite, Node.js, SQLite' },
    bullets: {
      ru: ['Публичный сайт и админка в одном Node-процессе', 'Контент редактируется без программиста', 'Мультиязычность RU / LT / EN', 'Загрузка изображений в uploads/'],
      lt: ['Vieša svetainė ir skydelis viename Node procese', 'Turinys redaguojamas be programuotojo', 'Daugiakalbystė RU / LT / EN', 'Vaizdų įkėlimas į uploads/'],
      en: ['Public site and admin panel in one Node process', 'Content edited without a developer', 'Multilingual RU / LT / EN', 'Image upload to uploads/'],
    },
  },
  {
    title: { ru: 'velora-cafe', lt: 'velora-cafe', en: 'velora-cafe' },
    description: {
      ru: 'Сайт кофейни Velora Café с редактируемой админкой.',
      lt: 'Kavos namų Velora Café svetainė su redaguojamu skydeliu.',
      en: 'Velora Café coffee shop site with an editable admin panel.',
    },
    stack: { ru: 'React, Vite, Tailwind, Node.js, SQLite', lt: 'React, Vite, Tailwind, Node.js, SQLite', en: 'React, Vite, Tailwind, Node.js, SQLite' },
    bullets: {
      ru: ['Меню, отзывы, галерея и бронирования', 'Админка с редактированием всего контента и цен', 'Заявки на бронирование со статусами', 'Аутентификация по HMAC-токену'],
      lt: ['Meniu, atsiliepimai, galerija ir rezervacijos', 'Skydelis visam turiniui ir kainoms redaguoti', 'Rezervacijų užklausos su būsenomis', 'Autentifikacija HMAC prieigos raktu'],
      en: ['Menu, reviews, gallery and reservations', 'Admin panel editing all content and prices', 'Reservation requests with statuses', 'HMAC token authentication'],
    },
  },
  {
    title: { ru: 'kavine-koralai', lt: 'kavine-koralai', en: 'kavine-koralai' },
    description: {
      ru: 'Сайт литовского кафе Kavinė Koralai с админкой.',
      lt: 'Lietuviškos kavinės „Kavinė Koralai“ svetainė su skydeliu.',
      en: 'Website for the Lithuanian café Kavinė Koralai with an admin panel.',
    },
    stack: { ru: 'React, Vite, Tailwind, Node.js, SQLite', lt: 'React, Vite, Tailwind, Node.js, SQLite', en: 'React, Vite, Tailwind, Node.js, SQLite' },
    bullets: {
      ru: ['Локализованный литовский сайт кафе', 'Меню, галерея и отзывы из админки', 'Единая архитектура с velora-cafe', 'SQLite с идемпотентным сидированием'],
      lt: ['Lokalizuota lietuviška kavinės svetainė', 'Meniu, galerija ir atsiliepimai iš skydelio', 'Bendra architektūra su velora-cafe', 'SQLite su idempotentiniu duomenų sėjimu'],
      en: ['Localized Lithuanian café website', 'Menu, gallery and reviews from the admin panel', 'Same architecture as velora-cafe', 'SQLite with idempotent seeding'],
    },
  },
  {
    title: { ru: 'barlink', lt: 'barlink', en: 'barlink' },
    description: {
      ru: 'Веб-MVP знакомств в барах: карта, встречи и чат.',
      lt: 'Pažinčių baruose žiniatinklio MVP: žemėlapis, susitikimai ir pokalbiai.',
      en: 'A web MVP for dating in bars: map, meetups and chat.',
    },
    stack: { ru: 'React, Vite, Tailwind, Leaflet, Express, SQLite', lt: 'React, Vite, Tailwind, Leaflet, Express, SQLite', en: 'React, Vite, Tailwind, Leaflet, Express, SQLite' },
    bullets: {
      ru: ['Интерактивная карта баров Вильнюса', 'Создание и присоединение к встречам', 'Групповой чат и список участников', 'Демо-интерфейс в рамке телефона'],
      lt: ['Interaktyvus Vilniaus barų žemėlapis', 'Susitikimų kūrimas ir prisijungimas', 'Grupių pokalbiai ir dalyvių sąrašas', 'Demo sąsaja telefono rėmelyje'],
      en: ['Interactive map of Vilnius bars', 'Creating and joining meetups', 'Group chat and participant list', 'Demo interface in a phone frame'],
    },
  },
  {
    title: { ru: 'filmrank', lt: 'filmrank', en: 'filmrank' },
    description: {
      ru: 'Личный рейтинг фильмов: свайпы в стиле Tinder и дуэли.',
      lt: 'Asmeninis filmų reitingas: Tinder stiliaus braukimai ir dvikovos.',
      en: 'A personal movie ranking: Tinder-style swipes and duels.',
    },
    stack: { ru: 'React 19, Vite, framer-motion, TMDB API', lt: 'React 19, Vite, framer-motion, TMDB API', en: 'React 19, Vite, framer-motion, TMDB API' },
    bullets: {
      ru: ['Свайп-колода карточек из каталога TMDB', 'Дуэли: какой фильм лучше', 'Рейтинг и tier-список S–F', 'Статистика вкуса и экспорт топа'],
      lt: ['Kortelių braukimas iš TMDB katalogo', 'Dvikovos: kuris filmas geresnis', 'Reitingas ir S–F pakopų sąrašas', 'Skonio statistika ir viršūnės eksportas'],
      en: ['Swipe deck of cards from the TMDB catalog', 'Duels: which movie is better', 'Ranking and S–F tier list', 'Taste statistics and top export'],
    },
  },
  {
    title: { ru: 'internet-city', lt: 'internet-city', en: 'internet-city' },
    description: {
      ru: 'Интерактивная 3D-модель того, как работает интернет.',
      lt: 'Interaktyvus 3D modelis, parodantis, kaip veikia internetas.',
      en: 'An interactive 3D model of how the internet works.',
    },
    stack: { ru: 'TypeScript, Vite, Three.js, WebGL', lt: 'TypeScript, Vite, Three.js, WebGL', en: 'TypeScript, Vite, Three.js, WebGL' },
    bullets: {
      ru: ['3D-сцена: сервисы-здания и пакеты-грузовики', '10 шагов от URL до отрисовки страницы', 'Режимы «Просто» и «Технически»', 'Симуляция потери пакета и квиз'],
      lt: ['3D scena: paslaugos-pastatai ir paketai-sunkvežimiai', '10 žingsnių nuo URL iki puslapio atvaizdavimo', '„Paprastas“ ir „Techninis“ režimai', 'Paketo praradimo simuliacija ir viktorina'],
      en: ['3D scene: services as buildings, packets as trucks', '10 steps from URL to page render', '“Simple” and “Technical” modes', 'Packet-loss simulation and a quiz'],
    },
  },
  {
    title: { ru: 'ai-creative-studio', lt: 'ai-creative-studio', en: 'ai-creative-studio' },
    description: {
      ru: 'Next.js MVP — рабочее место для AI-производства видео.',
      lt: 'Next.js MVP — darbo vieta AI vaizdo įrašų gamybai.',
      en: 'A Next.js MVP — a workspace for AI video production.',
    },
    stack: { ru: 'Next.js 15, React 19, TypeScript, Tailwind', lt: 'Next.js 15, React 19, TypeScript, Tailwind', en: 'Next.js 15, React 19, TypeScript, Tailwind' },
    bullets: {
      ru: ['Дашборд с прогрессом производства фильмов', 'Сценарий, раскадровка и персонажи', 'Конструктор промптов с версионированием', 'Хранение локально, с переходом на Supabase'],
      lt: ['Skydelis su filmų gamybos eiga', 'Scenarijus, storyboard ir veikėjai', 'Užklausų konstruktorius su versijavimu', 'Saugoma lokaliai, su perėjimu prie Supabase'],
      en: ['Dashboard with movie production progress', 'Script, storyboard and characters', 'Prompt builder with versioning', 'Stored locally, with a path to Supabase'],
    },
  },
  {
    title: { ru: 'baltic-brew', lt: 'baltic-brew', en: 'baltic-brew' },
    description: {
      ru: 'Одностраничный лендинг крафтового бара Baltic Brew.',
      lt: 'Vieno puslapio „Baltic Brew“ amatų baro nukreipimo svetainė.',
      en: 'A one-page landing for the Baltic Brew craft beer bar.',
    },
    stack: { ru: 'HTML, CSS, JavaScript', lt: 'HTML, CSS, JavaScript', en: 'HTML, CSS, JavaScript' },
    bullets: {
      ru: ['Витрина недельного ассортимента кранов', 'Галерея и блок групповых заказов', 'Форма бронирования по телефону', 'Один HTML-файл без сборки и зависимостей'],
      lt: ['Savaitės čiaupų asortimento vitrina', 'Galerija ir grupinių užsakymų blokas', 'Rezervacijos telefonu forma', 'Vienas HTML failas be kūrimo įrankių ir priklausomybių'],
      en: ['Weekly tap assortment showcase', 'Gallery and group-order block', 'Phone reservation form', 'A single HTML file, no build or dependencies'],
    },
  },
];

// Legacy fictional projects that must be removed on migration.
const LEGACY_PROJECT_TITLES = ['Pulse', 'Lumen', 'Fernweh', 'Quill', 'Nimbus', 'Echo'];

/* eslint-disable no-unused-vars */
const _OLD_SEED_PROJECTS = [
  {
    title: { ru: 'Pulse', lt: 'Pulse', en: 'Pulse' },
    description: {
      ru: 'Дашборд аналитики в реальном времени для интернет-магазинов.',
      lt: 'Realiojo laiko analitikos suvestinė internetinėms parduotuvėms.',
      en: 'Real-time analytics dashboard for online stores.',
    },
    stack: { ru: 'React, Go, ClickHouse', lt: 'React, Go, ClickHouse', en: 'React, Go, ClickHouse' },
    bullets: {
      ru: ['50 тысяч событий в секунду', 'Графики живут через WebSocket', 'Страница грузится быстрее секунды'],
      lt: ['50 tūkstančių įvykių per sekundę', 'Grafikai gyvi per WebSocket', 'Puslapis įkeliamas greičiau nei per sekundę'],
      en: ['50 thousand events per second', 'Charts live over WebSocket', 'Page loads in under a second'],
    },
  },
  {
    title: { ru: 'Lumen', lt: 'Lumen', en: 'Lumen' },
    description: {
      ru: 'Поиск по документам компании обычным языком.',
      lt: 'Paieška įmonės dokumentuose paprasta kalba.',
      en: 'Search across company documents in plain language.',
    },
    stack: { ru: 'Python, LLM, pgvector', lt: 'Python, LLM, pgvector', en: 'Python, LLM, pgvector' },
    bullets: {
      ru: ['Находит ответ в тысячах PDF', 'Показывает источник ответа', 'Работает на серверах заказчика'],
      lt: ['Randa atsakymą tūkstančiuose PDF', 'Parodo atsakymo šaltinį', 'Veikia užsakovo serveriuose'],
      en: ['Finds the answer among thousands of PDFs', 'Shows the source of the answer', 'Runs on the client’s own servers'],
    },
  },
  {
    title: { ru: 'Fernweh', lt: 'Fernweh', en: 'Fernweh' },
    description: {
      ru: 'Мобильное приложение для планирования путешествий.',
      lt: 'Mobili programėlė kelionėms planuoti.',
      en: 'Mobile app for planning trips.',
    },
    stack: { ru: 'Flutter, Firebase', lt: 'Flutter, Firebase', en: 'Flutter, Firebase' },
    bullets: {
      ru: ['Маршруты без интернета', 'Общий план для друзей', '40 тысяч скачиваний'],
      lt: ['Maršrutai be interneto', 'Bendras planas draugams', '40 tūkstančių atsisiuntimų'],
      en: ['Routes without internet', 'A shared plan for friends', '40 thousand downloads'],
    },
  },
  {
    title: { ru: 'Quill', lt: 'Quill', en: 'Quill' },
    description: {
      ru: 'Лёгкая библиотека для редактирования текста в браузере.',
      lt: 'Lengva biblioteka tekstui redaguoti naršyklėje.',
      en: 'A lightweight library for editing text in the browser.',
    },
    stack: { ru: 'TypeScript, Rollup', lt: 'TypeScript, Rollup', en: 'TypeScript, Rollup' },
    bullets: {
      ru: ['6 КБ в сжатом виде', '1200 звёзд на GitHub', 'Используется в 300 проектах'],
      lt: ['6 KB suspaustoje formoje', '1200 žvaigždučių GitHub', 'Naudojama 300 projektuose'],
      en: ['6 KB minified', '1200 stars on GitHub', 'Used in 300 projects'],
    },
  },
  {
    title: { ru: 'Nimbus', lt: 'Nimbus', en: 'Nimbus' },
    description: {
      ru: 'Панель управления облачной инфраструктурой.',
      lt: 'Debesų infrastruktūros valdymo skydas.',
      en: 'Cloud infrastructure management panel.',
    },
    stack: { ru: 'Next.js, Terraform, AWS', lt: 'Next.js, Terraform, AWS', en: 'Next.js, Terraform, AWS' },
    bullets: {
      ru: ['Окружение в один клик', 'Роли доступа и журнал действий', 'Экономия до 30% на облаке'],
      lt: ['Aplinka vienu paspaudimu', 'Prieigos vaidmenys ir veiksmų žurnalas', 'Sutaupoma iki 30% debesyje'],
      en: ['Environment in one click', 'Access roles and audit log', 'Up to 30% cloud savings'],
    },
  },
  {
    title: { ru: 'Echo', lt: 'Echo', en: 'Echo' },
    description: {
      ru: 'Телеграм-бот: голосовые превращает в заметки.',
      lt: 'Telegram botas: balsines žinutes paverčia užrašais.',
      en: 'Telegram bot: turns voice messages into notes.',
    },
    stack: { ru: 'Node.js, Whisper', lt: 'Node.js, Whisper', en: 'Node.js, Whisper' },
    bullets: {
      ru: ['Русскую речь понимает на 96%', 'Сам выделяет задачи и сроки', '18 тысяч пользователей'],
      lt: ['Rusišką kalbą supranta 96%', 'Pats išskiria užduotis ir terminus', '18 tūkstančių naudotojų'],
      en: ['Understands Russian speech at 96%', 'Picks out tasks and deadlines itself', '18 thousand users'],
    },
  },
];
/* eslint-enable no-unused-vars */

// Stack is mostly technical names — kept identical across languages, but the
// multilingual shape is still stored so admins can translate if desired.
const SEED_STACK_NAMES = [
  'TypeScript', 'React', 'Go', 'Python', 'Node.js', 'PostgreSQL',
  'Docker', 'Kubernetes', 'GraphQL', 'Rust', 'Redis', 'AWS',
].map((name, i) => ({ name: { ru: name, lt: name, en: name }, sort_order: i + 1 }));

const SEED_EXPERIENCE = [
  {
    period: '2024+',
    company: { ru: 'Orbita', lt: 'Orbita', en: 'Orbita' },
    description: {
      ru: 'Tech Lead. Команда из 6 человек. Монолит в сервисы, API быстрее втрое.',
      lt: 'Tech Lead. 6 žmonių komanda. Monolitas išskaidytas į servisus, API triskart greitesnis.',
      en: 'Tech Lead. A team of 6. Broke the monolith into services, API three times faster.',
    },
    sort_order: 1,
  },
  {
    period: '2021–24',
    company: { ru: 'Pixelforge', lt: 'Pixelforge', en: 'Pixelforge' },
    description: {
      ru: 'Senior Developer. Аналитика на React и Go для 200 тысяч человек.',
      lt: 'Senior Developer. Analitika su React ir Go 200 tūkstančių žmonių.',
      en: 'Senior Developer. Analytics in React and Go for 200 thousand people.',
    },
    sort_order: 2,
  },
  {
    period: '2019–21',
    company: { ru: 'Kvant', lt: 'Kvant', en: 'Kvant' },
    description: {
      ru: 'Frontend. Дизайн-система и автотесты.',
      lt: 'Frontend. Dizaino sistema ir automatizuoti testai.',
      en: 'Frontend. Design system and automated tests.',
    },
    sort_order: 3,
  },
  {
    period: '2017–19',
    company: { ru: 'Фриланс', lt: 'Laisvai samdomas', en: 'Freelance' },
    description: {
      ru: 'Сайты, боты, приложения. Много ошибок.',
      lt: 'Svetainės, botai, programėlės. Daug klaidų.',
      en: 'Websites, bots, apps. Lots of mistakes.',
    },
    sort_order: 4,
  },
];

const SEED_LINKS = [
  {
    label: { ru: 'GitHub', lt: 'GitHub', en: 'GitHub' },
    url: '#',
    sort_order: 1,
  },
  {
    label: { ru: 'Telegram', lt: 'Telegram', en: 'Telegram' },
    url: '#',
    sort_order: 2,
  },
  {
    label: { ru: 'LinkedIn', lt: 'LinkedIn', en: 'LinkedIn' },
    url: '#',
    sort_order: 3,
  },
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

// settings.value becomes '<key>_<lang>' rows: s:<key>:ru / s:<key>:lt / s:<key>:en
const SEED_SETTINGS = {
  counter_start: { ru: '137', lt: '137', en: '137' },
  title_bar: {
    ru: 'C:\\Users\\alex\\Desktop\\portfolio\\index_final_v3_REAL_FINAL.html — Netscape Navigator 4.0',
    lt: 'C:\\Users\\alex\\Desktop\\portfolio\\index_final_v3_REAL_FINAL.html — Netscape Navigator 4.0',
    en: 'C:\\Users\\alex\\Desktop\\portfolio\\index_final_v3_REAL_FINAL.html — Netscape Navigator 4.0',
  },
  marquee_text: {
    ru: '★ ВНИМАНИЕ ★ ЭТОТ САЙТ НАМЕРЕННО ВЫГЛЯДИТ ТАК ★ НАНИМАЙТЕ РАЗРАБОТЧИКА ★ ',
    lt: '★ DĖMESIO ★ ŠI SVETAINĖ TYČIA ATRODO TAIP ★ SAMDAUKITE PROGRAMUOTOJĄ ★ ',
    en: '★ ATTENTION ★ THIS SITE DELIBERATELY LOOKS LIKE THIS ★ HIRE A DEVELOPER ★ ',
  },
  projects_note: {
    ru: 'Нажми на строку. Или не нажимай. Мне всё равно (нет).',
    lt: 'Spausk ant eilutės. Arba nespausk. Man vis tiek (ne).',
    en: 'Click a row. Or don’t. I don’t care (I do).',
  },
  contacts_note: {
    ru: 'Пишите, отвечаю быстрее, чем грузится этот сайт:',
    lt: 'Rašykite, atsakau greičiau, nei įkeliama ši svetainė:',
    en: 'Write to me — I reply faster than this site loads:',
  },
  footer_text: {
    ru: '© 2026 Алексей Иода. Лучше всего просматривается в Netscape Navigator. Страница обновлена: вчера (нет).',
    lt: '© 2026 Aliaksei Ioda. Geriausiai žiūrima „Netscape Navigator“. Puslapis atnaujintas: vakar (ne).',
    en: '© 2026 Aliaksei Ioda. Best viewed in Netscape Navigator. Page updated: yesterday (no).',
  },
  badge: {
    ru: 'ВЕБ 1.0',
    lt: 'WEB 1.0',
    en: 'WEB 1.0',
  },
  popup_title: {
    ru: 'Поздравляем!',
    lt: 'Sveikiname!',
    en: 'Congratulations!',
  },
  popup_text: {
    ru: 'Вы нашли разработчика! Хотите нанять Алексея?',
    lt: 'Radote programuotoją! Norite pasamdyti Aleksejų?',
    en: 'You found a developer! Want to hire Alexey?',
  },
};

// Static UI strings (labels that are not stored as content rows).
const SEED_UI_STRINGS = [
  ['nav.projects', 'Проекты', 'Projektai', 'Projects'],
  ['nav.stack', 'Стек', 'Stack', 'Stack'],
  ['nav.experience', 'Опыт', 'Patirtis', 'Experience'],
  ['nav.contacts', 'Контакты', 'Kontaktai', 'Contacts'],
  ['nav.new', 'NEW!', 'NEW!', 'NEW!'],

  ['section.projects', 'ПРОЕКТЫ', 'PROJEKTAI', 'PROJECTS'],
  ['section.stack', 'СТЕК', 'STACK', 'STACK'],
  ['section.experience', 'ОПЫТ', 'PATIRTIS', 'EXPERIENCE'],
  ['section.contacts', 'КОНТАКТЫ', 'KONTAKTAI', 'CONTACTS'],

  ['intro.prefix', 'Я', 'Esu', 'I am'],
  ['intro.dev', 'Пишу сайты и сервисы', 'Kuriu svetaines ir servisus', 'I build websites and services'],
  ['intro.status', 'Статус:', 'Statusas:', 'Status:'],

  ['visitors', 'Посетителей:', 'Lankytojų:', 'Visitors:'],

  ['projects.repo_link', '[открыть репозиторий →]', '[atidaryti repozitoriją →]', '[open repository →]'],
  ['projects.stack_label', 'Стек:', 'Stack:', 'Stack:'],

  ['exp.when', 'Когда', 'Kada', 'When'],
  ['exp.where', 'Где', 'Kur', 'Where'],
  ['exp.what', 'Что делал', 'Ką veikiau', 'What I did'],

  ['bsod.button', 'НЕ_НАЖИМАТЬ.exe', 'NESPAUSTI.exe', 'DO_NOT_PRESS.exe'],
  ['bsod.tag', 'Ошибка', 'Klaida', 'Error'],
  ['bsod.line1', 'Критическая ошибка: слишком честный сайт.', 'Kritinė klaida: pernelyg sąžininga svetainė.', 'Critical error: a site that is too honest.'],
  ['bsod.line2', 'Нажмите любую клавишу или коснитесь экрана_', 'Spauskite bet kurį klavišą arba palieskite ekraną_', 'Press any key or tap the screen_'],

  ['popup.yes', 'Да, конечно', 'Taip, žinoma', 'Yes, of course'],
  ['popup.no', 'Закрыть', 'Uždaryti', 'Close'],
  ['popup.no_final', 'Ладно, закрывай', 'Gerai, uždaryk', 'Fine, close it'],
  ['popup.mail_subject', 'Хочу нанять', 'Noriu pasamdyti', 'I want to hire'],

  ['follower', '← ты тут', '← tu čia', '← you are here'],

  ['intro.fallback_bio', 'Этот сайт намеренно выглядит так.', 'Ši svetainė tyčia atrodo taip.', 'This site deliberately looks like this.'],

  ['loading', 'ЗАГРУЗКА… ПОЖАЛУЙСТА, ПОДОЖДИТЕ / Netscape Navigator 4.0', 'KRAUNAMA… PALAUKITE / Netscape Navigator 4.0', 'LOADING… PLEASE WAIT / Netscape Navigator 4.0'],
  ['error.load', 'ОШИБКА ЗАГРУЗКИ ДАННЫХ', 'DUOMENŲ ĮKĖLIMO KLAIDA', 'DATA LOAD ERROR'],
  ['error.hint', 'Не удалось получить данные с сервера. Обновите страницу.', 'Nepavyko gauti duomenų iš serverio. Atnaujinkite puslapį.', 'Could not fetch data from the server. Refresh the page.'],

  ['lang.label', 'Язык:', 'Kalba:', 'Language:'],
];

// ---------------------------------------------------------------------------
// Password hashing helpers (pbkdf2)
// ---------------------------------------------------------------------------
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function count(db, table) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
  return row ? Number(row.c) : 0;
}

function runGuarded(fn) {
  try {
    fn();
  } catch (e) {
    if (!String(e && e.message).includes('UNIQUE')) console.error('seed warn:', e.message);
  }
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

// ---------------------------------------------------------------------------
// Migration: add `<field>_<lang>` columns for every translatable field and
// backfill the base column into `_ru` (and every empty translation into ru).
// Purely additive — existing data is preserved.
// ---------------------------------------------------------------------------
function migrate(db) {
  db.exec(SCHEMA);
  let added = 0;

  // Projects gained image_url / repo_url columns (real portfolio screenshots +
  // public GitHub links). Additive ALTER TABLE, idempotent.
  {
    const pcols = tableColumns(db, 'projects');
    for (const col of ['image_url', 'repo_url']) {
      if (!pcols.includes(col)) {
        db.exec(`ALTER TABLE projects ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
        added++;
      }
    }
  }

  for (const [table, fields] of Object.entries(TRANSLATABLE)) {
    const cols = tableColumns(db, table);
    for (const field of fields) {
      for (const lang of LANGS) {
        const col = `${field}_${lang}`;
        if (!cols.includes(col)) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
          added++;
        }
      }
    }
    // Backfill: base column -> _ru if empty; any empty translation -> ru value.
    for (const field of fields) {
      const cols2 = tableColumns(db, table);
      const hasRu = cols2.includes(`${field}_ru`);
      if (hasRu) {
        db.exec(
          `UPDATE ${table} SET ${field}_ru = COALESCE(NULLIF(${field}_ru, ''), ${field})`
        );
      }
      for (const lang of ['lt', 'en']) {
        if (cols2.includes(`${field}_${lang}`)) {
          db.exec(
            `UPDATE ${table} SET ${field}_${lang} = COALESCE(NULLIF(${field}_${lang}, ''), ${field}_ru, ${field})`
          );
        }
      }
    }
  }
  return added;
}

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------
function seedTableLocalized(db, table, rows, fieldMap, extraColumns = []) {
  if (count(db, table) > 0) return false; // idempotent: only seed empty tables
  const baseCols = [...Object.keys(fieldMap), ...extraColumns];
  for (const r of rows) {
    const cols = [];
    const vals = [];
    for (const col of baseCols) {
      const v = r[col];
      if (v === undefined || v === null) continue;
      if (typeof v === 'object' && !Array.isArray(v)) {
        // multilingual object -> base col (ru) + one column per language
        for (const lang of LANGS) {
          cols.push(`${col}_${lang}`);
          const lv = v[lang];
          vals.push(Array.isArray(lv) ? JSON.stringify(lv) : String(lv ?? ''));
        }
        // base column mirrors Russian
        cols.push(col);
        vals.push(Array.isArray(v.ru) ? JSON.stringify(v.ru) : String(v.ru ?? ''));
      } else {
        cols.push(col);
        vals.push(Array.isArray(v) ? JSON.stringify(v) : String(v));
      }
    }
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    runGuarded(() => db.prepare(sql).run(...vals));
  }
  return true;
}

function seedAdmins(db) {
  if (count(db, 'admins') > 0) return;
  const salt = makeSalt();
  const hash = hashPassword('admin123', salt);
  db.prepare('INSERT INTO admins (username, password_hash, salt) VALUES (?, ?, ?)').run(
    'admin',
    hash,
    salt
  );
}

// settings: rows keyed `s:<key>:<lang>`
function seedSettings(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, byLang] of Object.entries(SEED_SETTINGS)) {
    for (const lang of LANGS) {
      runGuarded(() => ins.run(`s:${key}:${lang}`, String(byLang[lang] ?? byLang.ru ?? '')));
    }
  }
}

function seedUiStrings(db) {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO ui_strings (key, ru, lt, en) VALUES (?, ?, ?, ?)'
  );
  for (const [key, ru, lt, en] of SEED_UI_STRINGS) {
    runGuarded(() => ins.run(key, ru, lt, en));
  }
}

// Ensure every known ui_string key exists even on an older DB that only has
// some of them (additive, idempotent).
function ensureUiStringKeys(db) {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO ui_strings (key, ru, lt, en) VALUES (?, ?, ?, ?)'
  );
  for (const [key, ru, lt, en] of SEED_UI_STRINGS) runGuarded(() => ins.run(key, ru, lt, en));
}

// ---------------------------------------------------------------------------
// Replace fictional demo projects with the 8 real portfolio projects.
// - Deletes rows whose Russian title matches a legacy fictional name.
// - Inserts the real projects once (guarded by title presence so admins can
//   still edit them later without a re-seed clobbering their changes).
// Idempotent and additive: never touches stack/experience/links.
// ---------------------------------------------------------------------------
function replaceLegacyProjects(db) {
  // 1) Drop legacy fictional projects (only by exact title match).
  const legacy = db.prepare('SELECT id, title, title_ru FROM projects').all();
  const delStmt = db.prepare('DELETE FROM projects WHERE id = ?');
  for (const row of legacy) {
    const t = String(row.title_ru || row.title || '').trim();
    if (LEGACY_PROJECT_TITLES.includes(t)) delStmt.run(row.id);
  }

  // 2) Insert any real project that is not present yet (match by title_ru).
  const existing = new Set(
    db.prepare('SELECT title_ru, title FROM projects').all().map((r) => String(r.title_ru || r.title || '').trim())
  );
  const ins = db.prepare(
    `INSERT INTO projects
       (title, description, stack, bullets, sort_order,
        title_ru, title_lt, title_en,
        description_ru, description_lt, description_en,
        stack_ru, stack_lt, stack_en,
        bullets_ru, bullets_lt, bullets_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  SEED_PROJECTS.forEach((p, i) => {
    const tRu = String(p.title.ru).trim();
    if (existing.has(tRu)) return;
    runGuarded(() =>
      ins.run(
        p.title.ru, p.description.ru, p.stack.ru, JSON.stringify(p.bullets.ru), i + 1,
        p.title.ru, p.title.lt, p.title.en,
        p.description.ru, p.description.lt, p.description.en,
        p.stack.ru, p.stack.lt, p.stack.en,
        JSON.stringify(p.bullets.ru), JSON.stringify(p.bullets.lt), JSON.stringify(p.bullets.en)
      )
    );
  });
  // 3) Backfill image_url / repo_url from the project media map written by the
  //    upload step (data/project_media.json). Only sets non-empty values and
  //    only when the column is still empty, so admin edits are preserved.
  const mediaPath = path.join(__dirname, '..', 'data', 'project_media.json');
  if (fs.existsSync(mediaPath)) {
    let media = {};
    try {
      media = JSON.parse(fs.readFileSync(mediaPath, 'utf8'));
    } catch {
      media = {};
    }
    const setMedia = db.prepare(
      'UPDATE projects SET image_url = COALESCE(NULLIF(image_url, \'\'), ?), repo_url = COALESCE(NULLIF(repo_url, \'\'), ?) WHERE id = ?'
    );
    for (const row of db.prepare('SELECT id, title_ru, title FROM projects').all()) {
      const t = String(row.title_ru || row.title || '').trim();
      const m = media[t];
      if (m) setMedia.run(String(m.image_url || ''), String(m.repo_url || ''), row.id);
    }
  }
}

function openDb(options = {}) {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');

  migrate(db);

  const seedProjectFields = { title: 1, description: 1, stack: 1, bullets: 1 };
  const seedStackFields = { name: 1 };
  const seedExpFields = { company: 1, description: 1 };
  const seedLinkFields = { label: 1 };

  // 1:1 singleton profile row
  if (count(db, 'profile') === 0) {
    db.prepare(
      `INSERT INTO profile
        (name,
         name_ru, name_lt, name_en,
         email, title, title_ru, title_lt, title_en,
         years, years_ru, years_lt, years_en,
         bio_text, bio_text_ru, bio_text_lt, bio_text_en,
         status, status_ru, status_lt, status_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      SEED_PROFILE.name.ru,
      SEED_PROFILE.name.ru,
      SEED_PROFILE.name.lt,
      SEED_PROFILE.name.en,
      SEED_PROFILE.email,
      SEED_PROFILE.title.ru,
      SEED_PROFILE.title.ru,
      SEED_PROFILE.title.lt,
      SEED_PROFILE.title.en,
      SEED_PROFILE.years.ru,
      SEED_PROFILE.years.ru,
      SEED_PROFILE.years.lt,
      SEED_PROFILE.years.en,
      SEED_PROFILE.bio_text.ru,
      SEED_PROFILE.bio_text.ru,
      SEED_PROFILE.bio_text.lt,
      SEED_PROFILE.bio_text.en,
      SEED_PROFILE.status.ru,
      SEED_PROFILE.status.ru,
      SEED_PROFILE.status.lt,
      SEED_PROFILE.status.en
    );
  }

  seedTableLocalized(db, 'projects', SEED_PROJECTS, seedProjectFields, ['sort_order']);
  seedTableLocalized(db, 'stack', SEED_STACK_NAMES, seedStackFields, ['sort_order']);
  seedTableLocalized(db, 'experience', SEED_EXPERIENCE, seedExpFields, ['period', 'sort_order']);
  seedTableLocalized(db, 'links', SEED_LINKS, seedLinkFields, ['url', 'sort_order']);

  seedSettings(db);
  ensureUiStringKeys(db);
  seedAdmins(db);

  // Replace the fictional demo projects with the real portfolio projects.
  // Idempotent: removes legacy titles and (re)inserts the 8 real ones once.
  replaceLegacyProjects(db);

  // Mirror Russian into the base columns on every open (backward compat) and
  // make sure no translation slot is left empty for existing rows.
  fillMissingTranslations(db);

  // Bring the curated lt/en translations in for rows that only have Russian,
  // and refresh the static UI copy. Idempotent and backward compatible.
  applySeedTranslations(db);

  return db;
}

// For any existing row: if a localized column is empty, fall back to _ru, then
// to the base column. Keeps translations never-empty without touching real data.
function fillMissingTranslations(db) {
  for (const [table, fields] of Object.entries(TRANSLATABLE)) {
    if (table === 'settings') continue; // settings use the s:<key>:<lang> scheme
    const cols = tableColumns(db, table);
    for (const field of fields) {
      if (!cols.includes(`${field}_ru`)) continue;
      db.exec(
        `UPDATE ${table} SET ${field}_ru = COALESCE(NULLIF(${field}_ru, ''), ${field})`
      );
      for (const lang of ['lt', 'en']) {
        if (cols.includes(`${field}_${lang}`)) {
          db.exec(
            `UPDATE ${table} SET ${field}_${lang} = COALESCE(NULLIF(${field}_${lang}, ''), ${field}_ru)`
          );
        }
      }
    }
  }
  // settings base rows -> localized rows
  const baseRows = db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 's:%'").all();
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const r of baseRows) {
    for (const lang of LANGS) runGuarded(() => ins.run(`s:${r.key}:${lang}`, r.value));
  }
}

// Apply the curated seed translations to existing rows: for each content item
// we match by position (sort_order / id order) and fill the lt/en columns that
// still hold the Russian text. Existing real (non-Russian) translations are
// left untouched. Also refreshes settings + ui_strings for missing keys.
function applySeedTranslations(db) {
  function fill(table, fieldMap, seedRows, orderBy) {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
    rows.forEach((row, i) => {
      const seed = seedRows[i];
      if (!seed) return;
      const sets = [];
      const vals = [];
      for (const [field, kind] of Object.entries(fieldMap)) {
        const byLang = seed[field];
        if (!byLang || typeof byLang !== 'object') continue;
        for (const lang of ['lt', 'en']) {
          const cur = row[`${field}_${lang}`];
          const ru = row[`${field}_ru`] ?? row[field] ?? '';
          // only overwrite when the slot is empty or still equal to Russian text
          if (cur === undefined || cur === '' || cur === ru) {
            const target = kind === 'json' ? JSON.stringify(byLang[lang] ?? []) : String(byLang[lang] ?? '');
            // If the curated translation equals Russian for a field that is the
            // same across all languages (numbers, brand/tech names), leave the
            // current value alone instead of re-labeling it as "untranslated".
            if (target === String(ru)) continue;
            if (cur !== target) {
              sets.push(`${field}_${lang} = ?`);
              vals.push(target);
            }
          }
        }
      }
      if (sets.length) {
        vals.push(row.id);
        db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }
    });
  }

  // Profile singleton
  const p = db.prepare('SELECT * FROM profile ORDER BY id LIMIT 1').get();
  if (p) {
    const sets = [];
    const vals = [];
    for (const field of ['name', 'title', 'years', 'bio_text', 'status']) {
      const byLang = SEED_PROFILE[field];
      if (!byLang) continue;
      for (const lang of ['lt', 'en']) {
        const cur = p[`${field}_${lang}`];
        const ru = p[`${field}_ru`] ?? p[field] ?? '';
        if (cur === undefined || cur === '' || cur === ru) {
          const target = String(byLang[lang] ?? '');
          // Skip re-labeling "untranslated" when the curated translation is the
          // same as Russian (e.g. numeric year counts, brand names).
          if (target === String(ru)) continue;
          if (cur !== target) {
            sets.push(`${field}_${lang} = ?`);
            vals.push(target);
          }
        }
      }
    }
    if (sets.length) {
      vals.push(p.id);
      db.prepare(`UPDATE profile SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
  }

  fill('projects', { title: 'text', description: 'text', stack: 'text', bullets: 'json' }, SEED_PROJECTS, 'sort_order, id');
  fill('stack', { name: 'text' }, SEED_STACK_NAMES, 'sort_order, id');
  fill('experience', { company: 'text', description: 'text' }, SEED_EXPERIENCE, 'sort_order, id');
  fill('links', { label: 'text' }, SEED_LINKS, 'sort_order, id');

  // Settings: always refresh from the curated seed (they are pure UI copy).
  const ins = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [key, byLang] of Object.entries(SEED_SETTINGS)) {
    for (const lang of LANGS) {
      runGuarded(() => ins.run(`s:${key}:${lang}`, String(byLang[lang] ?? byLang.ru ?? '')));
    }
  }

  // ui_strings: refresh from curated seed for all curated keys.
  const insUi = db.prepare(
    'INSERT INTO ui_strings (key, ru, lt, en) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET ru = excluded.ru, lt = excluded.lt, en = excluded.en'
  );
  for (const [key, ru, lt, en] of SEED_UI_STRINGS) runGuarded(() => insUi.run(key, ru, lt, en));
}

function verifyPassword(password, salt, expectedHash) {
  return hashPassword(password, salt) === expectedHash;
}

if (require.main === module) {
  const forceSeed = process.argv.includes('--seed');
  const db = openDb({ forceSeed });
  const stats = {};
  for (const t of ['profile', 'projects', 'stack', 'experience', 'links', 'settings', 'ui_strings', 'messages', 'admins']) {
    stats[t] = count(db, t);
  }
  if (typeof db.close === 'function') db.close();
  console.log(`SQLite database ready: ${DB_PATH}`);
  console.log('Rows:', stats);
  console.log('Default admin: admin / admin123');
}

module.exports = {
  openDb,
  hashPassword,
  makeSalt,
  verifyPassword,
  DB_PATH,
  LANGS,
  DEFAULT_LANG,
  TRANSLATABLE,
  SEED_PROJECTS,
  SEED_PROFILE,
  SEED_SETTINGS,
  SEED_UI_STRINGS,
  SEED_STACK_NAMES,
  SEED_EXPERIENCE,
  SEED_LINKS,
};
