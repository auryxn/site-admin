# site-admin

Личный сайт-портфолио в стиле Web 1.0: React/Vite фронтенд + Node (встроенные
модули) бэкенд с SQLite и админкой. Мультиязычность RU / LT / EN.

- **Живой сайт:** https://auryxn.codes
- **Репозиторий:** https://github.com/auryxn/site-admin

## Локальный запуск (полный режим: API + админка)

```bash
npm install
npm run db:seed        # (один раз) заполнить SQLite
npm start              # API + собранный фронтенд на http://localhost:4200
```

- Публичный сайт → http://localhost:4200/
- Админка        → http://localhost:4200/admin
- API            → http://localhost:4200/api/site?lang=ru|lt|en

Режим разработки с HMR (фронт на :4201, прокси `/api` и `/uploads` на :4200):

```bash
npm run dev            # при запущенном `npm start` в другом терминале
```

## Деплой на GitHub Pages (статика без бэкенда)

Legacy-режим статической сборки (на случай fallback-хостинга). Канонический
прод — https://auryxn.codes (Render). На статике нет Node-процесса, поэтому сайт
собирается в **статическом режиме**:

1. `scripts/build-static-data.mjs` снимает снимок контента всех трёх языков
   через `GET /api/site?lang=...` и сохраняет его в `public/site-data.json`.
2. Фронтенд при `VITE_STATIC=1` читает этот JSON вместо `/api/site`
   (переключение — переменная окружения, локальный режим не затрагивается).
3. Сборка идёт с корневым `base: /`, картинки проектов копируются в `uploads/`.

Один шаг (нужен запущенный локально API и `gh` с правами на репо):

```bash
./scripts/deploy-pages.sh
```

### Ручная сборка статики

```bash
VITE_STATIC=1 npx vite build --outDir dist-pages
cp uploads/*.png dist-pages/uploads/ && touch dist-pages/.nojekyll
```

## Переменные окружения

| Переменная       | Назначение                                                              |
|------------------|-------------------------------------------------------------------------|
| `PORT`           | порт API-сервера (Render задаёт сам; локально по умолчанию 4200)        |
| `ADMIN_USER`     | логин админа (по умолчанию `admin`)                                     |
| `ADMIN_PASSWORD` | пароль админа (по умолчанию `empty`)      |
| `SESSION_SECRET` | секрет для подписи токенов админки (fallback: `SITE_SECRET`)            |
| `DB_PATH`        | путь к SQLite-файлу (по умолчанию `<repo>/site.sqlite`; на Render → `/tmp`) |
| `UPLOADS_DIR`    | папка загруженных картинок (по умолчанию `<repo>/uploads`)              |
| `DIST_DIR`       | папка собранного фронтенда (по умолчанию `<repo>/dist`)                 |
| `VITE_STATIC`    | `1` — читать статический `site-data.json` (Pages)                       |
| `PAGES_BASE`     | base path сборки (по умолчанию `/`; legacy Pages использовал `/site-admin/`) |

При первом старте БД создаётся автоматически и засеивается (8 реальных
проектов, RU/LT/EN) — идемпотентно, повторные старты данные не перетирают.

## Деплой на Render.com (живой Node + SQLite + админка)

Файл `render.yaml` — это Blueprint, поэтому всё настраивается в пару кликов:

1. Зайдите на [render.com](https://render.com) → **New** → **Blueprint**.
2. Подключите GitHub-репозиторий **`auryxn/site-admin`** и нажмите **Connect**.
3. Render прочитает `render.yaml` и покажет сервис `site-admin`. Задайте секреты:
   - `ADMIN_PASSWORD` — пароль от `/admin` (обязательно);
   - `SESSION_SECRET` — сгенерируется автоматически (`generateValue: true`).
4. Нажмите **Apply** / **Deploy** и дождитесь сборки (`npm ci && npm run build`).
5. Готово: сайт → `https://auryxn.codes`, админка →
   `https://auryxn.codes/admin` (логин `admin`, пароль — ваш `ADMIN_PASSWORD`).
6. Кастомный домен: Render Dashboard → **Settings → Custom Domains** → добавьте
   `auryxn.codes` и пропишите у регистратора CNAME/ALIAS на `<service>.onrender.com`.

### Оговорки free-tier

- **Засыпание.** Free-сервис уходит в сон через ~15 мин неактивности; первый
  запрос после сна отвечает ~30–60 секунд (cold start). Дальше — быстро.
- **Диск недоступен бесплатно.** Persistent Disk на Render — **только платный**
  план. Поэтому по умолчанию (free) SQLite живёт в `/tmp` и **пересоздаётся +
  засеивается при каждом холодном старте**: публичный сайт всегда показывает
  контент, но правки через админку теряются после сна/деплоя (для демо — ок).
- **Хотите сохранять правки** — апгрейд на платный план, затем в `render.yaml`
  раскомментируйте блок `disk:` и переменные `DB_PATH=/data/site.sqlite`,
  `UPLOADS_DIR=/data/uploads`.
- **Node.** `node:sqlite` доступен без флага с **Node 22.13.0**; в `render.yaml`
  зафиксирован `NODE_VERSION=24.21.0` (активный LTS).

