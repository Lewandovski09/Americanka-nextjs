-- ============================================================
-- AMERICANKA — Migration 062: one score write at a time per game
-- ============================================================
-- Two score submissions for the same game at the same moment (two
-- judges, a double tap with a fixed score) used to both read the old
-- result first. The second one then thought nothing had changed and
-- skipped the Ело correction and the bracket swap, even when it flipped
-- the winner.
--
-- save_match_score locks the game's row, remembers what was there,
-- writes the new score and returns the previous state — so every
-- request knows exactly which result it replaced. A game that is
-- already played is only overwritten when p_allow_correction is true
-- (admin / head judge); otherwise nothing is written and saved = false.
--
-- Called only by the server (service role). Idempotent.

create or replace function save_match_score(
  p_match uuid,
  p_set1 integer[],
  p_set2 integer[],
  p_set3 integer[],
  p_allow_correction boolean default true
)
returns table (saved boolean, was_played boolean, old_set1 integer[], old_set2 integer[], old_set3 integer[])
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  select m.played, m.set1, m.set2, m.set3
    into r
    from tournament_matches m
   where m.id = p_match
   for update;
  if not found then
    return;
  end if;

  if coalesce(r.played, false) and not p_allow_correction then
    return query select false, true, r.set1, r.set2, r.set3;
    return;
  end if;

  update tournament_matches m
     set set1 = p_set1,
         set2 = p_set2,
         set3 = p_set3,
         played = true,
         played_at = case when coalesce(r.played, false) then m.played_at else now() end
   where m.id = p_match;

  return query select true, coalesce(r.played, false), r.set1, r.set2, r.set3;
end $$;

revoke all on function save_match_score(uuid, integer[], integer[], integer[], boolean) from public, anon, authenticated;
grant execute on function save_match_score(uuid, integer[], integer[], integer[], boolean) to service_role;

notify pgrst, 'reload schema';

-- Check: one row, «save_match_score».
select proname from pg_proc where proname = 'save_match_score';
