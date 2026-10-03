-- ============================================================
-- AMERICANKA — Migration 046: AVP points by the club's new table
-- ============================================================
-- lib/avp/tiers.ts now pays:
--
--   place      1    2    3    4   5-6  7-8  9-12  13-16   17+
--   AVP 250   250  200  175  150  125  100   75    50      0
--   AVP 500   500  400  350  300  275  250  150   100      0
--   AVP 1000  ×2 of AVP 500
--   AVP 2000  ×4 of AVP 500
--
-- Every avp_points row already stores its tier and the place it was
-- earned for, so the points of everything already awarded are simply
-- re-read from the new table here — places do not change, nobody moves
-- between seasons. New results are paid by the app with the same table.
--
-- Deploy the code from the same patch as well: otherwise the next
-- finished category would still be paid by the old table.
--
-- Idempotent: running it again changes nothing.

create or replace function _avp046_points(p_tier integer, p_place integer)
returns integer
language sql
immutable
as $$
  select coalesce(
    (case p_tier
       when 250  then array[250, 200, 175, 150, 125, 100, 75, 50]
       when 500  then array[500, 400, 350, 300, 275, 250, 150, 100]
       when 1000 then array[1000, 800, 700, 600, 550, 500, 300, 200]
       when 2000 then array[2000, 1600, 1400, 1200, 1100, 1000, 600, 400]
     end)[
      case
        when p_place = 1 then 1
        when p_place = 2 then 2
        when p_place = 3 then 3
        when p_place = 4 then 4
        when p_place between 5 and 6 then 5
        when p_place between 7 and 8 then 6
        when p_place between 9 and 12 then 7
        when p_place between 13 and 16 then 8
      end
    ],
    0);
$$;

do $$
declare
  n_changed int;
  n_total int;
begin
  select count(*) into n_total from avp_points;

  update avp_points
  set points = _avp046_points(tier, place)
  where points is distinct from _avp046_points(tier, place);
  get diagnostics n_changed = row_count;

  raise notice '046: % AVP rows in total, % recalculated by the new table', n_total, n_changed;
end;
$$;

drop function _avp046_points(integer, integer);
