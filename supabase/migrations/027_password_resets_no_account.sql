-- ============================================================
-- AMERICANKA — Migration 027: password_resets.no_account_at
-- ============================================================
-- Before this, a Telegram account with no matching player (lost the
-- original linked Telegram entirely — new phone, deleted account,
-- forgot which one) was indistinguishable from "hasn't opened the bot
-- yet" on the web page: both just sat waiting until the 10-minute
-- timeout, then showed the same generic "expired, try again" message —
-- which is actively unhelpful here, since trying again changes nothing
-- for someone whose old Telegram is genuinely gone.
--
-- This column lets the webhook record that outcome distinctly, so the
-- watch route (and the page) can tell the two apart and point this one
-- case at an admin instead of a retry button that can't help.

alter table password_resets add column no_account_at timestamptz;
