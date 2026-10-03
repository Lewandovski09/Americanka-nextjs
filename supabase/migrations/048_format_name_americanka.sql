-- ============================================================
-- AMERICANKA — Migration 048: the format is called «Americanka»
-- ============================================================
-- The format's display name is now the English «Americanka» everywhere
-- (lib/formats/index.ts displayName). These two profile RPCs carry their
-- own copy of the format names in a CASE, so they are recreated here
-- with the new name — otherwise the profile would keep saying
-- «Американка» while the rest of the app says «Americanka».
--
-- Bodies are copied unchanged from 037 (get_user_format_stats) and 042
-- (get_user_tournament_history); only the name string differs.
--
-- Event and category names were filled in once, at creation, from the
-- format name («Американка», «Американка · Pro (Ч)»). Those that still
-- carry exactly that default are renamed too; a name the admin typed by
-- hand is left alone.

drop function if exists get_user_format_stats(uuid);

create function get_user_format_stats(p_user_id uuid)
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
  with user_categories as (
    select
      t.id as category_id,
      case te.format_kind
        when 'americanka' then 'Americanka'
        when 'single_gender' then 'Чоловічі / Жіночі'
        when 'mix' then 'Мікс'
        when 'king_of_beach' then 'Король пляжу'
        else 'Americanka'
      end as format_name,
      t.winner_user_id
    from tournament_players tp
    join tournament_categories t on t.id = tp.category_id
    left join tournament_events te on te.id = t.event_id
    where tp.user_id = p_user_id and t.status = 'done'
  ),
  user_games as (
    select
      pc.format_name,
      m.id as match_id,
      case
        when p_user_id = any(m.team_a_players) then match_won_by_a(m.set1, m.set2, m.set3)
        else not match_won_by_a(m.set1, m.set2, m.set3)
      end as won
    from tournament_matches m
    join user_categories pc on pc.category_id = m.category_id
    where m.played = true
      and (p_user_id = any(m.team_a_players) or p_user_id = any(m.team_b_players))
  )
  select
    pc.format_name,
    count(distinct pc.category_id) as tournaments_played,
    count(distinct pc.category_id) filter (where pc.winner_user_id = p_user_id) as tournaments_won,
    count(pg.match_id) as games_played,
    count(pg.match_id) filter (where pg.won) as games_won
  from user_categories pc
  left join user_games pg on pg.format_name = pc.format_name
  group by pc.format_name;
$$;

drop function if exists get_user_tournament_history(uuid);

create function get_user_tournament_history(p_user_id uuid)
returns table (
  category_id uuid,
  tournament_name text,
  format_name text,
  category text,
  gender gender_type,
  status tournament_status,
  scheduled_at timestamptz,
  finished_at timestamptz,
  elo_delta integer,
  placement integer
)
language sql
stable
as $$
  select
    t.id as category_id,
    t.name as tournament_name,
    case te.format_kind
      when 'americanka' then 'Americanka'
      when 'single_gender' then 'Чоловічі / Жіночі'
      when 'mix' then 'Мікс'
      when 'king_of_beach' then 'Король пляжу'
      else 'Americanka'
    end as format_name,
    t.category_label as category,
    t.gender,
    t.status,
    t.scheduled_at,
    t.finished_at,
    (
      -- Sum every game of this category, not one row: auto-Ело writes
      -- per game. The inner join is what replaces eh.category_id.
      select sum(eh.delta)::integer
      from elo_history eh
      join tournament_matches m on m.id = eh.match_id
      where m.category_id = t.id and eh.user_id = p_user_id
    ) as elo_delta,
    tpl.place as placement
  from (
    select category_id from tournament_players where user_id = p_user_id
    union
    select category_id from tournament_teams
      where user1_id = p_user_id or user2_id = p_user_id
  ) participated
  join tournament_categories t on t.id = participated.category_id
  left join tournament_events te on te.id = t.event_id
  left join tournament_placements tpl on tpl.category_id = t.id and tpl.user_id = p_user_id
  order by t.scheduled_at desc;
$$;

-- Default names only (see header).
update tournament_events set name = 'Americanka' where name = 'Американка';
update tournament_categories set name = 'Americanka' || substr(name, length('Американка') + 1)
where name like 'Американка · %';

notify pgrst, 'reload schema';
