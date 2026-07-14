-- ============================================================
-- AMERICANKA — Migration 015: Drop the legacy tournament_formats
-- ============================================================
-- Format definitions now live entirely in code (lib/formats/*). The
-- tournament_formats table + tournaments.format_id FK are only used by
-- pre-rewrite rows and two reporting functions. This migration:
--   1. rewrites those functions onto tournament_events.format_kind
--      (mapping the kind to its display name in SQL);
--   2. drops the tournaments.format_id column (removing the FK);
--   3. drops the tournament_formats table.
--
-- Pre-rewrite tournaments have no event link; since the app was
-- americanka-only back then, they map to «Американка» so history stays
-- intact.

-- Shared kind → display-name mapping (kept in sync with lib/formats).
-- Inlined in each function because SQL has no cheap shared expression.

-- ── 1a. Per-format player stats (rating page “compare players”) ──
create or replace function get_player_format_stats(p_player_id uuid)
returns table (
  format_name text,
  tournaments_played bigint,
  tournaments_won bigint,
  games_played bigint,
  games_won bigint
)
language sql
stable
as $$
  with player_tournaments as (
    select
      t.id as tournament_id,
      case te.format_kind
        when 'americanka' then 'Американка'
        when 'single_gender' then 'Чоловічі / Жіночі'
        when 'mix' then 'Мікс'
        when 'king_of_beach' then 'Король пляжу'
        else 'Американка'
      end as format_name,
      t.winner_player_id
    from tournament_players tp
    join tournaments t on t.id = tp.tournament_id
    left join tournament_events te on te.id = t.event_id
    where tp.player_id = p_player_id and t.status = 'done'
  ),
  player_games as (
    select
      pt.format_name,
      m.id as match_id,
      case
        when p_player_id = any(m.team_a_players) then m.score_a > m.score_b
        else m.score_b > m.score_a
      end as won
    from matches m
    join player_tournaments pt on pt.tournament_id = m.tournament_id
    where m.played = true
      and (p_player_id = any(m.team_a_players) or p_player_id = any(m.team_b_players))
  )
  select
    pt.format_name,
    count(distinct pt.tournament_id) as tournaments_played,
    count(distinct pt.tournament_id) filter (where pt.winner_player_id = p_player_id) as tournaments_won,
    count(pg.match_id) as games_played,
    count(pg.match_id) filter (where pg.won) as games_won
  from player_tournaments pt
  left join player_games pg on pg.format_name = pt.format_name
  group by pt.format_name;
$$;

-- ── 1b. Player tournament history (profile page) ──
drop function if exists get_player_tournament_history(uuid);

create function get_player_tournament_history(p_player_id uuid)
returns table (
  tournament_id uuid,
  tournament_name text,
  format_name text,
  category skill_category,
  gender gender_type,
  status tournament_status,
  finished_at timestamptz,
  elo_delta integer,
  placement integer
)
language sql
stable
as $$
  select
    t.id as tournament_id,
    t.name as tournament_name,
    case te.format_kind
      when 'americanka' then 'Американка'
      when 'single_gender' then 'Чоловічі / Жіночі'
      when 'mix' then 'Мікс'
      when 'king_of_beach' then 'Король пляжу'
      else 'Американка'
    end as format_name,
    t.category,
    t.gender,
    t.status,
    t.finished_at,
    eh.delta as elo_delta,
    eh.placement
  from tournament_players tp
  join tournaments t on t.id = tp.tournament_id
  left join tournament_events te on te.id = t.event_id
  left join elo_history eh on eh.tournament_id = t.id and eh.player_id = p_player_id
  where tp.player_id = p_player_id
  order by t.scheduled_at desc;
$$;

-- ── 2. Drop the FK column, then 3. the table ──
alter table tournaments drop column if exists format_id;
drop table if exists tournament_formats;
