-- ============================================================
-- AMERICANKA — let a player be deleted without hitting audit rows
-- ============================================================
-- admin_actions.target_player_id and players.approved_by both reference
-- players with the default NO ACTION, so any row pointing at a player
-- blocked that player's deletion outright. Rejecting a registration hit
-- this immediately: the route logged the action first, then tried to
-- delete the player the log had just referenced.
--
-- The route no longer writes the reference at all, but existing rows
-- still block deletions, and any future audit write would too. SET NULL
-- keeps the audit history and lets the player go.

alter table admin_actions
  drop constraint if exists admin_actions_target_player_id_fkey;

alter table admin_actions
  add constraint admin_actions_target_player_id_fkey
  foreign key (target_player_id) references players(id) on delete set null;

alter table players
  drop constraint if exists players_approved_by_fkey;

alter table players
  add constraint players_approved_by_fkey
  foreign key (approved_by) references players(id) on delete set null;

-- NOTE: tournaments.created_by, tournament_players.player_id,
-- matches.winner_player_id and tournament_messages.player_id still block
-- deletion by design — a player with tournament history should not
-- silently vanish from results. Rejecting a NEW registration is
-- unaffected, since such a player has no history yet.
