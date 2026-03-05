# Amazon Scraper

## Быстрый старт

```bash
yarn install
docker-compose up -d
cp .env.example .env
yarn prisma migrate dev
yarn start:dev
```

Запустить парсинг:
```bash
curl -X POST http://localhost:3000/api/scrape/category/headphones
```

---

## Схема базы данных

```
Category  →  Product  →  Review
                    →  ScrapeJob
```

### Category
Хранит категории Amazon с поддержкой вложенности через `parentId → id` (self-reference). Поле `slug` используется как ключ для запуска парсинга, `amazonPath` — для формирования URL запроса.

### Product
Уникальный ключ — `asin` (10-символьный идентификатор Amazon). Хранит денормализованные метрики `avgRating` и `totalReviews` — чтобы не считать `AVG` и `COUNT` по таблице отзывов при каждом запросе. Пересчитываются после каждого обновления отзывов. Поле `lastScrapedAt` используется для инкрементального парсинга.

Seller, brand, availability не реализованы на текущем этапе — парсер их не извлекает.

### Review
Уникальный ключ — `amazonReviewId`. Гарантирует идемпотентность: повторный парсинг не создаёт дубли. Автор отзыва хранится прямо в строке (`reviewerName`) — Amazon не даёт стабильных user ID, отдельная таблица не имеет смысла.

Индексы:
- `(productId)` — базовая выборка отзывов товара
- `(productId, rating)` — фильтрация по рейтингу
- `(productId, reviewDate)` — сортировка по дате
- `(reviewDate)` — инкрементальный парсинг

### ScrapeJob
Лог каждого запуска парсера. Хранит тип, статус, количество найденных/сохранённых записей и текст ошибки. Позволяет видеть что происходит и находить упавшие джобы.

---

## Алгоритм работы

**Парсинг категории** `POST /api/scrape/category/:slug`:

1. Найти или создать категорию в БД
2. Создать `ScrapeJob` со статусом `RUNNING`
3. Пройти по страницам категории, собрать товары
4. Сохранить товары через `upsert` по `asin`
5. Обновить `ScrapeJob` → `DONE`
6. Запустить парсинг отзывов для каждого товара

**Парсинг отзывов** для каждого товара:

1. Создать `ScrapeJob` со статусом `RUNNING`
2. Загрузить product page `/dp/{asin}`
3. Извлечь отзывы, отфильтровать старше `lastScrapedAt`
4. Для каждого отзыва: `upsert` по `amazonReviewId`
    - Новый → создать запись
    - Существующий → обновить только `helpfulVotes`
5. Пересчитать `avgRating` и `totalReviews` на товаре
6. Обновить `lastScrapedAt`, `ScrapeJob` → `DONE`

**Повторный запуск** той же категории обновляет данные, не создаёт дубли.

---

## Почему axios + cheerio

Playwright избыточен для MVP: ~300MB памяти на процесс, 3–5с на страницу против 0.5с у axios. Вместо этого в `HttpService` реализованы stealth-техники:

- Ротация User-Agent из пула реальных браузеров
- Реальные заголовки: `Accept`, `Accept-Language`, `Sec-Fetch-*`
---

## Устойчивость

### Rate limiting и баны
- Случайные задержки 1.5–4с между страницами, 3–5с между товарами
- Exponential backoff при `429`/`503`: `2^attempt * 1000ms + jitter`, до 3 попыток
- Детекция CAPTCHA по DOM — при обнаружении останавливаем парсинг сессии

### Ошибки сети и таймауты
- Таймаут 30с на каждый запрос
- `try/catch` на уровне каждого товара — ошибка одного не останавливает остальные
- Ошибка пишется в `ScrapeJob.errorMessage` со статусом `FAILED`

### Изменение структуры страниц (HTML breakage)
- Приоритет на `data-*` атрибуты (`data-asin`, `data-hook`, `data-component-type`) — они стабильнее CSS-классов
- Несколько fallback-селекторов через запятую: `[data-hook="review-title"] span, .review-title span`
- Если парсер сломался — `ScrapeJob` покажет `itemsFound: 0`, сразу видно что нужно обновить селекторы

### Логирование
Встроенный `Logger` NestJS, уровни: `log`, `warn`, `error`, `debug`.

```
[ScrapingService]  Starting category scrape: headphones
[CategoryParser]   Parsing category page 1: https://amazon.com/s?k=headphones
[CategoryParser]   Found 48 products on page 1
[ScrapingService]  Parsed 48 products, saving to DB...
[ReviewsParser]    Parsed 13 reviews for ASIN B09XS7JWHH (13 total on page)
[ScrapingService]  Reviews for B09XS7JWHH: 13 new, 0 existing
[HttpService]      CAPTCHA detected on: https://amazon.com/dp/B0ABC
[HttpService]      Got 503, retrying in 3241ms...
```

---

## API

```
POST /api/scrape/category/:slug        — запустить парсинг категории
POST /api/scrape/reviews/:asin         — запустить парсинг отзывов товара
GET  /api/scrape/jobs                  — последние 50 задач

GET  /api/products                     — все товары
GET  /api/products?category=slug       — товары по категории
GET  /api/products/:asin               — один товар
GET  /api/products/:asin/reviews       — отзывы (пагинация: ?page=1&limit=20)
```