-- ============================================================
-- AMERICANKA — Migration 032: elo_history.match_id
-- ============================================================
-- Auto-Ело (migration 031 / the score route) writes one elo_history
-- row per Americanka game, but elo_history had no way to say WHICH
-- game a row came from beyond its tournament and timestamp — fine for
-- the tournament-level history, not enough for a per-game log ("what
-- did this specific game do to my rating"). This is nullable: an
-- admin's manual adjustment isn't tied to any one match and should
-- stay that way.

alter table elo_history add column match_id uuid references matches(id) on delete set null;

create index elo_history_match_idx on elo_history(match_id);
