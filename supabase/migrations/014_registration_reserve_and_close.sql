-- ============================================================
-- AMERICANKA — Migration 014: reserve list + closable registration
-- ============================================================
-- The registration flow is now single-track: every player applies to a
-- league (category) of their choice and the admin distributes them by
-- hand, seeing the requested league and the player's real rating.
--
-- Two additions support the admin queue:
--   • a 'reserve' application status — players may apply beyond a
--     league's capacity; the extras are parked in the reserve and can
--     be promoted later if a spot frees up.
--   • registration_open on the event — the admin can close registration
--     so no new applications come in, without starting the event.
--
-- Additive and idempotent. Safe to run once on production.

-- New application status. (ADD VALUE is allowed in a transaction on
-- PG 12+, as long as the value isn't used in the same transaction — it
-- isn't here.)
alter type application_status add value if not exists 'reserve';

alter table tournament_events
  add column if not exists registration_open boolean not null default true;
