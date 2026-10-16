# site-admin

Личный сайт-портфолио в стиле Web 1.0: React/Vite фронтенд + Node (встроенные
модули) бэкенд с SQLite и админкой. Мультиязычность RU / LT / EN.

- **Живой сайт (GitHub Pages):** https://auryxn.github.io/site-admin/
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

На Pages нет Node-процесса, поэтому сайт собирается в **статическом режиме**:

1. `scripts/build-static-data.mjs` снимает снимок контента всех трёх языков
   через `GET /api/site?lang=...` и сохраняет его в `public/site-data.json`.
2. Фронтенд при `VITE_STATIC=1` читает этот JSON вместо `/api/site`
   (переключение — переменная окружения, локальный режим не затрагивается).
3. Сборка идёт с `base: /site-admin/`, картинки проектов копируются в `uploads/`.

Один шаг (нужен запущенный локально API на :4200 и `gh` с правами на репо):

```bash
./scripts/deploy-pages.sh
```

Сборка публикуется в ветку `gh-pages`, Pages настроен на неё (`/`).

### Ручная сборка статики

```bash
PAGES_BASE=/site-admin/ VITE_STATIC=1 npx vite build --outDir dist-pages
cp uploads/*.png dist-pages/uploads/ && touch dist-pages/.nojekyll
```

## Переменные окружения

| Переменная   | Назначение                                        |
|--------------|---------------------------------------------------|
| `VITE_STATIC`| `1` — читать статический `site-data.json` (Pages) |
| `PAGES_BASE` | base path сборки, напр. `/site-admin/`            |
| `PORT`       | порт API-сервера (по умолчанию 4200)              |
| `SITE_SECRET`| секрет для подписи токенов админки                |
