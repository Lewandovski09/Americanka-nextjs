-- ============================================================
-- AMERICANKA — Telegram deep-link linking
-- ============================================================
-- Replaces "the user types their @username and we match on it" with
-- "the user taps a link carrying a one-time nonce, and Telegram tells
-- us who they are".
--
-- Why: @username is optional, changeable, and typed by hand. If a
-- player changed their username and somebody else claimed it, the old
-- webhook happily moved that player's chat link to the new owner. The
-- immutable identity is `from.id`, stored below as telegram_user_id.

-- ── Immutable Telegram identity on the player row ──
alter table players add column if not exists telegram_user_id bigint unique;
alter table players add column if not exists telegram_linked_at timestamptz;

-- telegram_username stays, but is now display-only: it is written from
-- what Telegram reports and is used for the "message this player" link,
-- never for matching. Drop the unique constraint that made a changed
-- username collide with someone else's row.
alter table players alter column telegram_username drop not null;
do $$
begin
  alter table players drop constraint players_telegram_username_key;
exception
  when undefined_object then null; -- already dropped, fine
end $$;

-- ── One-time links ──
-- A row is created when registration finishes; it is consumed when the
-- user presses Start on the bot with ?start=<nonce>.
create table if not exists telegram_links (
  nonce text primary key,
  player_id uuid not null references players(id) on delete cascade,
  chat_id bigint,
  telegram_user_id bigint,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  linked_at timestamptz
);

create index if not exists telegram_links_player_idx on telegram_links (player_id);

-- ── Webhook idempotency ──
-- Telegram re-delivers an update if our endpoint doesn't answer in
-- time, so the same /start can arrive twice. The primary key makes a
-- duplicate insert fail, which is our signal to skip the update.
create table if not exists telegram_processed_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now()
);

create index if not exists telegram_processed_updates_at_idx
  on telegram_processed_updates (processed_at);

-- Both tables are touched only by server-side code holding the service
-- role key, which bypasses RLS. Enabling RLS with no policies means no
-- browser client (anon or authenticated) can read or write them.
alter table telegram_links enable row level security;
alter table telegram_processed_updates enable row level security;

-- NOTE: telegram_pending_links (migration 003) is intentionally left in
-- place so the old registration flow keeps working until this code is
-- deployed. It can be dropped in a later migration once the deep-link
-- flow has been live for a while.
