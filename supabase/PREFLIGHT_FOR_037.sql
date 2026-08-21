-- ============================================================
-- AMERICANKA — pre-flight check for migration 037
-- ============================================================
-- NOT a migration. Read-only. Run it in the SQL editor BEFORE 037 and
-- fix whatever it lists.
--
-- Why this exists: the migrations folder in this repo is not a faithful
-- record of what has actually been applied to the live database.
-- Two proofs already:
--   • tournament_placements is written and read by the app but was
--     never created by any migration here — somebody made it by hand;
--   • migration 032 (elo_history.match_id) was never applied, and the
--     first attempt at 037 died on it: ERROR 42703, column eh.match_id
--     does not exist.
--
-- Migration 037 recreates nine function bodies, and a function body is
-- checked against the real schema at CREATE time. So every column those
-- bodies touch has to exist, or 037 stops partway through — which is
-- survivable (it is idempotent, just run it again after fixing), but
-- discovering the gaps one error at a time is not how anyone wants to
-- spend an evening.
--
-- Every row this returns is something to fix. No rows = 037 will get
-- through its function section.
--
-- Safe to run before OR after 037: each expectation is checked under
-- both the old and the new name, so a half-renamed database reports the
-- same answer as an untouched one.

with expected(tbl_new, tbl_old, col_new, col_old) as (values
  -- users ← players
  ('users','players','id','id'),
  ('users','players','full_name','full_name'),
  ('users','players','login','login'),
  ('users','players','is_admin','is_admin'),
  ('users','players','elo','elo'),
  ('users','players','category','category'),
  ('users','players','gender','gender'),
  ('users','players','approval_status','approval_status'),
  ('users','players','approved_at','approved_at'),
  ('users','players','approved_by','approved_by'),
  ('users','players','telegram_user_id','telegram_user_id'),
  ('users','players','telegram_linked_at','telegram_linked_at'),
  ('users','players','telegram_username','telegram_username'),
  ('users','players','tournaments_played','tournaments_played'),
  ('users','players','tournaments_won','tournaments_won'),
  ('users','players','created_at','created_at'),

  -- tournament_categories ← tournaments
  ('tournament_categories','tournaments','id','id'),
  ('tournament_categories','tournaments','name','name'),
  ('tournament_categories','tournaments','status','status'),
  ('tournament_categories','tournaments','event_id','event_id'),
  ('tournament_categories','tournaments','category','category'),
  ('tournament_categories','tournaments','category_label','category_label'),
  ('tournament_categories','tournaments','gender','gender'),
  ('tournament_categories','tournaments','scheduled_at','scheduled_at'),
  ('tournament_categories','tournaments','finished_at','finished_at'),
  ('tournament_categories','tournaments','winner_user_id','winner_player_id'),
  ('tournament_categories','tournaments','avp_tier','avp_tier'),

  -- tournament_matches ← matches
  ('tournament_matches','matches','id','id'),
  ('tournament_matches','matches','category_id','tournament_id'),
  ('tournament_matches','matches','set1','set1'),
  ('tournament_matches','matches','set2','set2'),
  ('tournament_matches','matches','set3','set3'),
  ('tournament_matches','matches','team_a_players','team_a_players'),
  ('tournament_matches','matches','team_b_players','team_b_players'),
  ('tournament_matches','matches','played','played'),
  ('tournament_matches','matches','played_at','played_at'),
  ('tournament_matches','matches','round_number','round_number'),
  ('tournament_matches','matches','judge_id','judge_id'),

  -- elo_history — match_id is the one that already blew up
  ('elo_history','elo_history','id','id'),
  ('elo_history','elo_history','user_id','player_id'),
  ('elo_history','elo_history','category_id','tournament_id'),
  ('elo_history','elo_history','match_id','match_id'),
  ('elo_history','elo_history','delta','delta'),
  ('elo_history','elo_history','elo_before','elo_before'),
  ('elo_history','elo_history','elo_after','elo_after'),
  ('elo_history','elo_history','created_at','created_at'),

  -- tournament_placements — the hand-made one
  ('tournament_placements','tournament_placements','category_id','tournament_id'),
  ('tournament_placements','tournament_placements','user_id','player_id'),
  ('tournament_placements','tournament_placements','place','place'),

  ('tournament_players','tournament_players','user_id','player_id'),
  ('tournament_players','tournament_players','category_id','tournament_id'),
  ('tournament_players','tournament_players','slot_index','slot_index'),

  ('tournament_teams','tournament_teams','category_id','tournament_id'),
  ('tournament_teams','tournament_teams','user1_id','player1_id'),
  ('tournament_teams','tournament_teams','user2_id','player2_id'),
  ('tournament_teams','tournament_teams','slot_index','slot_index'),

  ('tournament_events','tournament_events','id','id'),
  ('tournament_events','tournament_events','format_kind','format_kind'),
  ('tournament_events','tournament_events','avp_tier','avp_tier'),
  ('tournament_events','tournament_events','scheduled_at','scheduled_at'),

  ('tournament_applications','tournament_applications','user_id','player_id'),
  ('tournament_applications','tournament_applications','partner_id','partner_id'),
  ('tournament_applications','tournament_applications','assigned_category_id','assigned_tournament_id'),
  ('tournament_applications','tournament_applications','event_id','event_id'),
  ('tournament_applications','tournament_applications','status','status'),

  ('tournament_judges','tournament_judges','user_id','player_id'),
  ('tournament_judges','tournament_judges','event_id','event_id'),
  ('tournament_judges','tournament_judges','is_head','is_head'),

  ('avp_points','avp_points','user_id','player_id'),
  ('avp_points','avp_points','category_id','tournament_id'),
  ('avp_points','avp_points','season_id','season_id'),
  ('avp_points','avp_points','points','points'),
  ('avp_points','avp_points','awarded_at','awarded_at'),
  ('avp_seasons','avp_seasons','starts_on','starts_on'),
  ('avp_seasons','avp_seasons','ends_on','ends_on'),

  ('partner_stats','partner_stats','user_id','player_id'),
  ('partner_stats','partner_stats','partner_id','partner_id'),

  ('telegram_links','telegram_links','user_id','player_id'),
  ('notification_dismissals','notification_dismissals','user_id','player_id')
),
resolved as (
  select
    e.*,
    coalesce(
      to_regclass('public.' || quote_ident(e.tbl_new)),
      to_regclass('public.' || quote_ident(e.tbl_old))
    ) as rel
  from expected e
)
select
  coalesce(r.tbl_new, r.tbl_old) as object,
  r.col_new                      as expected_column,
  case
    when r.rel is null and r.tbl_new = r.tbl_old
      then 'TABLE MISSING — ' || r.tbl_new
    when r.rel is null
      then 'TABLE MISSING — neither ' || r.tbl_new || ' nor ' || r.tbl_old || ' exists'
    when r.col_new = r.col_old
      then 'COLUMN MISSING — ' || r.col_new
    else 'COLUMN MISSING — neither ' || r.col_new || ' nor ' || r.col_old || ' exists'
  end as problem
from resolved r
where r.rel is null
   or not exists (
     select 1 from pg_attribute a
     where a.attrelid = r.rel
       and a.attnum > 0
       and not a.attisdropped
       and a.attname in (r.col_new, r.col_old)
   )

union all

-- match_won_by_a is called by three of the function bodies 037 creates,
-- so it has to already exist (migration 017).
select 'match_won_by_a(integer[],integer[],integer[])', '-', 'FUNCTION MISSING — apply migration 017 first'
where to_regprocedure('public.match_won_by_a(integer[],integer[],integer[])') is null

union all

-- The enum types the get_user_tournament_history signature declares.
select 'gender_type', '-', 'TYPE MISSING'
where to_regtype('public.gender_type') is null
union all
select 'tournament_status', '-', 'TYPE MISSING'
where to_regtype('public.tournament_status') is null

order by 1, 2;
