-- ============================================================
-- AMERICANKA — Migration 065: which address a player's app is installed from
-- ============================================================
-- The site has two addresses (both Vercel addresses of the project), and
-- players installed the app from either. Telegram on Android opens a link
-- straight in an installed app only when the link is on the app's own
-- address. The app tells the server its address when it starts
-- (/api/me/app-origin); the bot's personal messages — announcements,
-- invitations — then link each player to their own address.
--
-- Written only by the server (service role); not readable from the
-- browser (not in the column grants of migration 058). Idempotent.

alter table users add column if not exists app_origin text;
alter table users add column if not exists app_origin_at timestamptz;

notify pgrst, 'reload schema';

-- Check: two rows.
select column_name from information_schema.columns
 where table_name = 'users' and column_name in ('app_origin', 'app_origin_at');
