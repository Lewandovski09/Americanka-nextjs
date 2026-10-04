-- ============================================================
-- AMERICANKA — Migration 063: a player is someone's partner only once per event
-- ============================================================
-- Two players who applied alone could both accept the same third
-- player's invitation at the same moment — both checks saw him free and
-- he ended up as the partner in two applications. The database now
-- refuses the second one: within one event, a player may be listed as
-- partner_id in only one live application (withdrawn / rejected ones
-- don't count).
--
-- If the existing data already breaks this rule, the index is NOT
-- created and the query at the end lists the duplicates — fix them
-- (withdraw one of the two applications) and run this file again.
--
-- Idempotent.

do $$
begin
  create unique index if not exists uq_applications_partner_per_event
    on tournament_applications(event_id, partner_id)
    where partner_id is not null and status not in ('withdrawn', 'rejected');
exception when unique_violation then
  raise notice 'duplicates found — index not created, see the list below';
end $$;

-- Check 1: one row «uq_applications_partner_per_event».
select indexname from pg_indexes where indexname = 'uq_applications_partner_per_event';

-- Check 2: must be EMPTY (otherwise these players are partners twice).
select event_id, partner_id, count(*)
  from tournament_applications
 where partner_id is not null and status not in ('withdrawn', 'rejected')
 group by event_id, partner_id
having count(*) > 1;
