# AMERICANKA — Новий проєкт (Next.js + Supabase + Telegram)

Це повністю переписаний AMERICANKA: замість одного HTML-файлу — нормальна
структура (сторінка на файл), замість пам'яті браузера — справжня база
даних, замість платних SMS — безкоштовний Telegram-бот.

---

## Що змінилося порівняно зі старою версією

| Було | Стало |
|---|---|
| Один HTML-файл на 100 000+ символів | Окремі файли на кожну сторінку/функцію |
| Дані в localStorage (зникають при перезавантаженні) | PostgreSQL база даних (Supabase) з резервним копіюванням |
| SMS через TurboSMS (~1.3 грн/SMS, потребує ФОП) | Безкоштовний Telegram-бот |
| Формати турнірів зашиті в коді | Формати — це дані в базі, нові додаються без зміни коду |
| Авторизація на стороні клієнта (можна підробити) | Supabase Auth + Row Level Security на рівні бази даних |

---

## Крок 1. Створи проєкт на Supabase

1. Відкрий https://supabase.com → **"Start your project"** → увійди через GitHub
2. Натисни **"New Project"**
3. Вибери організацію, назви проєкт (наприклад `americanka`)
4. Придумай надійний пароль для бази даних — **збережи його окремо**
5. Регіон: вибери найближчий до України (Frankfurt — `eu-central-1`)
6. Зачекай ~2 хвилини, поки Supabase створить проєкт

## Крок 2. Виконай міграції бази даних

1. У Supabase зайди в розділ **"SQL Editor"** (зліва в меню)
2. Натисни **"New query"**
3. Відкрий файл `supabase/migrations/001_initial_schema.sql` з цього проєкту,
   скопіюй весь вміст, встав у редактор, натисни **"Run"**
4. Повтори те саме для `002_row_level_security.sql`
5. Повтори те саме для `003_telegram_pending_links.sql`

Якщо все пройшло без помилок — у розділі **"Table Editor"** ти побачиш
таблиці: `players`, `tournaments`, `matches`, `tournament_formats` і т.д.

## Крок 3. Створи Storage bucket для фото профілю

1. У Supabase зайди в розділ **"Storage"**
2. Натисни **"New bucket"**
3. Назва: `player-photos`
4. Увімкни **"Public bucket"** (щоб фото можна було показувати без додаткової авторизації)
5. Натисни **"Create bucket"**

## Крок 4. Візьми ключі API

1. У Supabase зайди в **Settings → API**
2. Скопіюй:
   - **Project URL** → це `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → це `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key (натисни "Reveal") → це `SUPABASE_SERVICE_ROLE_KEY`

⚠️ **service_role key — це найсекретніший ключ у всьому проєкті.** Він
обходить усі захисти бази даних. Ніколи не вставляй його в код сайту,
тільки в змінні середовища на сервері (Vercel).

## Крок 5. Створи Telegram-бота

1. Відкрий Telegram, знайди **@BotFather**
2. Напиши йому `/newbot`
3. Введи назву бота, наприклад `AMERICANKA Verify`
4. Введи юзернейм бота, що закінчується на `bot`, наприклад `AmericankaBot`
5. BotFather видасть токен типу `123456789:ABCdefGHIjklMNOpqrSTUvwxYZ` —
   **це і є `TELEGRAM_BOT_TOKEN`**

### Налаштуй webhook (щоб бот міг отримувати повідомлення)

Після деплою на Vercel (Крок 7) виконай у браузері (заміни значення):

```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://your-app.vercel.app/api/telegram/webhook
```

## Крок 6. Gmail для email-кодів

(Той самий процес, що й раніше)
1. Увімкни 2FA: https://myaccount.google.com/security
2. Створи App Password: https://myaccount.google.com/apppasswords
3. `GMAIL_USER` = твоя gmail адреса
4. `GMAIL_APP_PASSWORD` = 16-значний пароль додатку

## Крок 7. Деплой на Vercel

1. Залий цей проєкт на GitHub (новий репозиторій)
2. Відкрий https://vercel.com → **"Add New" → "Project"**
3. Імпортуй свій GitHub-репозиторій
4. У розділі **"Environment Variables"** додай усі змінні з `.env.example`
   з реальними значеннями
5. Натисни **"Deploy"**
6. Через ~2 хвилини отримаєш посилання типу `https://americanka.vercel.app`

## Крок 8. Створи першого адміна

Після деплою зареєструйся як звичайний користувач через сайт. Потім у
Supabase: **Table Editor → players** → знайди свій рядок → встанови
`is_admin = true` і `approval_status = approved` вручну.

---

## Структура проєкту

```
app/
  register/          — сторінка реєстрації (multi-step: форма → Telegram → email)
  login/              — вхід
  tournaments/        — список і створення турнірів
  profile/            — профіль гравця
  admin/              — адмін-панель
  rating/             — рейтинг (окремо М/Ж)
  api/
    auth/             — реєстрація, верифікація
    tournaments/      — створення турнірів, рахунок матчів
    admin/             — підтвердження рейтингу
    telegram/webhook/ — приймає повідомлення від Telegram-бота

lib/
  supabase/           — клієнти для браузера/сервера/адмін-операцій
  elo.js              — математика рейтингу Ело
  tournamentEngine.js — рушій турнірів (працює з БУДЬ-ЯКИМ форматом з бази)
  telegram.js         — відправка повідомлень через Telegram Bot API
  emailSender.js       — відправка email через Gmail
  verification.js     — генерація/перевірка кодів (зберігається в базі)

supabase/migrations/   — SQL-схема бази даних
```

## Додавання нового формату турніру (без зміни коду!)

Щоб додати, наприклад, формат на 12 гравців, просто додай новий рядок у
таблицю `tournament_formats` через SQL Editor — з власним `schedule` JSON,
що описує пари для кожного раунду. Жодних змін коду не потрібно.
